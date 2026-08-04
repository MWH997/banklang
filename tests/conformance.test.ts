import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  buildRecord,
  decodePacked,
  encodePacked,
  hasCobc,
  layoutOf,
  readField,
  runConformance,
  type SqlOutcome,
} from "../tools/conformance";

/**
 * Executes generated COBOL against the reference runtime in `runtime/`.
 *
 * Every other suite reads the generated program. This one runs it, which is the
 * only way to catch a defect that compiles: a rounding mode applied to the
 * wrong operand, a bounds guard that clamps instead of refusing, a rollback
 * that never reaches the ledger. The runtime is a reference implementation in
 * this repository, not IBM Db2 or CICS; see `runtime/README.md`.
 */

const SOURCE = readFileSync(
  "examples/withdrawal-with-recovery/src/main.bank.ts",
  "utf8",
);

const CICS_SOURCE = readFileSync(
  "examples/online-enquiry/src/main.bank.ts",
  "utf8",
);

const CURSOR_SOURCE = readFileSync(
  "examples/branch-accrual-cursor/src/main.bank.ts",
  "utf8",
);

/**
 * Two instantiations of one generic that lower to identical COBOL.
 *
 * They share a paragraph, so the single `LINKAGE` cell its record parameter
 * uses is rebound at each call site. Reading the emitted COBOL cannot tell a
 * correct rebinding from one that leaves the cell pointing at the previous
 * argument; two different values coming back can.
 */
const SHARED_SOURCE = `module SharedInstantiation;

type MoneyBDT = currency<"BDT", 18, 2>;
type MoneyUSD = currency<"USD", 18, 2>;

record Slot<T> {
  value: T;
  filled: bool;
}

record MergeResult {
  bdtOut: MoneyBDT;
  usdOut: MoneyUSD;
  idempotencyKey: string<36>;
}

file resultOutput sequential output record MergeResult status resultStatus;

function firstOr<T>(slot: Slot<T>, fallback: T): T {
  if slot.filled {
    return slot.value;
  } else {
    return fallback;
  }
}

entry transaction settle(
  bdtSlot: Slot<MoneyBDT>,
  usdSlot: Slot<MoneyUSD>,
  result: MergeResult,
) {
  bdtSlot.value = 11.00;
  bdtSlot.filled = true;
  usdSlot.value = 22.00;
  usdSlot.filled = true;

  result.bdtOut = firstOr(bdtSlot, 0.00);
  result.usdOut = firstOr(usdSlot, 0.00);

  open resultOutput;
  write resultOutput from result;
  close resultOutput;

  audit("SETTLED", result.idempotencyKey);
}
`;

/**
 * A Db2 enquiry that records which branch it took.
 *
 * The CICS example already exercises embedded SQL, but its result lands in a
 * COMMAREA that goes nowhere outside a region. This one writes the outcome to a
 * file, so a scripted SQLCODE can be shown to have selected a branch rather
 * than merely to have arrived.
 */
const SQL_SOURCE = `module EnquiryConformance;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
  rowStatus: string<8>;
}

record EnquiryResult {
  resultAccountId: string<16>;
  resultBalance: BDT;
  outcome: string<12>;
  idempotencyKey: string<36>;
}

sql fetchAccount(keyAccountId: string<16>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAccountId
}

file resultOutput sequential output record EnquiryResult status resultStatus;

entry transaction enquire(row: AccountRow, result: EnquiryResult) {
  execute fetchAccount("ACC-0000000001") into row;

  if sqlcode == 0 {
    result.outcome = "FOUND";
  } else {
    result.outcome = "NOT_FOUND";
  }

  result.resultAccountId = row.rowAccountId;
  result.resultBalance = row.rowBalance;

  open resultOutput;
  write resultOutput from result;
  close resultOutput;

  audit("ENQUIRY_DONE", result.idempotencyKey);
}
`;

const runner = hasCobc() ? describe : describe.skip;

function workDir(name: string): string {
  return join(tmpdir(), `banklang-conformance-${name}`);
}

interface Request {
  accountId: string;
  balance: number;
  minimumBalance: number;
  requested: number;
  idempotencyKey: string;
}

function run(name: string, request: Request) {
  const compiled = compile(SOURCE, { sourceFile: "main.bank.ts" });
  const requestLayout = layoutOf(compiled, "SavingsAccount");
  const resultLayout = layoutOf(compiled, "WithdrawalResult");

  const result = runConformance({
    source: SOURCE,
    sourceFile: "main.bank.ts",
    workDir: workDir(name),
    inputs: {
      REQUESTI: buildRecord(requestLayout, {
        "ACCOUNT-ID": request.accountId,
        BALANCE: request.balance,
        "IDEMPOTENCY-KEY": request.idempotencyKey,
        "MINIMUM-BALANCE": request.minimumBalance,
        REQUESTED: request.requested,
      }),
    },
    outputs: ["RESULTOU"],
  });

  return { result, resultLayout };
}

