import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { checked, corpus, flowed, localCobol } from "./helpers";

/**
 * The file status key, tested after every I/O statement rather than after
 * `OPEN` alone.
 *
 * IBM's guidance is unambiguous, "check the file status key after each input
 * or output request", and until this existed only `OPEN` was checked. A
 * `WRITE` that filled the volume, a `CLOSE` that could not write its last
 * buffer, a `DELETE` against a record that had already gone: each set the
 * status, nothing read it, and the batch carried on to a return code of zero.
 * A short output file that reports success is the failure nobody investigates
 * until someone reconciles a month later.
 *
 * The test is on the status *key*, the first character, because "00" is not
 * the only success. Class 0 is successful completion and includes "02" (a
 * duplicate alternate key was written where duplicates are allowed), "04" (a
 * record of a different length from the description), "05" and "07".
 */

const RECORD = `record Master {
  accountId: string<16>;
  balance: decimal<18, 2>;
  idempotencyKey: string<36>;
}`;

function program(files: string, body: string): ReturnType<typeof compile> {
  return compile(`module Statuses;

${RECORD}

${files}

entry transaction touch1(master: Master) {
${body}
  audit("TOUCHED", master.idempotencyKey);
}`);
}

const SEQUENTIAL = `file feed sequential output record Master status feedStatus;`;
const INDEXED = `file store indexed update record Master key accountId status storeStatus;`;

