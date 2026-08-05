import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `log`, `accept`, and `reset` — `DISPLAY`, `ACCEPT`, and `INITIALIZE`.
 *
 * The job log is the operator's only view of what happened between the return
 * code and an abend, and a job parameter is how the same program runs a
 * different cycle. A batch with neither is a black box.
 */

const PREAMBLE = `module Ops;

type BDT = currency<"BDT", 18, 2>;

record Run1 {
  mode1: string<8>;
  runDate: date;
  startedAt: time;
  count1: decimal<9, 0>;
  sensitive pan: string<19>;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction go1(run1: Run1) {
${body}
  audit("RAN", run1.idempotencyKey);
}`);
}

describe("log", () => {
  /**
   * `UPON SYSOUT` rather than a bare DISPLAY, so the message lands in the job's
   * output where an operator reads it rather than wherever the runtime defaults
   * to.
   */
  it("displays upon SYSOUT", () => {
    const result = txn('  log "STARTED ", run1.mode1;');

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'DISPLAY "STARTED " MODE1 OF RUN1 UPON SYSOUT',
    );
  });

  /**
   * The log outlives the run and is read widely, which is the same reason a
   * restricted value may not reach an audit event.
   */
  it("refuses to write restricted data to it", () => {
    expect(ids(txn('  log "PAN ", run1.pan;'))).toContain("BANK-AUD-002");
  });
});

describe("accept", () => {
  it("reads a job parameter as text", () => {
    const result = txn("  accept parameter into run1.mode1;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("ACCEPT MODE1 OF RUN1 FROM SYSIN");
  });

  /** `FROM DATE YYYYMMDD` gives the four-digit year the bare form does not. */
  it("reads the clock into a date", () => {
    const result = txn("  accept date into run1.runDate;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "ACCEPT RUN-DATE OF RUN1 FROM DATE YYYYMMDD",
    );
  });

  it("reads the clock into a time", () => {
    expect(txn("  accept time into run1.startedAt;").cobol).toContain(
      "ACCEPT STARTED-AT OF RUN1 FROM TIME",
    );
  });

  it("rejects a target the source cannot deliver", () => {
    expect(ids(txn("  accept parameter into run1.count1;"))).toContain(
      "BANK-TYPE-003",
    );
    expect(ids(txn("  accept date into run1.mode1;"))).toContain(
      "BANK-TYPE-003",
    );
  });
});

describe("reset", () => {
  /**
   * Clearing a group field by field is the same thing written out, and drifts
   * the moment the record gains a field.
   */
  it("initializes a whole record", () => {
    const result = txn("  reset run1;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("INITIALIZE RUN1");
  });

  it("clears a record, not a field", () => {
    expect(ids(txn("  reset mode1;"))).toContain("BANK-TYPE-003");
  });
});
