import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

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

  if sqlcode == 0 {
    audit("POSTED", posting.idempotencyKey);
  } else {
    audit("REJECTED", posting.idempotencyKey);
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "INSERT INTO POSTING (ACCOUNT_ID, AMOUNT) VALUES (:INSERT-POSTING-H1, :INSERT-POSTING-H2)",
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

    if sqlcode == 0 {
      audit("ZEROED", request.idempotencyKey);
    } else {
      audit("SKIPPED", request.idempotencyKey);
    }
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("WHERE CURRENT OF ACCOUNTS-IN-BRANCH");
  });

  it("leaves a name that is not a declared cursor alone", () => {
    const result = compile(
      `${PREAMBLE.replace("WHERE CURRENT OF accountsInBranch", "WHERE CURRENT OF someOtherCursor")}
entry transaction sweep(request: Request, row: AccountRow) {
  execute zeroCurrentRow();

  if sqlcode == 0 {
    audit("ZEROED", request.idempotencyKey);
  } else {
    audit("SKIPPED", request.idempotencyKey);
  }
}`,
    );

    expect(result.cobol).toContain("WHERE CURRENT OF someOtherCursor");
  });
});

describe("the step's condition code", () => {
  /**
   * How a batch job tells the next step's `COND=` what happened. Without it
   * every step reports success, and a job that found no records looks exactly
   * like one that processed a million.
   */
  it("moves the value into RETURN-CODE", () => {
    const result = txn("  returnCode = 4;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE 4 TO RETURN-CODE");
  });

  it("rejects a fraction, which is not a condition code", () => {
    expect(ids(txn("  returnCode = 4.5;"))).toContain("BANK-TYPE-003");
  });

  /** RETURN-CODE is a halfword; 0 to 4095 is what a COND= can test. */
  it("rejects a value outside the range RETURN-CODE holds", () => {
    expect(ids(txn("  returnCode = 9999;"))).toContain("BANK-TYPE-003");
  });
});
