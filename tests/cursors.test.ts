import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { formatBankTs } from "../packages/formatter/src/index";
import { flowed, unpadded } from "./helpers";

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
   * `DECLARE CURSOR` may not carry an INTO, since Db2 puts the row's destination on
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
   * no postings at all, and balanced trivially.
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
 * operation." A long batch has to commit inside its own loop, because otherwise the
 * log fills and the locks accumulate until nothing else can read the table,
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

  /**
   * A rollback is not a commit, and `hold` does not save it.
   *
   * The Application Programming and SQL Guide: "A ROLLBACK statement closes all
   * open cursors. A COMMIT statement ... closes cursors that are not declared
   * WITH HOLD and leaves open those cursors that are declared WITH HOLD." The
   * CICS section says it again: "SYNCPOINT ROLLBACK closes all cursors".
   *
   * This pair exists because mutation testing found it. Replacing
   * `operation === "commit"` with `true` in the rule survived the whole suite,
   * which meant nothing distinguished the two verbs, and the correct answer
   * turned out to be that the rule was too narrow rather than the test.
   */
  it("refuses a rollback inside the loop even when the cursor is held", () => {
    const ids = compile(program(" hold ", "    rollback;")).diagnostics.map(
      (entry) => entry.id,
    );

    expect(ids).toContain("BANK-SQL-008");
  });

  it("says a rollback closes every cursor, not just an unheld one", () => {
    const message = compile(
      program(" hold ", "    rollback;"),
    ).diagnostics.find((entry) => entry.id === "BANK-SQL-008");

    expect(message?.message).toContain("rolled back");
    expect(message?.hint).toContain("held or not");
  });

  it("refuses a rollback over an unheld cursor too", () => {
    const ids = compile(program(" ", "    rollback;")).diagnostics.map(
      (entry) => entry.id,
    );

    expect(ids).toContain("BANK-SQL-008");
  });

  /** Neither verb in the loop is the ordinary case, and it stays clean. */
  it("allows a loop that ends no unit of work", () => {
    expect(
      compile(program(" ", "    totals.rowsSeen = totals.rowsSeen;"))
        .diagnostics,
    ).toEqual([]);
  });

  /**
   * A checkpoint is a commit, and this rule could not see one.
   *
   * `examples/branch-accrual-cursor` posts to the ledger inside a cursor loop
   * and warned about having no restart position, so it was given a checkpoint. Adding one produced `EXEC SQL COMMIT` inside a loop over a cursor
   * with no `WITH HOLD`: a program that binds, processes and commits part of a
   * result set, and then abends `-501` on the fetch after its first commit,
   * with every local check green. This rule existed and was looking at the
   * wrong statement.
   *
   * `emitCheckpointStatement` writes the `COMMIT` under `commitsSql`, and the
   * rule reads the same flag. A checkpoint in a program with no SQL at all
   * writes a position and commits nothing, which is why the flag rather than
   * the statement kind is what decides.
   */
  const checkpointing = (hold: string): string => `module CheckpointedCursor;

type BDT = currency<"BDT", 18, 2>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

record RunTotals {
  rowsSeen: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

record RestartPoint {
  jobName: string<8>;
  lastAccountId: string<16>;
}

cursor everyAccount(keyBranch: string<8>)${hold}: AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}

file restartFile indexed update record RestartPoint key jobName status restartStatus;

entry transaction walk(row: AccountRow, totals: RunTotals, point: RestartPoint, branchId: string<8>) {
  open restartFile;
  point.jobName = "WALK";

  restart restartFile into point {
    log "RESUMING";
  } else {
    log "TOP";
  }

  for each row in everyAccount(branchId) limit 100000 {
    totals.rowsSeen = totals.rowsSeen + 1;
    debit(row.rowAccountId, row.rowBalance);
    credit("INTEREST-EXPENSE", row.rowBalance);
    point.lastAccountId = row.rowAccountId;
    checkpoint restartFile from point every 1000;
  }

  close restartFile;
  audit("WALKED", totals.idempotencyKey);
}
`;

  it("refuses a checkpoint inside a loop over a cursor that is not held", () => {
    const found = compile(checkpointing(" ")).diagnostics.find(
      (entry) => entry.id === "BANK-SQL-008",
    );

    expect(found).toBeDefined();
    expect(found?.severity).toBe("error");
    expect(found?.message).toContain("committed by a checkpoint");
    expect(found?.hint).toContain("`hold`");
  });

  it("allows the same checkpoint when the cursor is held", () => {
    const result = compile(checkpointing(" hold "));

    expect(result.diagnostics.map((entry) => entry.id)).not.toContain(
      "BANK-SQL-008",
    );
    // And the `COMMIT` really is inside the loop, which is what makes the
    // absence of the diagnostic mean something.
    const body = result.cobol!.slice(
      result.cobol!.indexOf("PERFORM UNTIL EVERY-ACCOUNT-ROWS"),
      result.cobol!.indexOf("END-PERFORM"),
    );
    expect(body).toContain("EXEC SQL COMMIT END-EXEC");
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
 * `ROLLBACK TO SAVEPOINT` and an isolation clause all already work, and so did
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

/* ------------------------------------------------------------------ *
 * Scrollable cursors.
 * ------------------------------------------------------------------ */

/**
 * Reading a result set from somewhere other than the beginning.
 *
 * A forward-only cursor goes one way, once, which is right for a batch and
 * wrong for the other thing a bank does with a query: a statement screen
 * showing rows 41 to 60, and the same program showing 21 to 40 when the user
 * presses PF7. That needs `SCROLL` on the `DECLARE` and a fetch orientation on
 * the `FETCH`, and the compiler writes both of those, so it needed syntax
 * rather than something to pass through.
 *
 * None of this has been run against Db2. What is asserted is the text, against
 * the SQL Reference, the same standard of evidence as everything else here
 * that a precompiler would see before a compiler does.
 */

const SCROLL_PREAMBLE = `module Statement;

type BDT = currency<"BDT", 18, 2>;

record TxnRow {
  rowTxnId: string<20>;
  rowAmount: BDT;
}

record Request {
  accountId: string<16>;
  firstRow: decimal<9, 0>;
  idempotencyKey: string<36>;
}
`;

/** A program with one scrollable cursor and one loop over it. */
function scrolled(
  header: string,
  declaration = "scroll",
): ReturnType<typeof compile> {
  return compile(`${SCROLL_PREAMBLE}
cursor statementPage(keyAccount: string<16>) ${declaration} : TxnRow {
  SELECT TXN_ID, AMOUNT
  INTO :rowTxnId, :rowAmount
  FROM TRANSACTION
  WHERE ACCOUNT_ID = :keyAccount
  ORDER BY POSTED_AT
}

entry transaction showPage(request: Request, row: TxnRow) {
  for each row in statementPage(request.accountId) ${header} {
    audit("STMT-PAGE", row.rowTxnId);
  }
}`);
}

describe("a cursor declared scrollable", () => {
  /**
   * `INSENSITIVE` is written, not left to Db2.
   *
   * Db2's default is `ASENSITIVE`, which resolves to insensitive or to
   * sensitive dynamic depending on the statement, so the same source could
   * page over a fixed result set or over one changing underneath, decided per
   * query. A reader seeing the same transaction on two pages, or never seeing
   * it, is not detectable from inside the program.
   */
  it("fixes the result set at OPEN rather than taking Db2's default", () => {
    const result = scrolled("from request.firstRow limit 20");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain(
      "DECLARE STATEMENT-PAGE INSENSITIVE SCROLL CURSOR FOR",
    );
  });

  it("writes SCROLL before CURSOR and WITH HOLD after it", () => {
    // The SQL Reference's order, which is not the order the language reads
    // them in: `cursor x(...) hold scroll` is one line of BankTS and two
    // clauses on opposite sides of the word CURSOR.
    const result = scrolled("from request.firstRow limit 20", "hold scroll");

    expect(errors(result)).toEqual([]);
    // Both clauses do not fit one fixed-format line, so the emitter continues
    // it, which is why this compares the flowed text rather than the raw.
    expect(flowed(result.cobol)).toContain(
      flowed("DECLARE STATEMENT-PAGE INSENSITIVE SCROLL CURSOR WITH HOLD FOR"),
    );
  });

  it("leaves an ordinary cursor exactly as it was", () => {
    const result = txn(`    debit(row.rowAccountId, row.rowBalance);
    credit("SUSPENSE", row.rowBalance);`);

    expect(result.cobol).toContain("DECLARE ACCOUNTS-IN-BRANCH CURSOR FOR");
    expect(result.cobol).not.toContain("SCROLL");
    expect(result.cobol).not.toContain("-POS");
  });

  /**
   * Declaring a cursor scrollable is not reading it scrollably. A `for each`
   * with no `from` and no `backward` is still a forward scan, and `FETCH NEXT`
   * is what a forward scan should emit whatever the cursor allows.
   */
  it("still fetches forward when the loop asks for nothing else", () => {
    const result = scrolled("limit 20");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("FETCH STATEMENT-PAGE");
    expect(result.cobol).not.toContain("ABSOLUTE");
  });

  it("declares its position as a host variable Db2 can read", () => {
    const result = scrolled("from request.firstRow limit 20");
    const cobol = result.cobol ?? "";

    // Signed fullword binary: Db2's INTEGER, and signed because a negative
    // position counts back from the last row.
    expect(unpadded(cobol)).toContain("01 STATEMENT-PAGE-POS PIC S9(9) COMP.");

    // Inside the declare section, unlike the row counter, which is the
    // program's own and would be described to Db2 as a host variable if it
    // were in there.
    const open = cobol.indexOf("BEGIN DECLARE SECTION");
    const close = cobol.indexOf("END DECLARE SECTION");
    expect(cobol.indexOf("STATEMENT-PAGE-POS")).toBeGreaterThan(open);
    expect(cobol.indexOf("STATEMENT-PAGE-POS")).toBeLessThan(close);
    expect(cobol.indexOf("STATEMENT-PAGE-ROWS")).toBeGreaterThan(close);
  });
});

describe("where a scrolled loop starts, and which way it goes", () => {
  it("starts at the row `from` names and walks forward", () => {
    const result = scrolled("from request.firstRow limit 20");
    const cobol = flowed(result.cobol);

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE FIRST-ROW OF REQUEST TO STATEMENT-PAGE-POS",
    );
    expect(cobol).toContain(
      flowed("FETCH ABSOLUTE :STATEMENT-PAGE-POS FROM STATEMENT-PAGE"),
    );
    expect(result.cobol).toContain("ADD 1 TO STATEMENT-PAGE-POS");
  });

  /**
   * `backward` with no `from` begins at -1.
   *
   * The SQL Reference counts a negative `ABSOLUTE` from the end, so -1 is the
   * last row, which means the program reads the most recent rows without
   * knowing, or asking Db2, how many there are.
   */
  it("starts at the last row when told to go backward from nowhere", () => {
    const result = scrolled("backward limit 5");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("MOVE -1 TO STATEMENT-PAGE-POS");
    expect(result.cobol).toContain("SUBTRACT 1 FROM STATEMENT-PAGE-POS");
    expect(result.cobol).not.toContain("ADD 1 TO STATEMENT-PAGE-POS");
  });

  it("takes both, which is a page read in reverse", () => {
    const result = scrolled("from request.firstRow backward limit 20");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE FIRST-ROW OF REQUEST TO STATEMENT-PAGE-POS",
    );
    expect(result.cobol).toContain("SUBTRACT 1 FROM STATEMENT-PAGE-POS");
  });

  /**
   * Every way the loop ends is Db2's answer rather than arithmetic here.
   *
   * Past the last row, `ABSOLUTE` answers +100. Going backward off the front,
   * the position reaches 0, which the SQL Reference defines as before the first
   * row, also +100. So the existing exit on a non-zero SQLCODE covers both,
   * and there is no row count to get wrong.
   */
  it("leaves on Db2's answer, not on a computed end", () => {
    const result = scrolled("backward limit 5");
    const cobol = result.cobol ?? "";
    const loop = cobol.slice(
      cobol.indexOf("PERFORM UNTIL STATEMENT-PAGE-ROWS"),
      cobol.indexOf("END-PERFORM"),
    );

    expect(loop).toContain("IF SQLCODE NOT = 0");
    expect(loop).toContain("EXIT PERFORM");
    // Nothing in the loop compares the position against a count of rows.
    expect(loop).not.toMatch(/STATEMENT-PAGE-POS\s*[<>]/);
  });

  it("steps the position before the body, not after it", () => {
    // A `raise` in the body abandons the rest of it. Stepping afterwards would
    // leave the position on the row that was just read, so a restart would
    // process it twice.
    const result = scrolled("from request.firstRow limit 20");
    const cobol = result.cobol ?? "";

    expect(cobol.indexOf("ADD 1 TO STATEMENT-PAGE-POS")).toBeLessThan(
      cobol.indexOf('MOVE "STMT-PAGE"'),
    );
  });
});

