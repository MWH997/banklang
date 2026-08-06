import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { checked, corpus, flowed } from "./helpers";

/**
 * The endings that look like success.
 *
 * Each of these compiled, ran, and gave an answer nobody could tell from a
 * correct one. That is the class this compiler exists to prevent, and the
 * 2026-08-05 audit found four of them in code this repository ships.
 */

const PREAMBLE = `module Silent;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/**
 * A five-million-record master processed the first million, closed its files,
 * wrote its audit event and ended RC=0 — indistinguishable from a clean night.
 * The example carrying that loop said in its own comment that the bound "is
 * what stops a corrupt file spinning the job until the operator cancels it",
 * and then gave the safe case and the catastrophic case the same ending.
 */
describe("a loop stopped by its own bound", () => {
  const result = compile(`${PREAMBLE}
file accountInput sequential input record Account status accountInputStatus;

entry transaction post(account: Account) {
  open accountInput;
  while accountInputStatus == "00" limit 1000000 {
    read accountInput into account;
    if accountInputStatus == "00" {
      debit(account.accountId, account.balance);
      credit("CASH", account.balance);
    }
  }
  close accountInput;
  audit("POSTED", account.idempotencyKey);
}`);

  it("compiles", () => {
    expect(
      result.diagnostics.filter((entry) => entry.severity === "error"),
    ).toEqual([]);
  });

  it("fails the step rather than ending like a finished run", () => {
    const text = flowed(result.cobol);

    expect(text).toContain('LOOP LIMIT 1000000 REACHED, WORK UNFINISHED"');
    expect(text).toContain("MOVE 12 TO BANK-RETURN-CODE");
    expect(text).toContain('MOVE "BANK-LOOP-EXHAUSTED" TO BANK-FAILURE-CODE');
  });

  /**
   * The two exits are told apart exactly. A loop that ended because its own
   * condition went false is the ordinary case and says nothing; the counter
   * reaching the limit *while the condition still holds* is the bound stopping
   * work that had not finished.
   */
  it("says nothing when the condition is what ended it", () => {
    expect(flowed(result.cobol)).toMatch(
      /IF \S+ >= 1000000 AND \(ACCOUNT-INPUT-STATUS = "00"\)/,
    );
  });
});

/**
 * After AT END the record area is undefined on Enterprise COBOL. GnuCOBOL
 * leaves the last record sitting in the buffer, so a move out of it after a
 * read that found nothing reads the previous record and every local test
 * passes.
 */
describe("a read that found nothing", () => {
  const result = compile(`${PREAMBLE}
file accountInput sequential input record Account status accountInputStatus;

entry transaction post(account: Account) {
  open accountInput;
  read accountInput into account;
  close accountInput;
  audit("POSTED", account.idempotencyKey);
}`);

  it("copies the record only in the success phrase", () => {
    const text = flowed(result.cobol);

    expect(text).toContain(
      'AT END MOVE "10" TO ACCOUNT-INPUT-STATUS NOT AT END MOVE ACCOUNT-ID OF ACCOUNT-INPUT-RECORD',
    );
  });

  /** An indexed read reports a missing key, so its phrases are the other pair. */
  it("uses NOT INVALID KEY on a keyed read", () => {
    const keyed = compile(`${PREAMBLE}
file master indexed input record Account key accountId status masterStatus;

entry transaction post(account: Account) {
  open master;
  read master into account key "ACC-1";
  close master;
  audit("POSTED", account.idempotencyKey);
}`);

    expect(flowed(keyed.cobol)).toContain(
      'INVALID KEY MOVE "23" TO MASTER-STATUS NOT INVALID KEY MOVE ACCOUNT-ID OF MASTER-RECORD',
    );
  });
});

/**
 * `+100` is the only "not found". A `-911` deadlock, a `-904` resource that was
 * not available, or a `-805` package that was never bound became a successful
 * reply saying the account does not exist — and in the example that reply was
 * then committed.
 */
describe("a Db2 error", () => {
  const SQL = `${PREAMBLE}
