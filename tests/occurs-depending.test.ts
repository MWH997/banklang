import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * The object of an `OCCURS DEPENDING ON`, and what it decides.
 *
 * The Language Reference gives no latitude: "The behavior is undefined if the
 * value of the object is outside of the range integer-1 through integer-2." The
 * object is what makes the group containing the table variable, so its value
 * decides how long that record is — a count of 30,000 on a table declared
 * `OCCURS 1 TO 100` makes every group reference to the record run off the end
 * of the storage the record actually has.
 *
 * It is least controlled exactly where it matters most: the count usually
 * arrives in the record read from the file, so it holds whatever was in the
 * dataset rather than anything the program worked out.
 */

const PREAMBLE = `module Odo;

record Entry {
  amount: decimal<9, 2>;
}

record Batch {
  idempotencyKey: string<36>;
  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;
}
`;

const GUARD = "IF LINE-COUNT OF BATCH < 1 OR LINE-COUNT OF BATCH > 100";

describe("a count the program assigns", () => {
  const result = compile(`${PREAMBLE}
entry transaction run(batch: Batch, n: binary<4>) {
  batch.lineCount = n;
  audit("RAN", batch.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("is checked against the table it is the length of", () => {
    expect(result.cobol).toContain(GUARD);
    expect(flowed(result.cobol)).toContain(
      'DISPLAY "OCCURS COUNT OUT OF RANGE LINE-COUNT OF BATCH "',
    );
  });
});

describe("a count that arrives from the file", () => {
  const result = compile(`${PREAMBLE}
file batches sequential input record Batch status batchStatus;

entry transaction run(batch: Batch) {
  open batches;
  read batches into batch;
  close batches;
  audit("RAN", batch.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("is checked before anything uses it", () => {
    const text = flowed(result.cobol);
    expect(text).toContain(
      flowed("MOVE LINE-COUNT OF BATCHES-RECORD TO LINE-COUNT OF BATCH"),
    );
    expect(text).toContain(GUARD);
    // The check sits between the move that fills it and the loop that trusts it.
    expect(text.indexOf(GUARD)).toBeLessThan(
      text.indexOf("PERFORM VARYING BANK-COPY-INDEX"),
    );
  });

  /**
   * A table is only as long as its count says. Copying to the declared maximum
   * reads occurrences the record does not have — past the end of the data the
   * READ delivered.
   */
  it("copies the occurrences the record has, not the maximum", () => {
    const text = flowed(result.cobol);
    expect(text).toContain(
      flowed("UNTIL BANK-COPY-INDEX > LINE-COUNT OF BATCH"),
    );
    expect(text).not.toContain(flowed("UNTIL BANK-COPY-INDEX > 100"));
  });
});

/** A table with a fixed bound has no count, and nothing to check. */
describe("a table that does not depend on a count", () => {
  it("still copies to its declared length", () => {
    const result = compile(`module Fixed;

record Entry {
  amount: decimal<9, 2>;
}

record Batch {
  idempotencyKey: string<36>;
  lines: Entry[4];
}

file batches sequential input record Batch status batchStatus;

entry transaction run(batch: Batch) {
  open batches;
  read batches into batch;
  close batches;
  audit("RAN", batch.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(flowed("UNTIL BANK-COPY-INDEX > 4"));
    expect(result.cobol).not.toContain("OCCURS COUNT OUT OF RANGE");
  });
});

/**
 * Run, with a count the table cannot have.
 *
 * The count is planted the way a caller would supply it. Before the check
 * existed the program took it, and every later group reference to that record
 * was computed from a length the storage does not have — a record described as
 * 2,538 bytes long when 538 were allocated for it.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  function run(count: number): { stdout: string; status: number | null } {
    const result = compile(`${PREAMBLE}
entry transaction run(batch: Batch, n: binary<4>) {
  batch.lineCount = n;
  batch.lines[1].amount = 1.00;
  audit("RAN", batch.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const cobol = (result.cobol ?? "").replace(
      "           PERFORM RUN-FLD\n",
      `           MOVE ${count} TO RUN-FLD-P2\n           PERFORM RUN-FLD\n`,
    );
    expect(cobol).toContain(`MOVE ${count} TO RUN-FLD-P2`);

    const dir = mkdtempSync(join(tmpdir(), "bankc-odo-"));
    writeFileSync(join(dir, "program.cbl"), cobol, "utf8");

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
    return { stdout: ran.stdout, status: ran.status };
  }

  it.skipIf(!available)("refuses a count the table cannot have", () => {
    const out = run(500);
    expect(out.stdout).toContain("OCCURS COUNT OUT OF RANGE");
    expect(out.status).toBe(12);
  });

  it.skipIf(!available)("refuses a count of zero", () => {
    const out = run(0);
    expect(out.stdout).toContain("OCCURS COUNT OUT OF RANGE");
    expect(out.status).toBe(12);
  });

  it.skipIf(!available)("leaves a count the table has alone", () => {
    const out = run(5);
    expect(out.stdout).not.toContain("OCCURS COUNT OUT OF RANGE");
    expect(out.status).toBe(0);
  });
});
