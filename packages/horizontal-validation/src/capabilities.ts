/**
 * What BankTS can express, tied to the COBOL it becomes.
 *
 * This table exists because of one bug, and it is worth naming precisely. The
 * representability rules said `inspect` was `unsupported-not-yet-implemented`
 * with the note "No BankTS syntax" — while `countOf` lowered to `INSPECT ...
 * TALLYING` and `replaceChars` to `INSPECT ... CONVERTING`, and had done
 * throughout. Correcting one word moved 182 of X-COBOL's 5,195 files. Nothing
 * in the repository could have caught it, because the compiler's capability and
 * the validator's belief about that capability were two hand-maintained lists
 * with no relationship.
 *
 * So each row below is a *claim that can be executed*: a BankTS program, the
 * COBOL construct it must produce, and the corpus feature that construct
 * corresponds to. `tests/capability-drift.test.ts` compiles every probe and
 * checks three things the previous arrangement could not:
 *
 *   - the BankTS actually compiles, so a row cannot outlive its syntax;
 *   - the emitted COBOL actually contains the construct, so a row cannot claim
 *     a lowering the backend does not perform;
 *   - the representability rule for that feature does not say `unsupported`,
 *     which is exactly and only the `inspect` failure.
 *
 * What this deliberately does *not* do is infer the verdict. A construct with a
 * BankTS equivalent may still be `adaptation` — `substring` takes constant
 * bounds where COBOL takes computed ones — and that judgement stays in
 * `representability.ts` where the reasoning lives. The registry rules out one
 * specific lie: "BankTS has no way to say this" when it plainly does.
 */

export interface Capability {
  /** The BankTS construct, as a reader would name it. */
  bankts: string;
  /**
   * A complete BankTS program exercising it.
   *
   * Complete rather than a fragment, because the check is that the compiler
   * accepts it and emits something — which a fragment cannot establish.
   */
  probe: string;
  /**
   * A substring the emitted COBOL must contain, with runs of whitespace
   * collapsed. This is the claim about lowering.
   */
  emits: string;
  /**
   * The `packages/migration-analysis` feature this construct corresponds to.
   *
   * Null where the emitted COBOL is not something the corpus analyser detects
   * as a feature — a real case, and one that has to be stated rather than left
   * to look like an omission.
   */
  feature: string | null;
}

const RECORD_HEAD = `module Probe;

record Line {
  lineText: string<20>;
  lineCount: decimal<9, 0>;
}
`;

