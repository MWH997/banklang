/**
 * BankTS programs that reproduce a real COBOL defect, and are refused.
 *
 * The rule this file exists to satisfy: *do not claim BankLang prevents a
 * defect unless there is a compile-time or executable test demonstrating it*.
 * Every entry below is a minimal BankTS program written from the OpenCBS
 * defect it names, together with the diagnostic the compiler must produce.
 * `tests/horizontal-defects.test.ts` compiles each one and fails if the
 * diagnostic changes, disappears, or the program starts compiling.
 *
 * So the defect-coverage matrix is not a table of aspirations. A row saying
 * `prevented-at-compile-time` is backed by a program in this file that the
 * compiler refused when the suite last ran.
 *
 * Two honest categories sit beside it. `not-expressible-in-bankts` is
 * prevention by absence — BankTS has no pointer type, so the four pointer
 * defects cannot be written — which is real but is not cleverness, and is
 * counted separately so nobody adds it to a safety score. `outside-banklang-model`
 * is for defects about how COBOL source is written or compiled, which a code
 * generator makes unavailable as a side effect rather than as a guarantee.
 *
 * The BankTS here was written from each defect's own description — the banner
 * comment naming what went wrong and why. It is not a translation of the
 * upstream COBOL, which would prove nothing about whether the *defect* is
 * caught.
 */

import type { DefectCoverage } from "./defects";

export interface DefectDemonstration {
  /** The OpenCBS case this reproduces, e.g. `DF36`. */
  defect: string;
  /** What the upstream defect was, in this repository's own words. */
  summary: string;
  coverage: DefectCoverage;
  /**
   * The BankTS that reproduces the defect's shape.
   *
   * Null when the coverage is `not-expressible-in-bankts` for a reason that is
   * about a missing *type* rather than a rejected program — there is nothing to
   * write down when the construct has no syntax at all. Those entries name the
   * absent construct in `expectDiagnostic` instead.
   */
  source: string | null;
  /**
   * The diagnostic id the compiler must produce.
   *
   * Asserted exactly. A defect this repository claims to catch, that starts
   * being caught by a different rule, is a change worth noticing: it may mean
   * the rule that used to catch it stopped working.
   */
  expectDiagnostic: string;
}