describe("what a scrollable cursor refuses", () => {
  it("refuses `from` on a cursor that is not scrollable", () => {
    // Db2 takes the DECLARE and rejects the FETCH, so without this the program
    // compiles here and fails at bind.
    const result = scrolled("from request.firstRow limit 20", "");

    expect(ids(result)).toContain("BANK-SQL-010");
  });

  it("refuses `backward` on a cursor that is not scrollable", () => {
    expect(ids(scrolled("backward limit 5", ""))).toContain("BANK-SQL-010");
  });

  it("reports each of them, at the word that asked for it", () => {
    const result = scrolled("from request.firstRow backward limit 20", "");
    const reported = result.diagnostics.filter(
      (entry) => entry.id === "BANK-SQL-010",
    );

    expect(reported).toHaveLength(2);
    expect(reported.map((entry) => entry.message)).toEqual([
      expect.stringContaining("`from`"),
      expect.stringContaining("`backward`"),
    ]);
  });

  /**
   * A rowset fetch on a scrollable cursor is a real Db2 statement (`FETCH
   * ROWSET STARTING AT ABSOLUTE n`) and a different one from what this emits.
   * Refused on the declaration rather than at the loop, so a cursor declared
   * both ways and never read is still caught.
   */
  it("refuses a cursor declared both scroll and rowset", () => {
    const result = scrolled("limit 20", "scroll rowset 10");

    expect(ids(result)).toContain("BANK-SQL-011");
  });

  it("refuses it even where nothing reads the cursor", () => {
    const result = compile(`${SCROLL_PREAMBLE}
cursor statementPage(keyAccount: string<16>) scroll rowset 10 : TxnRow {
  SELECT TXN_ID, AMOUNT
  INTO :rowTxnId, :rowAmount
  FROM TRANSACTION
  WHERE ACCOUNT_ID = :keyAccount
}

entry transaction showPage(request: Request) {
  audit("STMT-PAGE", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-SQL-011");
  });

  it("refuses a start position that is not a whole number", () => {
    // `FETCH ABSOLUTE` takes an integer host variable. A scaled decimal there
    // is -301 from the precompiler, not a rounded row number.
    expect(ids(scrolled("from request.accountId limit 20"))).toContain(
      "BANK-TYPE-003",
    );
  });

  it("accepts an integer literal as the start", () => {
    const result = scrolled("from 41 limit 20");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("MOVE 41 TO STATEMENT-PAGE-POS");
  });
});

describe("the words scroll, from and backward", () => {
  /**
   * Contextual, like `limit`. Making them reserved would break every existing
   * program with a field called `from`, which for a transfer record is the
   * obvious name for one.
   */
  it("stay usable as field names", () => {
    const result = compile(`module Contextual;

record Transfer {
  from: string<16>;
  backward: string<4>;
  scroll: string<4>;
}

entry transaction move(transfer: Transfer, idempotencyKey: string<36>) {
  audit("MOVED", transfer.from);
}`);

    expect(errors(result)).toEqual([]);
  });
});

/**
 * The formatter, which is the only thing here that has to write the syntax back
 * out.
 *
 * A clause the printer does not know about is not a formatting bug. It is data
 * loss. `pnpm fmt` rewrites every example in place, so a dropped `scroll` would
 * turn a scrollable cursor into a forward-only one in the source, silently, and
 * the next compile would be a `BANK-SQL-010` nobody wrote.
 */
describe("printing a scrollable cursor back out", () => {
  it("keeps every clause, in the order the parser reads them", () => {
    const source = `module Statement;

record TxnRow {
  rowTxnId: string<20>;
}

record Request {
  accountId: string<16>;
  firstRow: decimal<9, 0>;
  idempotencyKey: string<36>;
}

cursor statementPage(keyAccount: string<16>) hold scroll: TxnRow {
  SELECT TXN_ID INTO :rowTxnId FROM TRANSACTION WHERE ACCOUNT_ID = :keyAccount
}

entry transaction showPage(request: Request, row: TxnRow) {
  for each row in statementPage(request.accountId) from request.firstRow backward limit 20 {
    audit("PAGE", row.rowTxnId);
  }
}
`;

    const formatted = formatBankTs(source);
    expect(formatted.diagnostics).toEqual([]);
    // Already formatted, so the printer reproduced it exactly, which is the
    // whole assertion. Anything dropped would show as a change.
    expect(formatted.unchanged).toBe(true);
    expect(formatBankTs(formatted.text).text).toBe(formatted.text);
  });
});