describe("packed decimal round trip", () => {
  // The harness seeds COMP-3 fields itself, so an error here would look like a
  // compiler defect. Pinning it separately keeps the two apart.
  it("encodes and decodes a positive amount", () => {
    expect(decodePacked(encodePacked(5000.5, 2, 10), 2)).toBe("5000.50");
  });

  it("encodes and decodes a negative amount", () => {
    expect(decodePacked(encodePacked(-12.34, 2, 10), 2)).toBe("-12.34");
  });

  it("keeps trailing zeros in the fraction", () => {
    expect(decodePacked(encodePacked(100, 2, 10), 2)).toBe("100.00");
  });
});

describe("record inheritance layout", () => {
  /**
   * The reason `extends` is worth having at all: a derived record starts with
   * the base record's exact bytes, so a copybook cut for the base still reads a
   * derived record correctly.
   */
  it("lays the base record's fields out first, byte for byte", () => {
    const compiled = compile(SOURCE, { sourceFile: "main.bank.ts" });
    const base = layoutOf(compiled, "CurrentAccount");
    const derived = layoutOf(compiled, "SavingsAccount");

    for (const field of base.entries) {
      const inherited = derived.entries.find(
        (entry) =>
          entry.path.slice(entry.path.indexOf(".")) ===
          field.path.slice(field.path.indexOf(".")),
      );
      expect(inherited).toBeDefined();
      expect(inherited?.offset).toBe(field.offset);
      expect(inherited?.bytes).toBe(field.bytes);
    }

    expect(derived.totalLength).toBeGreaterThan(base.totalLength);
  });
});

