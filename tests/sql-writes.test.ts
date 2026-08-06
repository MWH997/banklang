import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol } from "./helpers";

/**
 * The Db2 profile writing rather than only reading.
 *
 * `INSERT`, `UPDATE`, and `DELETE` already worked, because a `sql` declaration
 * carries whatever statement was written. What was missing was ending a unit of
 * work, and updating the row a cursor is sitting on.
 */

const PREAMBLE = `module Writes;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record Request {
  branchId: string<8>;
  idempotencyKey: string<36>;
}

cursor accountsInBranch(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  FOR UPDATE OF BALANCE
}

sql zeroCurrentRow() {
  UPDATE ACCOUNT SET BALANCE = 0 WHERE CURRENT OF accountsInBranch
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string, kind = "entry"): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
${kind} transaction sweep(request: Request, row: AccountRow) {
${body}
  audit("SWEPT", request.idempotencyKey);
}`);
}

describe("writing statements", () => {
  it("carries an INSERT through unchanged", () => {
    const result = compile(`module Ins;

type BDT = currency<"BDT", 18, 2>;

record Posting {
  accountId: string<16>;
  amount: BDT;
  idempotencyKey: string<36>;
}

sql insertPosting(keyAccount: string<16>, keyAmount: BDT) {
  INSERT INTO POSTING (ACCOUNT_ID, AMOUNT) VALUES (:keyAccount, :keyAmount)
}

entry transaction post1(posting: Posting) {
  execute insertPosting(posting.accountId, posting.amount);

  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("POSTED", posting.idempotencyKey);
    } else {
      audit("REJECTED", posting.idempotencyKey);
    }
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(
      flowed(
        "INSERT INTO POSTING (ACCOUNT_ID, AMOUNT) VALUES (:INSERT-POSTING-H1, :INSERT-POSTING-H2)",
      ),
    );
  });
});

describe("the unit of work", () => {
  it("commits and rolls back in a batch program", () => {
    const committed = txn("  commit;");
    const backedOut = txn("  rollback;");

    expect(committed.diagnostics).toEqual([]);
    expect(backedOut.diagnostics).toEqual([]);
    expect(committed.cobol).toContain("COMMIT");
    expect(backedOut.cobol).toContain("ROLLBACK");
  });

  /**
   * CICS owns the syncpoint and commits Db2's work along with everything else,
   * so an EXEC SQL COMMIT there is not merely redundant — Db2 rejects it at run
   * time. This is what `BANK-SQL-004` was reserved for.
   */
  it("refuses a commit inside a CICS transaction", () => {
    expect(ids(txn("  commit;", "cics"))).toContain("BANK-SQL-004");
  });

  it("refuses a rollback inside a CICS transaction", () => {
    expect(ids(txn("  rollback;", "cics"))).toContain("BANK-SQL-004");
  });

  /** `rollback resp <status>` is the CICS command and stays available. */
  it("leaves the CICS rollback command alone", () => {
    const result = txn("  rollback resp backoutResp;", "cics");

    expect(ids(result)).not.toContain("BANK-SQL-004");
  });
});

describe("positioned update", () => {
  /**
   * The cursor a program declares has a COBOL name of its own. Without the
   * rewrite the update names a cursor Db2 has never heard of.
   */
  it("rewrites the cursor in WHERE CURRENT OF", () => {
    const result =
      txn(`  for each row in accountsInBranch(request.branchId) limit 1000 {
    execute zeroCurrentRow();

    if sqlcode < 0 {
      raise "DB2_FAILED";
    } else {
      if sqlcode == 0 {
        audit("ZEROED", request.idempotencyKey);
      } else {
        audit("SKIPPED", request.idempotencyKey);
      }
    }
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(
      flowed("WHERE CURRENT OF ACCOUNTS-IN-BRANCH"),
    );
  });

  it("leaves a name that is not a declared cursor alone", () => {
    const result = compile(
      `${PREAMBLE.replace("WHERE CURRENT OF accountsInBranch", "WHERE CURRENT OF someOtherCursor")}
entry transaction sweep(request: Request, row: AccountRow) {
  execute zeroCurrentRow();

  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("ZEROED", request.idempotencyKey);
    } else {
      audit("SKIPPED", request.idempotencyKey);
    }
  }
}`,
    );

    expect(flowed(result.cobol)).toContain(
      flowed("WHERE CURRENT OF someOtherCursor"),
    );
  });
});

describe("the step's condition code", () => {
  /**
   * How a batch job tells the next step's `COND=` what happened. Without it
   * every step reports success, and a job that found no records looks exactly
   * like one that processed a million.
   */
  it("carries the value out to RETURN-CODE", () => {
    const result = txn("  returnCode = 4;");
    const cobol = result.cobol ?? "";

    expect(result.diagnostics).toEqual([]);
    // Held in working storage while the program runs, because RETURN-CODE is a
    // shared special register and every call the program makes overwrites it
    // with the called program's own — a `returnCode = 4` followed by the audit
    // call used to reach the operating system as zero.
    expect(cobol).toContain("MOVE 4 TO BANK-RETURN-CODE");
    // It reaches the special register once, in `BANK-MAIN`, after everything
    // the program performs has returned — which is what makes the ordering a
    // property of the control flow rather than of where the line happens to
    // sit in the file.
    expect(cobol).toContain(
      [
        "           PERFORM SWEEP THRU SWEEP-EXIT",
        "           MOVE BANK-RETURN-CODE TO RETURN-CODE",
        "           GOBACK.",
      ].join("\n"),
    );
    expect(
      cobol.match(/MOVE BANK-RETURN-CODE TO RETURN-CODE/g) ?? [],
    ).toHaveLength(1);
  });

  it("rejects a fraction, which is not a condition code", () => {
    expect(ids(txn("  returnCode = 4.5;"))).toContain("BANK-TYPE-003");
  });

  /**
   * Run it, because this is a defect nothing about the source shows.
   *
   * `MOVE 8 TO RETURN-CODE` reads correctly and compiles. The Language
   * Reference says what happens next: "the RETURN-CODE special register in the
   * calling program is set to the value of the RETURN-CODE special register in
   * the called program". Every generated transaction ends by calling BANKAUDT,
   * so the operating system saw the audit program's zero and the job reported
   * success on a run the program had already condemned.
   */
  it.skipIf(
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status !== 0,
  )("reaches the operating system past the audit call", () => {
    // No embedded SQL here: this is about the return code, and plain cobc
    // cannot read an EXEC SQL block.
    const result = compile(`module Rc;

record Row { idempotencyKey: string<36>; }

entry transaction sweep(row: Row) {
  returnCode = 8;
  audit("SWEPT", row.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-rc-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );
    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    expect(spawnSync("./program", [], { cwd: dir }).status).toBe(8);
  });

  /** RETURN-CODE is a halfword; 0 to 4095 is what a COND= can test. */
  it("rejects a value outside the range RETURN-CODE holds", () => {
    expect(ids(txn("  returnCode = 9999;"))).toContain("BANK-TYPE-003");
  });
});
