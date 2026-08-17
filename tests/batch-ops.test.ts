import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol, unpadded } from "./helpers";

/**
 * `sort`, `merge`, and `checkpoint`: ordering a batch's input and surviving its
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
  jobName: string<8>;
  lastAccountId: string<16>;
}

file rawPostings sequential input record Posting status rawStatus;
file morePostings sequential input record Posting status moreStatus;
file sortedPostings sequential output record Posting status sortedStatus;
file restartFile indexed update record RestartPoint key jobName status restartStatus;
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
    expect(flowed(result.cobol)).toContain(flowed("DESCENDING KEY ACCOUNT-ID"));
    expect(result.cobol).toContain("USING RAW-POSTINGS-FILE");
    expect(result.cobol).toContain("GIVING SORTED-POSTINGS-FILE");
  });

  /** The sort runs through a work file, described by SD rather than FD. */
  it("declares the sort work file", () => {
    const result = txn("  sort rawPostings into sortedPostings on branchId;");

    expect(result.cobol).toContain("SD  SORTED-POSTINGS-SORT-FILE.");
    expect(result.cobol).toContain(
      "SELECT SORTED-POSTINGS-SORT-FILE ASSIGN TO SORTWORK.",
    );
  });

  /**
   * The SELECT is required and its assign name is treated as documentation:
   * nothing is allocated for it and no DD answers to it. IBM's own example
   * assigns two SD files to the same name.
   *
   * It is deliberately not `SORTWK01`, which is the DD the sort product reads
   * for its first work dataset, a different thing that the job does allocate.
   * Naming it that would read as though the SD were bound to it, and anyone who
   * changed one to match the other would find that neither mattered.
   */
  it("does not name the sort work file after the sort product's DD", () => {
    const result = txn("  sort rawPostings into sortedPostings on branchId;");

    expect(result.cobol).not.toContain("ASSIGN TO SORTWK01");
  });

  /** Nothing is allocated for the name, so two sorts may carry the same one. */
  it("lets two sort work files share it", () => {
    const result = compile(`module Batch;

record Posting {
  branchId: string<8>;
  idempotencyKey: string<36>;
}

record Advice {
  adviceId: string<16>;
}

file rawPostings sequential input record Posting status rawStatus;
file sortedPostings sequential output record Posting status sortedStatus;
file rawAdvice sequential input record Advice status rawAdviceStatus;
file sortedAdvice sequential output record Advice status sortedAdviceStatus;

entry transaction order(posting: Posting) {
  sort rawPostings into sortedPostings on branchId;
  sort rawAdvice into sortedAdvice on adviceId;
  audit("ORDERED", posting.idempotencyKey);
}`);
    const assigns = (result.cobol ?? "").match(/ASSIGN TO SORTWORK\./g) ?? [];

    expect(errors(result)).toEqual([]);
    expect(assigns).toHaveLength(2);
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

  /*
   * Sorting a file into a differently shaped one, which is most of what a batch
   * sort is for: order the detail records, then write a report line.
   *
   * The record a sort moves is the one it *reads*. That used to be the
   * destination's record and every file had to hold it, including when an
   * output procedure was present, which is exactly when the sort does not write
   * the destination at all. CobolCodeBench's task_func_37 was recorded as a
   * language gap on the strength of it.
   */
  const REFORMAT = `module Reformat;

record RawLine {
  rawPart: string<5>;
  rawQuantity: unsigned<5, 0>;
  rawDepartment: string<2>;
}

record SortedLine {
  outDepartment: string<2>;
  outPart: string<5>;
}

file rawParts lineSequential input record RawLine status rawPartsStatus;
file sortedParts lineSequential output record SortedLine status sortedStatus;
`;

  function reformat(tail: string): ReturnType<typeof compile> {
    return compile(`${REFORMAT}
entry transaction order(raw: RawLine, out: SortedLine, idempotencyKey: string<36>) {
${tail}
  audit("ORDERED", idempotencyKey);
}`);
  }

  describe("a sort whose destination is shaped differently", () => {
    const withOutputProcedure = `  sort rawParts into sortedParts on rawDepartment input raw {
    release raw;
  } output raw {
    out.outDepartment = raw.rawDepartment;
    out.outPart = raw.rawPart;
    write sortedParts from out;
  };`;

    it("is accepted when an output procedure writes the destination", () => {
      expect(errors(reformat(withOutputProcedure))).toEqual([]);
    });

    it("lays the sort work file out as the record it reads", () => {
      // The SD is named after the destination and describes the source. Taking
      // the layout from the destination made the generated MOVE name fields the
      // input record does not have, and `cobc` refused the program.
      const cobol = reformat(withOutputProcedure).cobol ?? "";
      expect(cobol).toContain("SD  SORTED-PARTS-SORT-FILE.");
      expect(flowed(cobol)).toContain(flowed("05  RAW-PART"));
      expect(flowed(cobol)).toContain(flowed("05  RAW-DEPARTMENT"));
      expect(cobol).not.toContain("OUT-PART OF SORTED-PARTS-SORT-RECORD");
    });

    it("sorts on a key of the record it reads", () => {
      expect(flowed(reformat(withOutputProcedure).cobol)).toContain(
        flowed("ASCENDING KEY RAW-DEPARTMENT OF SORTED-PARTS-SORT-RECORD"),
      );
    });

    it("still refuses it when GIVING is what writes the destination", () => {
      // Without an output procedure the sort writes the file itself and GIVING
      // moves the sort record into it byte for byte, so the shapes must match.
      const result = reformat(
        "  sort rawParts into sortedParts on rawDepartment;",
      );
      expect(ids(result)).toContain("BANK-FILE-005");
      expect(
        result.diagnostics.map((entry) => entry.message).join(" "),
      ).toContain("the sort moves RawLine");
    });

    it("binds both procedure records to the record it reads", () => {
      const result =
        reformat(`  sort rawParts into sortedParts on rawDepartment input raw {
    release raw;
  } output out {
    write sortedParts from out;
  };`);
      expect(ids(result)).toContain("BANK-FILE-006");
    });
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

  point.jobName = "POSTBAT";
  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "STARTING FRESH";
  }

  while seen < 1000 limit 1000 {
    read rawPostings into posting;
    if rawStatus == "00" {
      debit(posting.accountId, posting.amount);
      credit("CASH", posting.amount);
      point.lastAccountId = posting.accountId;
CHECKPOINT
    }
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

/**
 * `restart <file> into <record> { ... } else { ... }`: the half of
 * checkpoint/restart that makes the other half worth writing.
 *
 * A position written down and never read back leaves the rerun starting at the
 * beginning, which is the thing a checkpoint exists to prevent. The compiler
 * used to emit the write and nothing else, and `BANK-FILE-003` told programmers
 * that adding the checkpoint made the job safe to rerun. It did not.
 */
describe("restart", () => {
  const RESTARTING = `entry transaction post(posting: Posting, point: RestartPoint) {
  open restartFile;
  point.jobName = "POSTBAT";
  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "NOTHING TO RESUME";
  }
  close restartFile;
  audit("POSTED", posting.idempotencyKey);
}`;

  const result = compile(`${PREAMBLE}\n${RESTARTING}`);

  it("compiles", () => {
    expect(errors(result)).toEqual([]);
  });

  /** The record's key says which position is being asked for, as a keyed read does. */
  it("reads the position under the key the record carries", () => {
    const cobol = result.cobol ?? "";

    expect(flowed(cobol)).toContain(
      flowed(
        "MOVE JOB-NAME OF RESTART-POINT TO JOB-NAME OF RESTART-FILE-RECORD",
      ),
    );
    expect(cobol).toContain("READ RESTART-FILE-FILE");
  });

  /**
   * On its own flag rather than on the file status: no position written yet is
   * the ordinary first run, not an I/O failure to report.
   */
  it("branches on whether one was found", () => {
    const cobol = result.cobol ?? "";

    expect(cobol).toContain("INVALID KEY CONTINUE");
    expect(cobol).toContain(
      'NOT INVALID KEY MOVE "Y" TO RESTART-FILE-RS-FOUND',
    );
    expect(cobol).toContain('IF RESTART-FILE-RS-FOUND = "Y"');
    expect(unpadded(cobol)).toContain(
      '01 RESTART-FILE-RS-FOUND PIC X(1) VALUE "N".',
    );
  });

  it("fills the record from the position it found", () => {
    expect(flowed(result.cobol)).toContain(
      flowed(
        "MOVE LAST-ACCOUNT-ID OF RESTART-FILE-RECORD TO LAST-ACCOUNT-ID OF RESTART-POINT",
      ),
    );
  });

  /**
   * The first run of a batch has never written a position, so the dataset does
   * not exist. OPTIONAL is what COBOL has for a file that may legitimately be
   * absent; without it the OPEN fails and the job dies on the very run that had
   * nothing to resume from.
   */
  it("lets the restart file be missing on the first run", () => {
    expect(result.cobol).toContain("SELECT OPTIONAL RESTART-FILE-FILE");
  });

  it("leaves every other file required", () => {
    expect(result.cobol).not.toContain("SELECT OPTIONAL RAW-POSTINGS-FILE");
  });

  /** `else` is optional: a fresh start often needs nothing done. */
  it("can be written without a fresh-start branch", () => {
    const without = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  open restartFile;
  point.jobName = "POSTBAT";
  restart restartFile into point {
    log "RESUMING";
  }
  close restartFile;
  audit("POSTED", posting.idempotencyKey);
}`);

    expect(errors(without)).toEqual([]);
    expect(without.cobol).not.toContain("ELSE");
  });

  /**
   * A sequential output file is rewritten from the start by the next OPEN, so a
   * rerun that dies before its own first checkpoint destroys the position it was
   * resuming from. One keyed record, rewritten in place, has no such window.
   */
  it("rejects a restart file that is not keyed and updatable", () => {
    const sequential = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  restart sortedPostings into point {
    log "RESUMING";
  }
  audit("POSTED", posting.idempotencyKey);
}`);

    expect(ids(sequential)).toContain("BANK-FILE-003");
  });

  it("rejects a record the file does not hold", () => {
    const mismatched = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  restart restartFile into posting {
    log "RESUMING";
  }
  audit("POSTED", posting.idempotencyKey);
}`);

    expect(ids(mismatched)).toContain("BANK-FILE-003");
  });
});

/**
 * The write, which is now a keyed replacement rather than an append.
 *
 * Each checkpoint replaces the last, so a restart reads one record and knows it
 * is the furthest point that was committed, rather than reading a growing
 * stream of them and having to work out which is newest.
 */
describe("what a checkpoint writes", () => {
  const result = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  open restartFile;
  point.jobName = "POSTBAT";
  restart restartFile into point { log "RESUMING"; }
  point.lastAccountId = posting.accountId;
  checkpoint restartFile from point every 500;
  close restartFile;
  audit("POSTED", posting.idempotencyKey);
}`);

  it("replaces the position rather than adding another", () => {
    const cobol = result.cobol ?? "";

    expect(cobol).toContain("WRITE RESTART-FILE-RECORD");
    expect(cobol).toContain("INVALID KEY REWRITE RESTART-FILE-RECORD");
    expect(cobol).toContain("END-WRITE");
  });

  it("rejects a restart file that cannot be read back", () => {
    const sequential = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  checkpoint sortedPostings from point every 500;
  audit("POSTED", posting.idempotencyKey);
}`);

    expect(ids(sequential)).toContain("BANK-FILE-003");
  });
});

/**
 * Run, twice, because the claim is about what the second run does. Nothing
 * about a program that writes a position proves the next run reads it.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("resumes the run after it from where it got to", () => {
    const result = compile(`${PREAMBLE}
entry transaction post(posting: Posting, point: RestartPoint) {
  open restartFile;
  point.jobName = "POSTBAT";
  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "NOTHING TO RESUME";
  }
  point.lastAccountId = "ACC-000000000042";
  checkpoint restartFile from point every 1;
  close restartFile;
  audit("POSTED", posting.idempotencyKey);
}`);
    expect(errors(result)).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-restart-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        join(process.cwd(), "runtime/BANKLEDG.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    // Nothing written yet, so the restart file does not exist at all.
    const first = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("NOTHING TO RESUME");

    const second = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("RESUMING AFTER ACC-000000000042");
  });
});
