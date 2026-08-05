import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `sort`, `merge`, and `checkpoint` — ordering a batch's input and surviving its
 * failure.
 */

const PREAMBLE = `module Batch;

type BDT = currency<"BDT", 18, 2>;

record Posting {
  branchId: string<8>;
  accountId: string<16>;
  amount: BDT;
  idempotencyKey: string<36>;
}

record RestartPoint {
  lastAccountId: string<16>;
}

file rawPostings sequential input record Posting status rawStatus;
file morePostings sequential input record Posting status moreStatus;
file sortedPostings sequential output record Posting status sortedStatus;
file restartFile sequential output record RestartPoint status restartStatus;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function errors(result: {
  diagnostics: { id: string; severity: string }[];
}): { id: string }[] {
  return result.diagnostics.filter((entry) => entry.severity === "error");
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction run1(posting: Posting, point: RestartPoint) {
${body}
  audit("RAN", posting.idempotencyKey);
}`);
}

describe("sort and merge", () => {
  /**
   * `USING` and `GIVING` let the sort open, read, write, and close the files
   * itself, which is what a program wants when it has nothing to do to the
   * records on the way through.
   */
  it("sorts one file into another on named keys", () => {
    const result = txn(
      "  sort rawPostings into sortedPostings on branchId, descending accountId;",
    );

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("SORT SORTED-POSTINGS-SORT-FILE");
    expect(result.cobol).toContain("ASCENDING KEY BRANCH-ID");
    expect(result.cobol).toContain("DESCENDING KEY ACCOUNT-ID");
    expect(result.cobol).toContain("USING RAW-POSTINGS-FILE");
    expect(result.cobol).toContain("GIVING SORTED-POSTINGS-FILE");
  });

  /** The sort runs through a work file, described by SD rather than FD. */
  it("declares the sort work file", () => {
    const result = txn("  sort rawPostings into sortedPostings on branchId;");

    expect(result.cobol).toContain("SD  SORTED-POSTINGS-SORT-FILE.");
    expect(result.cobol).toContain(
      "SELECT SORTED-POSTINGS-SORT-FILE ASSIGN TO SORTWK01.",
    );
  });

  it("merges several already-sorted inputs", () => {
    const result = txn(
      "  merge rawPostings, morePostings into sortedPostings on accountId;",
    );

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain(
      "USING RAW-POSTINGS-FILE MORE-POSTINGS-FILE",
    );
  });

  it("rejects a merge of one input", () => {
    expect(
      ids(txn("  merge rawPostings into sortedPostings on accountId;")),
    ).toContain("BANK-FILE-005");
  });

  /** A key that is not in the record sorts on nothing. */
  it("rejects a key that is not a field of the record", () => {
    expect(
      ids(txn("  sort rawPostings into sortedPostings on notAField;")),
    ).toContain("BANK-FILE-005");
  });

  it("rejects sorting into a file declared as input", () => {
    expect(
      ids(txn("  sort sortedPostings into rawPostings on accountId;")),
    ).toContain("BANK-FILE-005");
  });
});

describe("checkpoint and restart", () => {
  const LOOP = `  let seen: decimal<9, 0> = 0;
  open rawPostings;
  open restartFile;

  while seen < 1000 limit 1000 {
    read rawPostings into posting;
    debit(posting.accountId, posting.amount);
    credit("CASH", posting.amount);
    point.lastAccountId = posting.accountId;
CHECKPOINT
    seen = seen + 1;
  }

  close restartFile;
  close rawPostings;`;

  /**
   * Counting rather than checkpointing every record is the trade: a commit
   * costs time, and rework after a failure costs the records since the last one.
   */
  it("writes the position every n records", () => {
    const result = txn(
      LOOP.replace(
        "CHECKPOINT",
        "    checkpoint restartFile from point every 500;",
      ),
    );

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("ADD 1 TO RESTART-FILE-CP-COUNT");
    expect(result.cobol).toContain("IF RESTART-FILE-CP-COUNT >= 500");
    expect(result.cobol).toContain("MOVE 0 TO RESTART-FILE-CP-COUNT");
    expect(result.cobol).toContain("WRITE RESTART-FILE-RECORD");
  });

  /**
   * The hazard is the rerun: a job that dies at row 3000 of 5000 and starts
   * again from the beginning posts the first 3000 twice.
   */
  it("warns when a posting loop has no checkpoint", () => {
    const result = txn(LOOP.replace("CHECKPOINT", ""));

    expect(ids(result)).toContain("BANK-FILE-003");
  });

  /**
   * A warning, not an error: the compiler cannot tell whether the job is
   * rerunnable another way, so the program still compiles.
   */
  it("still generates COBOL when it warns", () => {
    const result = txn(LOOP.replace("CHECKPOINT", ""));

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("PROGRAM-ID. BATCH.");
  });

  it("says nothing about a single posting outside a loop", () => {
    const result = txn(`  debit(posting.accountId, posting.amount);
  credit("CASH", posting.amount);`);

    expect(ids(result)).not.toContain("BANK-FILE-003");
  });

  it("rejects a restart file the program cannot write", () => {
    const result = txn(
      LOOP.replace(
        "CHECKPOINT",
        "    checkpoint rawPostings from point every 500;",
      ),
    );

    expect(ids(result)).toContain("BANK-FILE-003");
  });

  it("rejects an interval that is not a positive whole number", () => {
    const result = txn(
      LOOP.replace(
        "CHECKPOINT",
        "    checkpoint restartFile from point every 0;",
      ),
    );

    expect(ids(result)).toContain("BANK-FILE-003");
  });
});
