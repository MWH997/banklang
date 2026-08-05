import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol } from "./helpers";

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

    expect(flowed(cobol)).toContain(
      flowed(
        "MOVE BRANCH-ID OF POSTING TO BRANCH-ID OF SORTED-POSTINGS-SORT-RECORD",
      ),
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
    expect(flowed(txn(BOTH).cobol)).toContain(
      flowed(
        "MOVE BRANCH-ID OF SORTED-POSTINGS-SORT-RECORD TO BRANCH-ID OF POSTING",
      ),
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

/**
 * `SORT-RETURN`, which the sort product sets to 0 or 16 and which IBM's
 * programming guide says to test after every SORT and MERGE. A program that
 * carries on past a failed sort is, in IBM's word, unpredictable.
 *
 * The concrete failure is quiet rather than loud: a sort whose input never
 * opened releases no records, so the output file is written, is empty, and the
 * job ends with a return code of zero — indistinguishable from a night when
 * there was nothing to sort.
 */
describe("the sort's own outcome", () => {
  const result = txn(BOTH);

  it("is tested after the SORT", () => {
    const cobol = result.cobol ?? "";

    expect(cobol).toContain("IF SORT-RETURN NOT = 0");
    expect(cobol.indexOf("OUTPUT PROCEDURE IS")).toBeLessThan(
      cobol.indexOf("IF SORT-RETURN NOT = 0"),
    );
  });

  /** A job log saying only "sort failed" starts an investigation. */
  it("says which file failed and what the sort returned", () => {
    expect(flowed(result.cobol)).toContain(
      flowed(
        'DISPLAY "SORT FAILED sortedPostings SORT-RETURN " SORT-RETURN UPON SYSOUT',
      ),
    );
  });

  it("stops the step rather than writing a partial result", () => {
    const cobol = result.cobol ?? "";
    const check = cobol.indexOf("IF SORT-RETURN NOT = 0");

    expect(cobol.slice(check)).toContain("MOVE 16 TO BANK-RETURN-CODE");
    // Out through the enclosing routine's exit, not a `GOBACK` written at the
    // point of failure: `BANK-MAIN` is the only paragraph that ends the
    // program, so the transaction's own failure handling still runs.
    expect(cobol.slice(check)).toMatch(/GO TO \S+-EXIT/);
  });

  /**
   * `SORT-RETURN` is not the whole story for the files the sort opens itself.
   * Under NOFASTSRT the sort does not check open, close, or I/O errors on a
   * USING or GIVING file, and IBM's guidance for a program that declares a file
   * status and no ERROR declarative — which is every program this compiler
   * emits — is to test the status key *as well as* SORT-RETURN. The status is
   * set either way; without this nothing reads it.
   */
  it("tests the status of each file the sort handled itself", () => {
    const cobol =
      txn("  sort rawPostings into sortedPostings on branchId;").cobol ?? "";

    expect(cobol).toContain('IF RAW-STATUS(1:1) NOT = "0"');
    expect(cobol).toContain('IF SORTED-STATUS(1:1) NOT = "0"');
    expect(flowed(cobol)).toContain(
      flowed(
        'DISPLAY "SORT FAILED rawPostings STATUS " RAW-STATUS UPON SYSOUT',
      ),
    );
  });

  /** A file a procedure opened was already checked there; twice says nothing. */
  it("leaves the files a procedure handled to that procedure", () => {
    const cobol = result.cobol ?? "";
    const body = cobol.slice(
      cobol.indexOf("ORDER-POSTINGS."),
      cobol.search(/BANK-SORT-IN-\d+-\d+ SECTION\./),
    );

    expect(body).not.toContain("RAW-STATUS");
    expect(body).not.toContain("SORTED-STATUS");
  });

  it("is tested after a MERGE too", () => {
    const merged =
      txn(`  merge rawPostings, otherPostings into sortedPostings on branchId;`)
        .cobol ?? "";

    expect(flowed(merged)).toContain(
      flowed(
        'DISPLAY "MERGE FAILED sortedPostings SORT-RETURN " SORT-RETURN UPON SYSOUT',
      ),
    );
  });

  /**
   * Control may not leave a sort procedure while the sort is running, so the
   * GOBACK an OPEN failure gets anywhere else is not available here. Setting
   * SORT-RETURN to 16 is how a procedure tells the sort product to give up, and
   * the test after the SORT statement is what then stops the job.
   */
  it("fails the sort from inside a procedure rather than returning", () => {
    const cobol = result.cobol ?? "";
    const section = cobol.search(/BANK-SORT-IN-\d+-\d+ SECTION\./);
    const procedure = cobol.slice(section);

    expect(procedure).toContain('IF RAW-STATUS(1:1) NOT = "0"');
    expect(procedure).toContain("MOVE 16 TO SORT-RETURN");
    expect(procedure).not.toContain("GOBACK");
  });
});

/**
 * Run, because the whole point of the check is what happens on a bad day, and
 * nothing about a sort that works proves the failure path was wired up.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("stops the job when the sort cannot run", () => {
    const result = txn(BOTH);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-sort-"));
    writeFileSync(join(dir, "program.cbl"), localCobol(result.cobol ?? ""), "utf8");

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    // An input file that is there, so the sort runs and the job ends cleanly.
    writeFileSync(join(dir, "RAWPOSTI"), "", "utf8");
    const ok = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);

    // The same program with its input missing. Without the check this run is
    // the dangerous one: it writes an empty SORTEDPO and returns zero.
    rmSync(join(dir, "RAWPOSTI"));
    rmSync(join(dir, "SORTEDPO"), { force: true });
    const failed = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });

    expect(failed.stdout).toContain("OPEN FAILED rawPostings STATUS 35");
    expect(failed.stdout).toContain("SORT FAILED sortedPostings");
    expect(failed.status).toBe(16);
  });
});
