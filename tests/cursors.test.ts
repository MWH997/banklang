import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * Db2 cursors: a declaration that returns rows, and a bounded loop that reads
 * them.
 *
 * The loop is what makes a cursor safe to offer. `OPEN` and `CLOSE` are
 * generated around the body rather than written, so the cursor cannot be left
 * open, and the bound is mandatory, so a table nobody sized cannot hold a batch
 * window open indefinitely.
 */

const PREAMBLE = `module Cursors;

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
  ORDER BY ACCOUNT_ID
}
`;

/**
 * Errors only.
 *
 * `BANK-FILE-003` warns that a posting loop has no checkpoint, which is true of
 * these programs and is the point of the warning. It does not stop them
 * compiling, so a test about cursors asserts on what would.
 */
function errors(result: {
  diagnostics: { id: string; severity: string }[];
}): { id: string }[] {
  return result.diagnostics.filter((entry) => entry.severity === "error");
}

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/** A transaction that reads the cursor, with the given loop body. */
function txn(body: string, header = "limit 500"): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction accrue(request: Request, row: AccountRow) {
  for each row in accountsInBranch(request.branchId) ${header} {
${body}
  }

  audit("ACCRUED", request.idempotencyKey);
}`);
}

describe("cursor declarations", () => {
  /**
   * `DECLARE CURSOR` may not carry an INTO — Db2 puts the row's destination on
   * the FETCH, which is where the row actually arrives. Writing it on the
   * SELECT is how the query reads, so the compiler moves it.
   */
  it("declares the cursor without the INTO it was written with", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(errors(result)).toEqual([]);
    const cobol = result.cobol ?? "";
    // Located by the cursor's own name: `BEGIN DECLARE SECTION` also contains
    // the word, and the first `DECLARE` in the program is now that.
    const start = cobol.indexOf("DECLARE ACCOUNTS-IN-BRANCH");
    const declaration = cobol.slice(start, cobol.indexOf("END-EXEC", start));
    expect(declaration).toContain("DECLARE ACCOUNTS-IN-BRANCH CURSOR FOR");
    expect(declaration).toContain("SELECT ACCOUNT_ID, BALANCE");
    expect(declaration).not.toContain("INTO");
  });

  it("puts the INTO on the FETCH, bound to the row record", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(result.cobol).toContain("FETCH ACCOUNTS-IN-BRANCH");
    expect(flowed(result.cobol)).toContain(
      flowed(
        "INTO :ROW-ACCOUNT-ID OF ACCOUNT-ROW, :ROW-BALANCE OF ACCOUNT-ROW",
      ),
    );
  });

  it("binds a cursor parameter to its own host variable", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(result.cobol).toContain(
      "MOVE BRANCH-ID OF REQUEST TO ACCOUNTS-IN-BRANCH-H1",
    );
    expect(result.cobol).toContain("WHERE BRANCH_ID = :ACCOUNTS-IN-BRANCH-H1");
  });

  it("reports a cursor with no result record", () => {
    const result = compile(`module Cursors;

cursor everything() {
  SELECT ACCOUNT_ID INTO :rowAccountId FROM ACCOUNT
}