describe("the condition each check tests", () => {
  /**
   * On the successful-completion group, not on `= "00"`. A check written
   * `NOT = "00"` stops the job for a status that says the operation worked,
   * which for an OPTIONAL file created on its first run means a restartable
   * batch could never run its first night.
   *
   * Written as a condition name rather than as reference modification on the
   * first character. Both are correct; only one is what a COBOL programmer
   * writes, and the file status key is the field a batch program's whole error
   * model runs through.
   */
  it("is the successful-completion group rather than an exact status", () => {
    const result = program(
      SEQUENTIAL,
      `  open feed;
  write feed from master;
  close feed;`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(flowed("IF NOT FEED-STATUS-OK"));
    expect(result.cobol).not.toContain('FEED-STATUS NOT = "00"');
  });

  /**
   * End of file is how a batch loop ends and a missing key is a question
   * answered, so those are the program's business rather than the job's. Every
   * other class is the file failing, and the loop that ends on one ends halfway
   * through the data with nothing said about it.
   */
  it("lets a read through on end of file and stops on anything else", () => {
    const result = program(
      `file feed sequential input record Master status feedStatus;`,
      `  open feed;
  read feed into master;
  if feedStatus == "00" {
    log "READ ", master.accountId;
  }
  close feed;`,
    );

    expect(flowed(result.cobol)).toContain(
      flowed("IF NOT FEED-STATUS-OK AND NOT FEED-STATUS-EOF"),
    );
  });

  it("lets a keyed read through on a key that was not there", () => {
    const result = program(
      INDEXED,
      `  open store;
  read store into master key master.accountId;
  if storeStatus == "00" {
    log "READ ", master.accountId;
  }
  close store;`,
    );

    expect(flowed(result.cobol)).toContain(
      flowed("IF NOT STORE-STATUS-OK AND NOT STORE-STATUS-NOTFND"),
    );
  });

  it("lets a write through on a duplicate key, since the program tests it", () => {
    const result = program(
      INDEXED,
      `  open store;
  write store from master;
  if storeStatus != "00" {
    log "DUPLICATE ", storeStatus;
  }
  close store;`,
    );

    expect(flowed(result.cobol)).toContain(
      flowed("IF NOT STORE-STATUS-OK AND NOT STORE-STATUS-DUPKEY"),
    );
  });
});

describe("which statements are checked", () => {
  const cases: [string, string, string, string][] = [
    [
      "CLOSE",
      SEQUENTIAL,
      "  open feed;\n  close feed;",
      'DISPLAY "CLOSE FAILED feed STATUS " FEED-STATUS UPON SYSOUT',
    ],
    [
      "WRITE",
      SEQUENTIAL,
      "  open feed;\n  write feed from master;\n  close feed;",
      'DISPLAY "WRITE FAILED feed STATUS " FEED-STATUS UPON SYSOUT',
    ],
    [
      "REWRITE",
      INDEXED,
      '  open store;\n  read store into master key master.accountId;\n  if storeStatus == "00" {\n    rewrite store from master;\n  }\n  if storeStatus == "00" {\n    log "OK ", storeStatus;\n  }\n  close store;',
      'DISPLAY "REWRITE FAILED store STATUS " STORE-STATUS UPON SYSOUT',
    ],
    [
      "DELETE",
      INDEXED,
      '  open store;\n  read store into master key master.accountId;\n  if storeStatus == "00" {\n    delete store key master.accountId;\n  }\n  if storeStatus == "00" {\n    log "OK ", storeStatus;\n  }\n  close store;',
      'DISPLAY "DELETE FAILED store STATUS " STORE-STATUS UPON SYSOUT',
    ],
    [
      "START",
      INDEXED,
      '  open store;\n  start store key master.accountId;\n  if storeStatus == "00" {\n    log "POSITIONED ", storeStatus;\n  }\n  close store;',
      'DISPLAY "START FAILED store STATUS " STORE-STATUS UPON SYSOUT',
    ],
    [
      "READ NEXT",
      INDEXED,
      '  open store;\n  start store key master.accountId;\n  if storeStatus == "00" {\n    readNext store into master;\n  }\n  if storeStatus == "00" {\n    log "READ ", master.accountId;\n  }\n  close store;',
      'DISPLAY "READ NEXT FAILED store STATUS " STORE-STATUS UPON SYSOUT',
    ],
  ];

  for (const [operation, files, body, expected] of cases) {
    it(`names the file and the status after ${operation}`, () => {
      const result = program(files, body);

      expect(
        result.diagnostics.filter((entry) => entry.severity === "error"),
      ).toEqual([]);
      expect(flowed(result.cobol)).toContain(flowed(expected));
    });
  }

  /** Conventional codes: 12 is a step that failed. */
  it("returns 12 rather than carrying on", () => {
    const result = program(
      SEQUENTIAL,
      `  open feed;
  write feed from master;
  close feed;`,
    );
    const after = (result.cobol ?? "").slice(
      (result.cobol ?? "").indexOf('DISPLAY "WRITE FAILED'),
    );

    expect(after).toContain("MOVE 12 TO BANK-RETURN-CODE");
  });
});

/**
 * Run it, because a check that compiles proves nothing about a bad day.
 *
 * A `varying` record written shorter than its declared minimum is the failure
 * that is inducible without breaking the machine: COBOL refuses the write and
 * sets status 44. Before this check the record simply was not written: no
 * message, no return code, an output file short by one record and a job that
 * ended saying it had worked.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("stops the job when a write does not happen", () => {
    const result = compile(`module ShortWrite;

record FeedLine {
  payload: string<80>;
}

record Note { idempotencyKey: string<36>; }

file feed sequential output record FeedLine
  varying 10 to 80 length feedLength status feedStatus;

entry transaction emit1(line: FeedLine, note: Note) {
  open feed;
  line.payload = "SHORT";
  feedLength = 5;
  write feed from line;
  close feed;
  audit("SHORT_WRITTEN", note.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-filestatus-"));
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
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });

    expect(ran.stdout).toContain("WRITE FAILED feed STATUS 44");
    expect(ran.status).toBe(12);
  });
});

/**
 * Every I/O statement's status, over every example.
 *
 * The rule is that no I/O statement is left unchecked, rather than merely that
 * unchecked, and the difference only shows on programs nobody wrote for this
 * test. Each file declared in the corpus has to have condition names, and each
 * of its statements a test of them.
 */
describe("across the corpus", () => {
  it("gives every file status field its condition names", () => {
    let fields = 0;
    for (const { example, cobol } of corpus()) {
      const statuses = [
        ...cobol.matchAll(/FILE STATUS IS ([A-Z][A-Z0-9-]*)/g),
      ].map((match) => match[1]);
      fields += statuses.length;

      for (const status of statuses) {
        expect(
          cobol,
          `${example} binds ${status} as a file status and declares no ${status}-OK condition.`,
        ).toContain(`88  ${status}-OK`);
      }
    }

    checked(fields, 20, "file status fields");
  });

  it("tests the status after every I/O statement it declares", () => {
    let statusFields = 0;
    for (const { example, cobol } of corpus()) {
      const statuses = [
        ...cobol.matchAll(/FILE STATUS IS ([A-Z][A-Z0-9-]*)/g),
      ].map((match) => match[1]);
      statusFields += statuses.length;

      for (const status of statuses) {
        const tested = flowed(cobol).split(`${status}-OK`).length - 1;
        expect(
          tested,
          `${example} declares ${status} and tests it ${tested} time(s); a file is opened, used and closed.`,
        ).toBeGreaterThan(1);
      }
    }

    // Its own floor. The loop above shares this file with one that already
    // states a floor, and the meta-test in tests/feature-coverage.test.ts only
    // asks the question once per file, so this one was reachable with nothing
    // to find and would have passed over an empty corpus.
    checked(statusFields, 20, "file status fields");
  });
});
