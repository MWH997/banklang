import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `INPUT PROCEDURE` and `OUTPUT PROCEDURE` — the form a sort takes when there is
 * something to do to the records on the way through.
 *
 * `USING`/`GIVING` lets the sort open, read, write, and close the files itself,
 * which is right when the ordering is the only thing being changed. A procedure
 * is what a real batch program reaches for instead: filtering the input, or
 * totalling the output as it goes past.
 */

const PREAMBLE = `module Ordering;

type GBP = currency<"GBP", 18, 2>;

record Posting {
  branchId: string<8>;
  accountId: string<16>;
  amount: GBP;
  idempotencyKey: string<36>;
}

file rawPostings sequential input record Posting status rawStatus;
file otherPostings sequential input record Posting status otherStatus;
file sortedPostings sequential output record Posting status sortedStatus;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction orderPostings(posting: Posting) {
${body}
  audit("SORTED", posting.idempotencyKey);
}`);
}

const BOTH = `  sort rawPostings into sortedPostings on branchId, descending accountId
    input posting {
      if posting.amount > 0.00 {
        release posting;
      }
    }
    output posting {
      write sortedPostings from posting;
    };`;

describe("a sort with no procedures", () => {
  /** The plain form is unchanged: nothing to do on the way through. */
  it("still uses USING and GIVING", () => {
    const result = txn("  sort rawPostings into sortedPostings on branchId;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("USING RAW-POSTINGS-FILE");
    expect(result.cobol).toContain("GIVING SORTED-POSTINGS-FILE");
  });
});

describe("input procedure", () => {
  /**
   * A procedure replaces the clause it stands in for. USING and an INPUT
   * PROCEDURE are alternatives: the sort either reads the files itself or
   * receives records from the program, never both.
   */
  it("replaces USING", () => {
    const result = txn(BOTH);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toMatch(/INPUT PROCEDURE IS BANK-SORT-IN-\d+-\d+\b/);
    expect(result.cobol).not.toContain("USING RAW-POSTINGS-FILE");
  });

  it("leaves GIVING alone when only the input is a procedure", () => {
    const result = txn(`  sort rawPostings into sortedPostings on branchId
    input posting { release posting; };`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("INPUT PROCEDURE IS");
    expect(result.cobol).toContain("GIVING SORTED-POSTINGS-FILE");
  });

  /** The program reads the file, so the generated loop opens and closes it. */
  it("generates the read loop", () => {
    const cobol = txn(BOTH).cobol ?? "";

    expect(cobol).toContain("OPEN INPUT RAW-POSTINGS-FILE");
    expect(cobol).toContain("READ RAW-POSTINGS-FILE");
    expect(cobol).toMatch(/AT END MOVE "Y" TO BANK-SORT-IN-\d+-\d+-END/);
    expect(cobol).toContain("CLOSE RAW-POSTINGS-FILE");
  });

  /**
   * The loop stops on a flag of its own rather than on the file's status field,
   * because a sort's input file need not declare one and a RETURN has no status
   * field at all.
   */
  it("declares its own end flag", () => {
    expect(txn(BOTH).cobol).toMatch(
      /BANK-SORT-IN-\d+-\d+-END\s+PIC X\(1\) VALUE "N"/,
    );
  });

  /** Each input file in turn, which is what USING would have done. */
  it("reads every input file", () => {
    const cobol =
      txn(`  sort rawPostings, otherPostings into sortedPostings on branchId
    input posting { release posting; };`).cobol ?? "";

    expect(cobol).toContain("OPEN INPUT RAW-POSTINGS-FILE");
    expect(cobol).toContain("OPEN INPUT OTHER-POSTINGS-FILE");
  });
});

describe("release", () => {
  /** It is the statement an input procedure exists for. */
  it("moves the record into the sort file and releases it", () => {
    const cobol = txn(BOTH).cobol ?? "";

    expect(cobol).toContain(
      "MOVE BRANCH-ID OF POSTING TO BRANCH-ID OF SORTED-POSTINGS-SORT-RECORD",
    );
    expect(cobol).toContain("RELEASE SORTED-POSTINGS-SORT-RECORD");
  });

  /** The records it does not release are the ones the procedure filters out. */
  it("can be conditional", () => {
    const cobol = txn(BOTH).cobol ?? "";

    expect(cobol.indexOf("IF AMOUNT OF POSTING > 0.00")).toBeLessThan(
      cobol.indexOf("RELEASE SORTED-POSTINGS-SORT-RECORD"),
    );
  });

  /** RELEASE hands a record to a sort that is running, and none is here. */
  it("is rejected outside an input procedure", () => {
    expect(ids(txn("  release posting;"))).toContain("BANK-FILE-006");
  });

  it("is rejected in an output procedure", () => {
    const result = txn(`  sort rawPostings into sortedPostings on branchId
    output posting { release posting; };`);

    expect(ids(result)).toContain("BANK-FILE-006");
  });

  /**
   * An input procedure that releases nothing sorts an empty file. There is no
   * reading of that program under which it is what was meant.
   */
  it("must appear somewhere in an input procedure", () => {
    const result = txn(`  sort rawPostings into sortedPostings on branchId
    input posting { posting.amount = 0.00; };`);

    expect(ids(result)).toContain("BANK-FILE-006");
  });
});

describe("output procedure", () => {
  it("replaces GIVING", () => {
    const result = txn(BOTH);

    expect(result.cobol).toMatch(/OUTPUT PROCEDURE IS BANK-SORT-OUT-\d+-\d+\b/);
    expect(result.cobol).not.toContain("GIVING SORTED-POSTINGS-FILE");
  });

  /**
   * GIVING would have opened and written the file; with an output procedure
   * that becomes the program's job, so the generated loop does it.
   */
  it("generates the RETURN loop and opens the output file", () => {
    const cobol = txn(BOTH).cobol ?? "";

    expect(cobol).toContain("OPEN OUTPUT SORTED-POSTINGS-FILE");
    expect(cobol).toContain("RETURN SORTED-POSTINGS-SORT-FILE");
    expect(cobol).toMatch(/AT END MOVE "Y" TO BANK-SORT-OUT-\d+-\d+-END/);
    expect(cobol).toContain("END-RETURN");
    expect(cobol).toContain("CLOSE SORTED-POSTINGS-FILE");
  });

  /** The body sees the returned record through an ordinary record variable. */
  it("maps the sorted record into the procedure's record", () => {
    expect(txn(BOTH).cobol).toContain(
      "MOVE BRANCH-ID OF SORTED-POSTINGS-SORT-RECORD TO BRANCH-ID OF POSTING",
    );
  });
});

describe("where the procedures are placed", () => {
  /**
   * After the last GOBACK. A section in the flow of control would be run again
   * on the way past, and an INPUT PROCEDURE is meant to be entered by SORT and
   * by nothing else.
   */
  it("comes after the body that performs the sort", () => {
    const cobol = txn(BOTH).cobol ?? "";

    const section = cobol.search(/BANK-SORT-IN-\d+-\d+ SECTION\./);

    expect(cobol.indexOf("ORDER-POSTINGS.")).toBeLessThan(section);
    expect(cobol.indexOf("GOBACK.")).toBeLessThan(section);
  });

  /** Two sorts in one program need two sets of names. */
  it("names each procedure after its statement's position", () => {
    const cobol =
      txn(`  sort rawPostings into sortedPostings on branchId
    input posting { release posting; };
  sort otherPostings into sortedPostings on accountId
    input posting { release posting; };`).cobol ?? "";

    const sections = cobol.match(/BANK-SORT-IN-\d+-\d+ SECTION\./g) ?? [];

    expect(sections).toHaveLength(2);
    expect(new Set(sections).size).toBe(2);
  });
});

describe("what a procedure may work through", () => {
  it("rejects a record that is not the one being sorted", () => {
    const result = compile(`${PREAMBLE}
record Other {
  otherId: string<8>;
}

entry transaction orderPostings(posting: Posting, other: Other) {
  sort rawPostings into sortedPostings on branchId
    input other { release other; };
  audit("SORTED", posting.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-006");
  });

  it("rejects a name that is not in scope", () => {
    const result = txn(`  sort rawPostings into sortedPostings on branchId
    input missing { release missing; };`);

    expect(ids(result)).toContain("BANK-FILE-006");
  });
});

describe("merge", () => {
  /**
   * COBOL gives MERGE no input procedure: a merge's premise is that its inputs
   * already arrive in order, and a procedure that could drop or reorder records
   * would break it.
   */
  it("has no input procedure", () => {
    const result =
      txn(`  merge rawPostings, otherPostings into sortedPostings on branchId
    input posting { release posting; };`);

    expect(ids(result)).toContain("BANK-FILE-006");
  });

  it("still takes an output procedure", () => {
    const result =
      txn(`  merge rawPostings, otherPostings into sortedPostings on branchId
    output posting { write sortedPostings from posting; };`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MERGE SORTED-POSTINGS-SORT-FILE");
    expect(result.cobol).toContain("OUTPUT PROCEDURE IS");
  });
});
