import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `date`, `time`, and `timestamp`, and the calendar arithmetic that goes with
 * them.
 *
 * Banking is dates: a value date is not a posting date, an accrual runs between
 * two of them, and a maturity is compared against today. Two things make this
 * more than a numeric field with a name. A date is nominally typed, so it
 * cannot be compared with an amount or with a plain integer that happens to
 * have eight digits. And date arithmetic goes through the COBOL intrinsics that
 * know the calendar, because adding one to 20260131 does not give the first of
 * February.
 */

const PREAMBLE = `module Dates;

type BDT = currency<"BDT", 18, 2>;

record Loan {
  accountId: string<16>;
  openedOn: date;
  maturesOn: date;
  cutoff: time;
  bookedAt: timestamp;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction accrue(loan: Loan) {
${body}
  audit("ACCRUED", loan.idempotencyKey);
}`);
}

describe("temporal storage", () => {
  /**
   * `PIC 9(8)` holding YYYYMMDD is the mainframe convention, and it is chosen
   * because in that layout ordinary numeric comparison is also chronological
   * comparison, and an ordinary sort is a chronological sort.
   */
  it("stores a date as PIC 9(8) YYYYMMDD", () => {
    const result = txn("");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("05  OPENED-ON            PIC 9(8).");
  });

  it("stores a time as PIC 9(6)", () => {
    expect(txn("").cobol).toContain("05  CUTOFF               PIC 9(6).");
  });

  /** X(26) is the Db2 host variable format for a TIMESTAMP column. */
  it("stores a timestamp as PIC X(26)", () => {
    expect(txn("").cobol).toContain("05  BOOKED-AT            PIC X(26).");
  });

  it("reports the temporal type and its length in the layout", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "Loan",
    );
    const openedOn = layout?.entries.find(
      (entry) => entry.path === "LOAN.OPENED-ON",
    );

    expect(openedOn?.type).toBe("date");
    expect(openedOn?.bytes).toBe(8);
    expect(openedOn?.usage).toBe("DISPLAY");
  });
});

describe("dates are nominally typed", () => {
  it("compares a date with a date", () => {
    const result = txn(`  if loan.maturesOn > loan.openedOn {
    audit("TERM", loan.idempotencyKey);
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF MATURES-ON OF LOAN > OPENED-ON OF LOAN");
  });

  it("refuses to compare a date with a time", () => {
    const result = txn(`  if loan.maturesOn > loan.cutoff {
    audit("TERM", loan.idempotencyKey);
  }`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("refuses to compare a date with a plain number", () => {
    const result = txn(`  if loan.maturesOn > 20260131 {
    audit("TERM", loan.idempotencyKey);
  }`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("calendar arithmetic", () => {
  /**
   * `today()` reads the clock through `FUNCTION CURRENT-DATE`, whose first
   * eight characters are the date. `NUMVAL` makes them a number the receiving
   * `PIC 9(8)` takes without relying on an alphanumeric-to-numeric move.
   */
  it("reads today from CURRENT-DATE", () => {
    const result = txn("  let runDate: date = today();");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE FUNCTION NUMVAL(FUNCTION CURRENT-DATE(1:8)) TO RUN-DATE",
    );
  });

  /**
   * The point of going through the intrinsics: thirty days after the 31st of
   * January is the 2nd of March, which addition on the stored digits would
   * never produce.
   */
  it("adds days through INTEGER-OF-DATE and DATE-OF-INTEGER", () => {
    const result = txn("  let grace: date = addDays(loan.maturesOn, 5);");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "FUNCTION DATE-OF-INTEGER(FUNCTION INTEGER-OF-DATE(MATURES-ON OF LOAN) + 5)",
    );
  });

  it("counts days between two dates", () => {
    const result = txn(
      "  let term: decimal<9, 0> = daysBetween(loan.openedOn, loan.maturesOn);",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "(FUNCTION INTEGER-OF-DATE(MATURES-ON OF LOAN) - FUNCTION INTEGER-OF-DATE(OPENED-ON OF LOAN))",
    );
  });

  it("rejects a fraction of a day", () => {
    const result = txn("  let grace: date = addDays(loan.maturesOn, 5.50);");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects counting days between things that are not dates", () => {
    const result = txn(
      "  let term: decimal<9, 0> = daysBetween(loan.openedOn, loan.balance);",
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects adding days to something that is not a date", () => {
    const result = txn("  let grace: date = addDays(loan.cutoff, 5);");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("takes no arguments for today", () => {
    const result = txn("  let runDate: date = today(loan.openedOn);");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});