export const DEFECT_DEMONSTRATIONS: DefectDemonstration[] = [
  {
    defect: "DF01",
    summary:
      "A read whose end-of-file outcome was only handled inside the AT END branch, so the record area was used again after the file ran out — the last record processed twice, with a return code of zero.",
    coverage: "prevented-at-compile-time",
    source: `module Df01;

record Trans {
  trAccount: string<16>;
  trAmount: zoned<11, 2>;
  idempotencyKey: string<36>;
}

file transIn sequential input record Trans status transInStatus;

entry transaction applyOne(trans: Trans) {
  open transIn;
  read transIn into trans;
  // No test of transInStatus. At end of file the record area still holds the
  // record before it, and this posts it a second time.
  debit(trans.trAccount, trans.trAmount);
  credit("SUSPENSE", trans.trAmount);
  close transIn;
  audit("APPLIED", trans.idempotencyKey);
}
`,
    // The outcome the generated status check deliberately lets through — 10 is
    // the answer to "was there another record", not a failure — has to be
    // looked at before the record it left behind is used.
    expectDiagnostic: "BANK-FILE-017",
  },
  {
    defect: "DF01",
    summary:
      "The same read with the status printed rather than branched on, which is how the defect survives a code review: the answer is in the job log and the program carried on regardless.",
    coverage: "prevented-at-compile-time",
    source: `module Df01Logged;

record Trans {
  trAccount: string<16>;
  trAmount: zoned<11, 2>;
  idempotencyKey: string<36>;
}

file transIn sequential input record Trans status transInStatus;

entry transaction applyOne(trans: Trans) {
  open transIn;
  read transIn into trans;
  log "TRANSIN STATUS ", transInStatus;
  debit(trans.trAccount, trans.trAmount);
  credit("SUSPENSE", trans.trAmount);
  close transIn;
  audit("APPLIED", trans.idempotencyKey);
}
`,
    expectDiagnostic: "BANK-FILE-017",
  },
  {
    defect: "DF36",
    summary:
      "An average rate computed as (a / b) * 100 rather than (a * 100) / b, so the division truncated before the multiply could restore the magnitude, and the stored rate was wrong.",
    coverage: "prevented-at-compile-time",
    source: `module Df36;

type Big = decimal<16, 2>;
type Rate = decimal<3, 2>;

function averageRate(s1: Big, s2: Big): Rate {
  return (s1 / (s2 - 1.00)) * 100.00;
}
`,
    // Not a rule about operand order — BankLang has no such rule and does not
    // claim one. It refuses the expression because a division's scale cannot be
    // decided by the compiler, so the author has to say what the rounding is.
    // That is what makes the lost precision impossible to write by accident:
    // the decision the COBOL made silently has to be written down.
    expectDiagnostic: "BANK-DEC-003",
  },
  {
    defect: "DF36",
    summary:
      "The same computation with the rounding written, but rounded early and then multiplied — which is the precision loss the original defect actually suffered.",
    coverage: "prevented-at-compile-time",
    source: `module Df36Rounded;

type Big = decimal<16, 2>;
type Rate = decimal<3, 2>;

function averageRate(s1: Big, s2: Big): Rate {
  return round(round(s1 / (s2 - 1.00), "HALF_UP") * 100.00, "HALF_UP");
}
`,
    expectDiagnostic: "BANK-DEC-006",
  },
  {
    defect: "DF19",
    summary:
      "A character field moved into a numeric field, which passes the compiler and produces a data exception at run time when the characters are not digits.",
    coverage: "prevented-at-compile-time",
    source: `module Df19;

function toAmount(text: string<10>): decimal<9, 2> {
  return text;
}
`,
    expectDiagnostic: "BANK-TYPE-003",
  },
  {
    defect: "DF26",
    summary:
      "A table searched past its declared end, because the loop's bound and the OCCURS count were maintained separately and drifted apart.",
    coverage: "prevented-at-compile-time",
    source: `module Df26;

record Rates {
  rows: decimal<9, 2>[5];
}

function rateAt(rates: Rates): decimal<9, 2> {
  return rates.rows[9];
}
`,
    expectDiagnostic: "BANK-TYPE-009",
  },
  {
    defect: "DF42",
    summary:
      "A cursor loop that tested SQLSTATE instead of the SQLCODE the FETCH sets, so the end of the rows was never detected.",
    coverage: "prevented-at-compile-time",
    source: `module Df42;

record Row {
  rowId: string<10>;
  rowBalance: decimal<18, 2>;
}

record Commarea {
  caId: string<10>;
  idempotencyKey: string<36>;
}

sql fetchRow(keyId: string<10>): Row {
  SELECT ID, BALANCE INTO :rowId, :rowBalance FROM ACCOUNT WHERE ID = :keyId
}

cics transaction lookup(commarea: Commarea, row: Row) {
  execute fetchRow(commarea.caId) into row;
}
`,
    expectDiagnostic: "BANK-SQL-001",
  },
  {
    defect: "DF10",
    summary:
      "An 88-level whose VALUE range did not cover every value the field could hold, so a live value matched no condition name.",
    coverage: "prevented-at-compile-time",
    source: `module Df10;

enum Status {
  OPEN,
  CLOSED,
}

record Account {
  status: Status;
}

function reopen(account: Account): bool {
  account.status = "X";
  return true;
}
`,
    expectDiagnostic: "BANK-TYPE-003",
  },
  {
    defect: "DF06",
    summary:
      "A COMPUTE naming a field that two records both define, which the compiler resolved to the wrong one because the reference was not qualified.",
    coverage: "prevented-at-compile-time",
    source: `module Df06;

record Debits {
  total: decimal<9, 2>;
}

record Credits {
  total: decimal<9, 2>;
}

function difference(debits: Debits, credits: Credits): decimal<9, 2> {
  return total;
}
`,
    // A field is reached through the record that holds it, so a bare `total`
    // is not a name in scope at all rather than an ambiguous one.
    expectDiagnostic: "BANK-TYPE-001",
  },
  {
    defect: "DF15",
    summary:
      "A Gregorian date passed to INTEGER-OF-DATE that was a group with subordinate fields, so the conversion read bytes that were not the number it expected.",
    coverage: "prevented-at-compile-time",
    source: `module Df15;

function nextDay(when: date): decimal<9, 0> {
  return when + 1;
}
`,
    // `date` is its own type. It orders and compares against another date, and
    // it is not an integer that happens to have eight digits.
    expectDiagnostic: "BANK-TYPE-003",
  },
  {
    defect: "DF25",
    summary:
      "A variable initialised from an output record's data after the record had been written, when COBOL leaves that record area undefined.",
    coverage: "prevented-at-compile-time",
    source: `module Df25;

record Posting {
  postingId: string<10>;
}

file postingOutput sequential output record Posting status postingOutputStatus;

entry transaction run(posting: Posting, idempotencyKey: string<36>) {
  open postingOutput;
  write postingOutput from posting;
  read postingOutput into posting;
  close postingOutput;
  audit("RUN", idempotencyKey);
}
`,
    // The mode is the answer: an output file is not readable, so the record
    // area cannot be read back whatever COBOL leaves in it.
    expectDiagnostic: "BANK-FILE-001",
  },
  {
    defect: "DF18",
    summary:
      "A SET on a POINTER that the compiler discarded, leaving the address unset and the program reading storage it did not own.",
    coverage: "not-expressible-in-bankts",
    source: `module Df18;

function addressOf(target: string<10>): pointer {
  return target;
}
`,
    expectDiagnostic: "BANK-TYPE-001",
  },
];

/** The defects this repository demonstrates something about, deduplicated. */
export function demonstratedDefects(): string[] {
  return [
    ...new Set(DEFECT_DEMONSTRATIONS.map((entry) => entry.defect)),
  ].sort();
}