export const CAPABILITIES: Capability[] = [
  {
    bankts: "countOf",
    feature: "inspect",
    emits: "INSPECT",
    probe: `${RECORD_HEAD}
function commas(text: string<20>): decimal<9, 0> {
  return countOf(text, ",");
}
`,
  },
  {
    bankts: "replaceChars",
    feature: "inspect",
    emits: "INSPECT",
    probe: `${RECORD_HEAD}
function padded(text: string<20>): string<20> {
  return replaceChars(text, " ", "0");
}
`,
  },
  {
    bankts: "substring",
    feature: "reference-modification",
    emits: "(16:4)",
    probe: `module Probe;

function tail(pan: string<19>): string<4> {
  return substring(pan, 16, 4);
}
`,
  },
  {
    bankts: "concat",
    feature: "string-unstring",
    emits: "STRING",
    probe: `module Probe;

function masked(pan: string<19>): string<16> {
  return concat("************", substring(pan, 16, 4));
}
`,
  },
  {
    bankts: "split",
    feature: "string-unstring",
    emits: "UNSTRING",
    probe: `module Probe;

record Parts {
  partOne: string<8>;
  partTwo: string<8>;
  partRef: string<20>;
}

entry transaction take(parts: Parts, idempotencyKey: string<36>) {
  split parts.partRef by "-" into parts.partOne, parts.partTwo;
  audit("SPLIT", idempotencyKey);
}
`,
  },
  {
    bankts: "lineSequential files",
    feature: "file-line-sequential",
    emits: "ORGANIZATION IS LINE SEQUENTIAL",
    probe: `module Probe;

record Line {
  lineText: string<20>;
}

file feedInput lineSequential input record Line status feedInputStatus;

on error feedInput {
  log "FEEDINPUT FAILED ", feedInputStatus;
}

function unused(): bool {
  return true;
}
`,
  },
  {
    bankts: "indexed files",
    feature: "file-indexed",
    emits: "ORGANIZATION IS INDEXED",
    probe: `module Probe;

record Account {
  accountId: string<16>;
  accountBalance: decimal<18, 2>;
}

file master indexed input record Account key accountId status masterStatus;

on error master {
  log "MASTER FAILED ", masterStatus;
}

function unused(): bool {
  return true;
}
`,
  },
  {
    bankts: "sort",
    feature: "sort-merge",
    emits: "SORT",
    probe: `module Probe;

record Posting {
  postingBranch: string<8>;
  postingAmount: decimal<18, 2>;
}

file rawPostings sequential input record Posting status rawPostingsStatus;

file sortedPostings sequential output record Posting status sortedPostingsStatus;

on error rawPostings {
  log "RAW FAILED ", rawPostingsStatus;
}

on error sortedPostings {
  log "SORTED FAILED ", sortedPostingsStatus;
}

entry transaction order(posting: Posting, idempotencyKey: string<36>) {
  sort rawPostings into sortedPostings on postingBranch;
  audit("SORTED", idempotencyKey);
}
`,
  },
  {
    /*
     * Ordering a file into a differently shaped one, which is most of what a
     * batch sort is for. Registered separately from `sort` because the two are
     * different claims: `sort` says the statement exists, and this says the
     * destination need not hold the record the sort moves — which was refused
     * until 2026-08-09 and is why `task_func_37` was recorded as a language
     * gap.
     */
    bankts: "sort with an output procedure that reformats",
    feature: "sort-merge",
    emits: "OUTPUT PROCEDURE IS",
    probe: `module Probe;

record Detail {
  detailBranch: string<8>;
  detailAmount: decimal<18, 2>;
}

record ReportLine {
  reportAmount: decimal<18, 2>;
  reportBranch: string<8>;
}

file rawDetails sequential input record Detail status rawDetailsStatus;

file branchReport sequential output record ReportLine status branchReportStatus;

on error rawDetails {
  log "RAW FAILED ", rawDetailsStatus;
}

on error branchReport {
  log "REPORT FAILED ", branchReportStatus;
}

entry transaction order(detail: Detail, line: ReportLine, idempotencyKey: string<36>) {
  sort rawDetails into branchReport on detailBranch input detail {
    release detail;
  } output detail {
    line.reportBranch = detail.detailBranch;
    line.reportAmount = detail.detailAmount;
    write branchReport from line;
  };

  audit("ORDERED", idempotencyKey);
}
`,
  },
  {
    bankts: "search",
    feature: "search",
    emits: "SEARCH",
    probe: `module Probe;

record Band {
  bandUpper: decimal<9, 0>;
  bandRate: decimal<9, 4>;
}

record Book {
  bands: Band[4] ascending bandUpper;
  bookFound: decimal<9, 4>;
  idempotencyKey: string<36>;
}

entry transaction lookup(book: Book) {
  search sorted band in book.bands where band.bandUpper == 30 {
    book.bookFound = band.bandRate;
  } else {
    book.bookFound = 0.0000;
  }

  audit("LOOKED", book.idempotencyKey);
}
`,
  },
  {
    bankts: "enum",
    feature: "condition-names",
    emits: "88",
    probe: `module Probe;

enum Status {
  OPEN,
  CLOSED,
}

record Account {
  accountStatus: Status;
}

function isOpen(account: Account): bool {
  return account.accountStatus == Status.OPEN;
}
`,
  },
];