entry transaction touch(idempotencyKey: string<36>) {
  audit("TOUCHED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-SQL-006");
  });

  it("reports a cursor with no INTO clause", () => {
    const result = compile(`module Cursors;

record AccountRow {
  rowAccountId: string<16>;
}

cursor accounts(): AccountRow {
  SELECT ACCOUNT_ID FROM ACCOUNT
}

entry transaction touch(idempotencyKey: string<36>) {
  audit("TOUCHED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-SQL-006");
  });
});

describe("cursor loops", () => {
  it("opens before the loop and closes after it", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);
    const cobol = result.cobol ?? "";

    expect(cobol.indexOf("OPEN ACCOUNTS-IN-BRANCH")).toBeLessThan(
      cobol.indexOf("PERFORM UNTIL ACCOUNTS-IN-BRANCH-ROWS"),
    );
    expect(cobol.indexOf("END-PERFORM")).toBeLessThan(
      cobol.indexOf("CLOSE ACCOUNTS-IN-BRANCH"),
    );
  });

  /**
   * Leaving on any non-zero code rather than only on 100: an error treated as
   * end-of-data would process a partial result set as though it were the whole
   * one, which is exactly how a batch silently under-posts.
   */
  it("leaves the loop on any non-zero SQLCODE", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(result.cobol).toContain("IF SQLCODE NOT = 0");
    expect(result.cobol).toContain("EXIT PERFORM");
  });

  it("counts rows against the declared bound", () => {
    const result = txn(
      `    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`,
      "limit 250",
    );

    expect(result.cobol).toContain("01  ACCOUNTS-IN-BRANCH-ROWS");
    expect(result.cobol).toContain("MOVE 0 TO ACCOUNTS-IN-BRANCH-ROWS");
    expect(result.cobol).toContain(
      "PERFORM UNTIL ACCOUNTS-IN-BRANCH-ROWS >= 250",
    );
    expect(result.cobol).toContain("ADD 1 TO ACCOUNTS-IN-BRANCH-ROWS");
  });

  it("requires a bound", () => {
    const result = txn(
      `    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`,
      "",
    );

    expect(ids(result)).toContain("BANK-TXN-004");
  });

  it("rejects a bound that is not a positive whole number", () => {
    const result = txn(
      `    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`,
      "limit 0",
    );

    expect(ids(result)).toContain("BANK-TXN-004");
  });

  /**
   * The loop tests SQLCODE itself to decide when the rows have run out, so it
   * does not put the body under BANK-SQL-001. An `execute` in the body still
   * does: that outcome is the author's to interpret.
   */
  it("does not demand a SQLCODE test of its own", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(ids(result)).not.toContain("BANK-SQL-001");
  });

  it("fetches into a record of the declared result type", () => {
    const result = compile(`${PREAMBLE}
entry transaction accrue(request: Request, row: Request) {
  for each row in accountsInBranch(request.branchId) limit 500 {
    audit("ROW", request.idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-003");
  });

  it("checks the cursor's arguments", () => {
    const result = compile(`${PREAMBLE}
entry transaction accrue(request: Request, row: AccountRow) {
  for each row in accountsInBranch(request.idempotencyKey) limit 500 {
    audit("ROW", request.idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-003");
  });
});

describe("cursors and statements are not interchangeable", () => {
  it("rejects executing a cursor", () => {
    const result = compile(`${PREAMBLE}
entry transaction accrue(request: Request, row: AccountRow) {
  execute accountsInBranch(request.branchId) into row;

  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("ROW", request.idempotencyKey);
    } else {
      audit("NONE", request.idempotencyKey);
    }
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-005");
  });

  it("rejects iterating a single-row statement", () => {
    const result = compile(`module Cursors;

record AccountRow {
  rowAccountId: string<16>;
}

sql oneAccount(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID INTO :rowAccountId FROM ACCOUNT WHERE BRANCH_ID = :keyBranch
}

entry transaction accrue(row: AccountRow, idempotencyKey: string<36>) {
  for each row in oneAccount("BR-01") limit 500 {
    audit("ROW", idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-005");
  });
});

describe("banking checks see inside loops", () => {
  /**
   * `flattenStatements` descended only into `if`, so a transaction whose only
   * posting was inside a loop had, as far as the double-entry check could see,
   * no postings at all — and balanced trivially.
   */
  it("reports an unbalanced posting made inside a cursor loop", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);`);

    expect(ids(result)).toContain("BANK-LED-001");
  });

  it("reports an unbalanced posting made inside a while loop", () => {
    const result = compile(`module Drain;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

entry transaction drain(account: Account) {
  let count: decimal<9, 0> = 0;

  while count < 3 limit 10 {
    debit(account.accountId, account.balance);
    count = count + 1;
  }

  audit("DRAINED", account.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-LED-001");
  });

  it("accepts a balanced posting made inside a cursor loop", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(errors(result)).toEqual([]);
  });
});

/**
 * `WITH HOLD`, and the commit that closes a cursor without it.
 *
 * Db2's Application Programming and SQL Guide: "A held cursor does not close
 * after a commit operation. A cursor that is not held closes after a commit
 * operation." A long batch has to commit inside its own loop — otherwise the
 * log fills and the locks accumulate until nothing else can read the table —
 * and the next `FETCH` over a closed cursor answers `-501`, having already
 * processed and committed part of the result set.
 */
describe("a held cursor", () => {
  const program = (hold: string, commit: string): string => `module Held;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record RunTotals {
  rowsSeen: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

cursor everyAccount(keyBranch: string<8>)${hold}: AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}

entry transaction walk(row: AccountRow, totals: RunTotals, branchId: string<8>) {
  for each row in everyAccount(branchId) limit 100000 {
    totals.rowsSeen = totals.rowsSeen + 1;
${commit}
  }

  audit("WALKED", totals.idempotencyKey);
}
`;

  it("declares WITH HOLD", () => {
    const result = compile(program(" hold ", "    commit;"));

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "DECLARE EVERY-ACCOUNT CURSOR WITH HOLD FOR",
    );
  });

  it("leaves the clause off when the cursor is not held", () => {
    const result = compile(
      program(" ", "    totals.rowsSeen = totals.rowsSeen;"),
    );

    expect(result.cobol).toContain("DECLARE EVERY-ACCOUNT CURSOR FOR");
    expect(result.cobol).not.toContain("WITH HOLD");
  });

  it("refuses a commit inside a loop over a cursor that is not held", () => {
    const ids = compile(program(" ", "    commit;")).diagnostics.map(
      (entry) => entry.id,
    );

    expect(ids).toContain("BANK-SQL-008");
  });

  it("allows the same commit when the cursor is held", () => {
    const ids = compile(program(" hold ", "    commit;")).diagnostics.map(
      (entry) => entry.id,
    );

    expect(ids).not.toContain("BANK-SQL-008");
  });

  /** A commit after the loop closes a cursor that is already closed. */
  it("allows a commit outside the loop either way", () => {
    const result = compile(`module Held2;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record RunTotals {
  rowsSeen: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

cursor everyAccount(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}

entry transaction walk(row: AccountRow, totals: RunTotals, branchId: string<8>) {
  for each row in everyAccount(branchId) limit 100000 {
    totals.rowsSeen = totals.rowsSeen + 1;
  }

  commit;
  audit("WALKED", totals.idempotencyKey);
}
`);

    expect(result.diagnostics).toEqual([]);
  });
});