record Row {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

sql fetchAccount(keyAccountId: string<16>): Row {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAccountId
}
`;

  it("is refused when only zero is tested", () => {
    const result = compile(`${SQL}
entry transaction post(row: Row, idempotencyKey: string<36>) {
  execute fetchAccount("ACC-1") into row;
  if sqlcode == 0 {
    audit("FOUND", idempotencyKey);
  } else {
    audit("MISSING", idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-007");
  });

  /** `!= 0` puts `+100` and `-911` on the same side, so it is not a branch. */
  it("is refused when the test cannot separate it from not-found", () => {
    const result = compile(`${SQL}
entry transaction post(row: Row, idempotencyKey: string<36>) {
  execute fetchAccount("ACC-1") into row;
  if sqlcode != 100 {
    audit("FOUND", idempotencyKey);
  } else {
    audit("MISSING", idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-SQL-007");
  });

  it("is accepted once a negative branch exists", () => {
    const result = compile(`${SQL}
entry transaction post(row: Row, idempotencyKey: string<36>) {
  execute fetchAccount("ACC-1") into row;
  if sqlcode < 0 {
    raise "DB2_FAILED";
  } else {
    if sqlcode == 0 {
      audit("FOUND", idempotencyKey);
    } else {
      audit("MISSING", idempotencyKey);
    }
  }
}`);

    expect(result.diagnostics).toEqual([]);
  });

  /**
   * A cursor loop leaves on any non-zero SQLCODE, which is right — but leaving
   * is not enough. A partial result set processed as though it were the whole
   * one is a settlement run that posted half a day and said it posted a day.
   */
  it("fails the step from inside a cursor loop", () => {
    const result = compile(`${PREAMBLE}
record Row {
  rowAccountId: string<16>;
  rowBalance: BDT;
}

cursor accountsInBranch(keyBranch: string<8>): Row {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}

entry transaction post(row: Row, branchId: string<8>, idempotencyKey: string<36>) {
  for each row in accountsInBranch(branchId) limit 5000 {
    debit(row.rowAccountId, row.rowBalance);
    credit("CASH", row.rowBalance);
  }
  audit("POSTED", idempotencyKey);
}`);
    const text = flowed(result.cobol);

    expect(
      result.diagnostics.filter((entry) => entry.severity === "error"),
    ).toEqual([]);
    expect(text).toContain("IF SQLCODE < 0");
    expect(text).toContain('MOVE "SQL-FETCH-FAILED" TO BANK-FAILURE-CODE');
    // The cursor is closed on the way out, so the failure does not leave locks
    // held; the register is what carries the failure past the CLOSE.
    expect(text.indexOf("CLOSE ACCOUNTS-IN-BRANCH")).toBeLessThan(
      text.lastIndexOf("IF BANK-FAILURE-CODE NOT = SPACES"),
    );
    expect(text).toMatch(/IF \S+ >= 5000 AND SQLCODE = 0/);
  });
});

/**
 * `IF LINK-RESP = 0` is a program that has hard-coded a number CICS never
 * promised. The API Reference names one value — a normal return is
 * `DFHRESP(NORMAL)` — and says the rest are tested "by means of DFHRESP".
 */
describe("a CICS response", () => {
  const CICS = `${PREAMBLE}
cics transaction enquire(account: Account) {
  link "AUDITLOG" commarea account resp linkResp;
`;

  it("is compared against the condition name", () => {
    const result = compile(`${CICS}
  if linkResp == 0 {
    audit("OK", account.idempotencyKey);
  } else {
    audit("FAILED", account.idempotencyKey);
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF LINK-RESP = DFHRESP(NORMAL)");
    expect(result.cobol).not.toContain("IF LINK-RESP = 0");
  });

  it("is refused against a number CICS gives no name to", () => {
    const result = compile(`${CICS}
  if linkResp == 27 {
    audit("MISSING", account.idempotencyKey);
  } else {
    audit("OK", account.idempotencyKey);
  }
}`);

    expect(ids(result)).toContain("BANK-CICS-004");
  });
});

/**
 * The endings that look like success, over every example.
 *
 * Each of these is an audit finding whose fix was proved on one program: F5 the
 * bound that reported RC=0, F6 the record area read after AT END, F7 the Db2
 * error that became "not found", F8 the CICS response compared against a
 * number. A property that only holds for the program a test wrote is not a
 * property of the compiler.
 */
describe("across the corpus", () => {
  it("compares a CICS response against DFHRESP, never a number", () => {
    let responses = 0;
    for (const { example, cobol } of corpus()) {
      responses += flowed(cobol).split("DFHRESP(NORMAL)").length - 1;
      const numeric = [
        ...flowed(cobol).matchAll(/IF \(?[A-Z0-9-]*RESP[A-Z0-9-]* = (-?\d+)/g),
      ];
      expect(
        numeric.map((match) => match[0]),
        `${example} compares a CICS response against a literal.`,
      ).toEqual([]);
    }

    // One, across twenty-three examples. That is thin for a rule the audit
    // raised as F8, and it is recorded in docs/audit-2026-08-06.md rather
    // than papered over with a floor the corpus does not meet.
    checked(responses, 1, "CICS response comparisons");
  });

  it("gives every bounded loop an exhausted branch", () => {
    let loops = 0;
    for (const { example, cobol } of corpus()) {
      const bounds = [
        ...flowed(cobol).matchAll(/PERFORM UNTIL ([A-Z][A-Z0-9-]*) >= (\d+)/g),
      ];
      loops += bounds.length;
      for (const [, counter = "", limit = ""] of bounds) {
        expect(
          flowed(cobol),
          `${example} bounds a loop at ${limit} and never tests ${counter} afterwards, so exhaustion ends the step as a success.`,
        ).toContain(`IF ${counter} >= ${limit}`);
      }
    }

    checked(loops, 10, "bounded loops");
  });

  it("reads a record area only in the success phrase", () => {
    let reads = 0;
    for (const { example, cobol } of corpus()) {
      const statements = [
        ...flowed(cobol).matchAll(/READ ([A-Z][A-Z0-9-]*)(.*?)END-READ/g),
      ];
      reads += statements.length;
      for (const [, file = "", body = ""] of statements) {
        // A copy *out of* the record area, which is what is undefined after AT
        // END. The `MOVE "10" TO ...-STATUS` the AT END phrase itself carries
        // is a move into the status field and is the point of the phrase.
        const copies = [...body.matchAll(/MOVE [A-Z0-9-]+ OF ([A-Z0-9-]+)/g)];
        const success = Math.max(
          body.indexOf("NOT AT END"),
          body.indexOf("NOT INVALID KEY"),
        );
        for (const copy of copies) {
          if (!copy[1]!.endsWith("-RECORD")) {
            continue;
          }
          expect(
            success !== -1 && copy.index > success,
            `${example} copies out of ${file}'s record area outside the success phrase.`,
          ).toBe(true);
        }
      }
    }

    checked(reads, 10, "READ statements");
  });
});