runner("executed against the reference runtime", () => {
  it("posts a permitted withdrawal and leaves the ledger balanced", () => {
    const { result, resultLayout } = run("permitted", {
      accountId: "ACC-0000000001",
      balance: 5000.0,
      minimumBalance: 500.0,
      requested: 1200.0,
      idempotencyKey: "IDEM-0001",
    });

    expect(result.exitCode).toBe(0);
    expect(result.journal).toEqual([
      "DEBIT ACC-0000000001 -1200.00",
      "CREDIT BRANCH-TILL 1200.00",
    ]);

    // The two postings are equal and opposite, so the ledger nets to zero.
    expect(result.balances.get("ACC-0000000001")).toBe("-1200.00");
    expect(result.balances.get("BRANCH-TILL")).toBe("1200.00");

    expect(result.auditLog).toEqual(["WITHDRAWAL_POSTED IDEM-0001"]);
  });

  it("writes the closing balance the arithmetic produced", () => {
    const { result, resultLayout } = run("closing-balance", {
      accountId: "ACC-0000000001",
      balance: 5000.0,
      minimumBalance: 500.0,
      requested: 1200.0,
      idempotencyKey: "IDEM-0001",
    });

    const record = result.outputs.get("RESULTOU") as Buffer;
    expect(readField(resultLayout, record, "ACCOUNT-ID")).toBe(
      "ACC-0000000001",
    );
    expect(readField(resultLayout, record, "PAID-OUT")).toBe("1200.00");
    expect(readField(resultLayout, record, "CLOSING-BALANCE")).toBe("3800.00");
  });

  /**
   * `ledgerBalanceOf` takes a `CurrentAccount` and is called with a
   * `SavingsAccount`. The closing balance being right is the proof that the
   * reference cell read the derived record's storage at the base's offsets.
   */
  it("reads a derived record through a parameter declared over the base", () => {
    const { result, resultLayout } = run("substitutability", {
      accountId: "ACC-0000000009",
      balance: 900.0,
      minimumBalance: 100.0,
      requested: 250.0,
      idempotencyKey: "IDEM-0009",
    });

    const record = result.outputs.get("RESULTOU") as Buffer;
    expect(readField(resultLayout, record, "CLOSING-BALANCE")).toBe("650.00");
  });

  /**
   * A function paragraph is reached with `PERFORM`, which returns at the end of
   * the paragraph on its own. Ending it with `GOBACK` compiled perfectly and
   * ended the whole program at the first function call, which only a run could
   * show: the transaction would emit no postings and still exit zero.
   */
  it("returns from a plain function instead of ending the program", () => {
    const { result } = run("perform-returns", {
      accountId: "ACC-0000000010",
      balance: 900.0,
      minimumBalance: 100.0,
      requested: 250.0,
      idempotencyKey: "IDEM-0010",
    });

    // Statements after the call all ran.
    expect(result.journal).toHaveLength(2);
    expect(result.auditLog).toEqual(["WITHDRAWAL_POSTED IDEM-0010"]);
    expect(result.outputs.get("RESULTOU")?.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * The behaviour the exception model exists for. `permittedAmount` raises
   * before any posting is made, so the failure path runs and nothing reaches
   * the ledger.
   */
  it("makes no posting when the guard raises before the debit", () => {
    const { result } = run("below-minimum", {
      accountId: "ACC-0000000002",
      balance: 800.0,
      minimumBalance: 500.0,
      requested: 700.0,
      idempotencyKey: "IDEM-0002",
    });

    expect(result.exitCode).toBe(0);
    expect(result.journal).toEqual(["ROLLBACK 0000"]);
    expect(result.balances.size).toBe(0);
    expect(result.auditLog).toEqual(["WITHDRAWAL_REJECTED IDEM-0002"]);
  });

  it("rejects a non-positive amount through the same path", () => {
    const { result } = run("non-positive", {
      accountId: "ACC-0000000003",
      balance: 900.0,
      minimumBalance: 0.0,
      requested: 0.0,
      idempotencyKey: "IDEM-0003",
    });

    expect(result.auditLog).toEqual(["WITHDRAWAL_REJECTED IDEM-0003"]);
    expect(result.journal).toEqual(["ROLLBACK 0000"]);
  });

  it("writes no result record when the transaction fails", () => {
    const { result } = run("no-output", {
      accountId: "ACC-0000000002",
      balance: 800.0,
      minimumBalance: 500.0,
      requested: 700.0,
      idempotencyKey: "IDEM-0002",
    });

    expect(result.outputs.get("RESULTOU")?.length ?? 0).toBe(0);
  });

  it("permits a withdrawal that lands exactly on the minimum balance", () => {
    const { result } = run("boundary", {
      accountId: "ACC-0000000004",
      balance: 1000.0,
      minimumBalance: 500.0,
      requested: 500.0,
      idempotencyKey: "IDEM-0004",
    });

    expect(result.auditLog).toEqual(["WITHDRAWAL_POSTED IDEM-0004"]);
    expect(result.balances.get("BRANCH-TILL")).toBe("500.00");
  });
});

runner("shared generic instantiations", () => {
  it("rebinds the shared paragraph's record cell at each call site", () => {
    const compiled = compile(SHARED_SOURCE, { sourceFile: "shared.bank.ts" });

    // One paragraph, reached twice with two different records.
    expect(compiled.program?.functions.map((fn) => fn.name)).toEqual([
      "firstOr$curBDT18_2",
    ]);

    const result = runConformance({
      source: SHARED_SOURCE,
      sourceFile: "shared.bank.ts",
      workDir: workDir("shared-instantiation"),
      outputs: ["RESULTOU"],
    });

    const layout = layoutOf(compiled, "MergeResult");
    const record = result.outputs.get("RESULTOU") as Buffer;
    expect(readField(layout, record, "BDT-OUT")).toBe("11.00");
    expect(readField(layout, record, "USD-OUT")).toBe("22.00");
  });
});

/**
 * The reference Db2 and CICS runtimes evaluate nothing: they replay outcomes a
 * test scripts. That is a real limit — a scripted SQLCODE 100 says nothing
 * about what Db2 would return for that query. What it does establish is the
 * half the generated program is responsible for: that the branch guarded by
 * `sqlcode == 0` or by a `resp` test is reached and taken, which until now was
 * inspected in the emitted COBOL rather than executed.
 */
runner("executed against the reference Db2 and CICS runtimes", () => {
  function runSql(name: string, sqlcode: number) {
    const compiled = compile(SQL_SOURCE, { sourceFile: "enquiry.bank.ts" });
    const result = runConformance({
      source: SQL_SOURCE,
      sourceFile: "enquiry.bank.ts",
      workDir: workDir(name),
      outputs: ["RESULTOU"],
      sqlOutcomes: sqlcode === 0 ? [] : [{ statement: 1, sqlcode }],
    });

    return {
      result,
      outcome: readField(
        layoutOf(compiled, "EnquiryResult"),
        result.outputs.get("RESULTOU") as Buffer,
        "OUTCOME",
      ),
    };
  }

  it("takes the found branch when the statement reports a row", () => {
    const { result, outcome } = runSql("sql-found", 0);

    expect(result.sqlCalls).toEqual(["SQL 0001 SQLCODE 0"]);
    expect(outcome).toBe("FOUND");
  });

  it("takes the not-found branch when the statement reports SQLCODE 100", () => {
    const { result, outcome } = runSql("sql-not-found", 100);

    expect(result.sqlCalls).toEqual(["SQL 0001 SQLCODE 100"]);
    expect(outcome).toBe("NOT_FOUND");
  });

  it("commits when every CICS command reports NORMAL", () => {
    const result = runConformance({
      source: CICS_SOURCE,
      sourceFile: "main.bank.ts",
      workDir: workDir("cics-normal"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.cicsCalls).toEqual([
      "CICS 0001 LINK RESP 0",
      "CICS 0002 SYNCPOINT RESP 0",
      "CICS 0003 RETURN RESP 0",
    ]);
  });

  /**
   * PGMIDERR on the LINK. The program's `linkResp == 0` test then has to select
   * the rollback, and the second command it issues is what proves it did.
   */
  it("rolls back when a CICS command reports a non-zero response", () => {
    const result = runConformance({
      source: CICS_SOURCE,
      sourceFile: "main.bank.ts",
      workDir: workDir("cics-pgmiderr"),
      cicsOutcomes: [{ call: 1, resp: 27 }],
    });

    expect(result.cicsCalls).toEqual([
      "CICS 0001 LINK RESP 27",
      "CICS 0002 SYNCPOINT ROLLBACK RESP 0",
      "CICS 0003 RETURN RESP 0",
    ]);
  });
});

/**
 * A cursor loop, executed.
 *
 * Statement 1 is the OPEN, 2 the FETCH, 3 the CLOSE — the DECLARE is read at
 * precompile time and takes no number. Scripting how many fetches succeed is
 * what makes the loop's own decisions observable: when it stops, whether it
 * closes, and whether the bound holds when the rows never run out.
 *
 * The runtime writes no host variables, so a fetched row arrives unchanged.
 * What is under test here is the shape the compiler generates, not the contents
 * of a row, which only a real Db2 could supply.
 */
runner("cursor loops executed against the reference Db2 runtime", () => {
  function runCursor(name: string, outcomes: SqlOutcome[]) {
    return runConformance({
      source: CURSOR_SOURCE,
      sourceFile: "main.bank.ts",
      workDir: workDir(name),
      outputs: ["SUMMARYO"],
      sqlOutcomes: outcomes,
    });
  }

  it("opens, fetches until the rows run out, and closes", () => {
    const result = runCursor("cursor-rows", [
      { statement: 2, sqlcode: 0, times: 3 },
      { statement: 2, sqlcode: 100 },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.sqlCalls).toEqual([
      "SQL 0001 SQLCODE 0",
      "SQL 0002 SQLCODE 0",
      "SQL 0002 SQLCODE 0",
      "SQL 0002 SQLCODE 0",
      "SQL 0002 SQLCODE 100",
      "SQL 0003 SQLCODE 0",
    ]);
  });

  it("still closes the cursor when it returns no rows at all", () => {
    const result = runCursor("cursor-empty", [{ statement: 2, sqlcode: 100 }]);

    expect(result.sqlCalls).toEqual([
      "SQL 0001 SQLCODE 0",
      "SQL 0002 SQLCODE 100",
      "SQL 0003 SQLCODE 0",
    ]);
    expect(result.journal).toEqual([]);
    expect(result.auditLog).toHaveLength(1);
  });

  /**
   * The reason the bound is mandatory. With every fetch succeeding, the loop
   * would run forever holding Db2 locks; the generated counter stops it at the
   * declared limit and the CLOSE still runs.
   */
  it("stops at the declared bound when the rows never run out", () => {
    const boundedSource = CURSOR_SOURCE.replace("limit 5000", "limit 4");
    const result = runConformance({
      source: boundedSource,
      sourceFile: "main.bank.ts",
      workDir: workDir("cursor-bounded"),
      outputs: ["SUMMARYO"],
      sqlOutcomes: [{ statement: 2, sqlcode: 0 }],
    });

    expect(
      result.sqlCalls.filter((call) => call.startsWith("SQL 0002")),
    ).toHaveLength(4);
    expect(result.sqlCalls.at(-1)).toBe("SQL 0003 SQLCODE 0");
  });

  /**
   * An error is not end of data. Treating one as the other would process a
   * partial result set as though it were the whole one, which is how a batch
   * silently under-posts.
   */
  it("leaves the loop on an error rather than treating it as the end", () => {
    const result = runCursor("cursor-error", [
      { statement: 2, sqlcode: 0, times: 2 },
      { statement: 2, sqlcode: -911, sqlstate: "40001" },
    ]);

    expect(result.sqlCalls).toEqual([
      "SQL 0001 SQLCODE 0",
      "SQL 0002 SQLCODE 0",
      "SQL 0002 SQLCODE 0",
      "SQL 0002 SQLCODE -911",
      "SQL 0003 SQLCODE 0",
    ]);
  });
});
