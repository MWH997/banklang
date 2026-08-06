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

/**
 * A rowset fetch, and the last partial rowset it would be easy to drop.
 *
 * One `FETCH` per row is one crossing into Db2 per row. `WITH ROWSET
 * POSITIONING` and `FETCH ... FOR n ROWS` take n at a time into host-variable
 * arrays, which over a million rows is the difference between a million
 * crossings and fifty thousand.
 *
 * The trap is at the end. The Application Programming and SQL Guide: "when the
 * last row has been retrieved, the program must still process the rows in the
 * last rowset through that last row." `+100` arrives *with* the final partial
 * rowset, not after it, so leaving the loop where a single-row fetch would
 * silently drops up to one rowset of work off the end of every run.
 */
describe("a rowset cursor", () => {
  const source = (clause: string): string => `module Rowset;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record RunTotals {
  rowsSeen: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

cursor everyAccount(keyBranch: string<8>)${clause}: AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}

entry transaction walk(row: AccountRow, totals: RunTotals, branchId: string<8>) {
  for each row in everyAccount(branchId) limit 100000 {
    totals.rowsSeen = totals.rowsSeen + 1;
  }

  audit("WALKED", totals.idempotencyKey);
}
`;

  const rowset = compile(source(" rowset 20 "));

  it("compiles clean", () => {
    expect(rowset.diagnostics).toEqual([]);
  });

  it("declares the cursor WITH ROWSET POSITIONING", () => {
    expect(flowed(rowset.cobol)).toContain(
      "DECLARE EVERY-ACCOUNT CURSOR WITH ROWSET POSITIONING FOR",
    );
  });

  /**
   * One elementary item per column with its own `OCCURS`, which is what the
   * manual's syntax diagram for a COBOL host-variable array shows. A group with
   * the `OCCURS` on the group is a host structure array, which a multiple-row
   * FETCH does not take: Db2 answers `UNDECLARED HOST VARIABLE ARRAY`.
   */
  it("declares one host-variable array per column", () => {
    const cobol = flowed(rowset.cobol);
    expect(cobol).toContain(
      "05 EVERY-ACCOUNT-A-ROW-ACCOUNT-ID PIC X(16) OCCURS 20 TIMES.",
    );
    expect(cobol).toContain(
      "05 EVERY-ACCOUNT-A-ROW-BALANCE PIC S9(16)V99 COMP-3 OCCURS 20 TIMES.",
    );
  });

  it("fetches a rowset rather than a row", () => {
    expect(flowed(rowset.cobol)).toContain(
      "FETCH NEXT ROWSET FROM EVERY-ACCOUNT FOR 20 ROWS INTO :EVERY-ACCOUNT-A-ROW-ACCOUNT-ID, :EVERY-ACCOUNT-A-ROW-BALANCE",
    );
  });

  it("takes the row count from SQLERRD(3)", () => {
    expect(flowed(rowset.cobol)).toContain(
      "MOVE SQLERRD(3) TO EVERY-ACCOUNT-SET-ROWS",
    );
  });

  /** The property the whole feature turns on. */
  it("processes the last rowset before acting on the +100", () => {
    const cobol = flowed(rowset.cobol);
    const endOfRowset = cobol.indexOf("END-PERFORM");
    const hundred = cobol.indexOf("IF SQLCODE = 100");

    expect(endOfRowset).toBeGreaterThan(0);
    expect(hundred).toBeGreaterThan(endOfRowset);
  });

  it("still stops at the declared bound, inside a rowset", () => {
    expect(flowed(rowset.cobol)).toContain(
      "UNTIL EVERY-ACCOUNT-SET-IX > EVERY-ACCOUNT-SET-ROWS OR EVERY-ACCOUNT-ROWS >= 100000",
    );
  });

  it("leaves an ordinary cursor fetching one row at a time", () => {
    const single = compile(source(" "));

    // The module in this fixture is called `Rowset`, so the word is in the
    // PROGRAM-ID whatever the cursor does. The assertion is on the constructs.
    expect(single.cobol).not.toContain("WITH ROWSET POSITIONING");
    expect(single.cobol).not.toContain("SQLERRD(3)");
    expect(flowed(single.cobol)).toContain("FETCH EVERY-ACCOUNT INTO");
  });

  it("can be held and rowset at once", () => {
    const both = compile(source(" hold rowset 50 "));

    expect(both.diagnostics).toEqual([]);
    expect(flowed(both.cobol)).toContain(
      "DECLARE EVERY-ACCOUNT CURSOR WITH HOLD WITH ROWSET POSITIONING FOR",
    );
  });

  it("refuses a dimension outside what an OCCURS may be", () => {
    expect(
      compile(source(" rowset 40000 ")).diagnostics.map((entry) => entry.id),
    ).toContain("BANK-SYN-002");
  });
});

/**
 * The unit-of-work verbs, and the route around the rules attached to them.
 *
 * BankLang passes SQL through verbatim, so `LOCK TABLE`, `SAVEPOINT`,
 * `ROLLBACK TO SAVEPOINT` and an isolation clause all already work — but so did
 * a raw `COMMIT`, which skips `BANK-SQL-004`. The Application Programming and
 * SQL Guide: "IMS and CICS environments do not allow those SQL statements;
 * however, IMS and CICS do allow ROLLBACK TO SAVEPOINT."
 */
describe("SQL the language already carries", () => {
  const withStatement = (text: string): ReturnType<typeof compile> =>
    compile(`module Raw;

record Account {
  accountId: string<16>;
  idempotencyKey: string<36>;
}

sql doIt() {
  ${text}
}

entry transaction go(account: Account) {
  execute doIt();

  if sqlcode < 0 {
    raise "SQL_ERROR";
  }

  audit("DONE", account.idempotencyKey);
}
`);

  it("emits a LOCK TABLE as written", () => {
    const result = withStatement("LOCK TABLE ACCOUNT IN EXCLUSIVE MODE");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("LOCK TABLE ACCOUNT IN EXCLUSIVE MODE");
  });

  it("emits a savepoint as written", () => {
    const result = withStatement(
      "SAVEPOINT BEFORE_POSTING ON ROLLBACK RETAIN CURSORS",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("SAVEPOINT BEFORE_POSTING");
  });

  it("allows ROLLBACK TO SAVEPOINT, which CICS and IMS allow", () => {
    const result = withStatement("ROLLBACK TO SAVEPOINT BEFORE_POSTING");

    expect(result.diagnostics).toEqual([]);
  });

  it("refuses a raw COMMIT, which the language has a statement for", () => {
    expect(
      withStatement("COMMIT").diagnostics.map((entry) => entry.id),
    ).toContain("BANK-SQL-009");
  });

  it("refuses a raw ROLLBACK", () => {
    expect(
      withStatement("ROLLBACK").diagnostics.map((entry) => entry.id),
    ).toContain("BANK-SQL-009");
  });
});
