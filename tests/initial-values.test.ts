import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * `processed: binary<9> = 0;` — a COBOL `VALUE` clause.
 *
 * Working storage starts as whatever the region left there unless a field says
 * otherwise, so a counter with no initial value starts at an unpredictable
 * number. Writing it in the record keeps the fact next to the field, where it
 * cannot drift out of step when the record gains one.
 */

const PREAMBLE = `module Init;

enum Status { OPEN, CLOSED }
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function withRecord(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record Counters {
${body}
  idempotencyKey: string<36>;
}

entry transaction run(counters: Counters) {
  audit("RAN", counters.idempotencyKey);
}`);
}

describe("what a field can start as", () => {
  it("a number", () => {
    const result = withRecord("  processed: binary<9> = 0;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PIC S9(9) COMP VALUE 0.");
  });

  it("a number with a scale", () => {
    expect(withRecord("  rate: decimal<5, 2> = 1.50;").cobol).toContain(
      "PIC S9(3)V99 COMP-3 VALUE 1.50.",
    );
  });

  it("text", () => {
    expect(withRecord('  marker: string<1> = "N";').cobol).toContain(
      'PIC X(1) VALUE "N".',
    );
  });

  it("an enum member", () => {
    const result = withRecord("  state: Status = Status.OPEN;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('PIC X(6) VALUE "OPEN".');
  });

  /**
   * A bool already carries `VALUE 'N'`, being false unless set. An explicit
   * value replaces it rather than being written beside it, which COBOL would
   * reject as two VALUE clauses on one field.
   */
  it("a boolean, without doubling the clause", () => {
    const result = withRecord("  active: bool = true;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('ACTIVE               PIC X VALUE "Y".');
    expect(result.cobol).not.toContain("VALUE 'N' VALUE");
  });

  it("nothing, which is still the default", () => {
    expect(withRecord("  processed: binary<9>;").cobol).toContain(
      "PIC S9(9) COMP.",
    );
  });
});

describe("what it will not take", () => {
  it("a literal of the wrong type", () => {
    expect(ids(withRecord('  processed: binary<9> = "zero";'))).toContain(
      "BANK-COPY-006",
    );
  });

  /** A VALUE longer than its field would be truncated silently. */
  it("text longer than the field", () => {
    expect(ids(withRecord('  marker: string<1> = "NO";'))).toContain(
      "BANK-COPY-006",
    );
  });

  it("a member of another enum", () => {
    const result = compile(`${PREAMBLE}
enum Other { RED, GREEN }

record Counters {
  state: Status = Other.RED;
  idempotencyKey: string<36>;
}

entry transaction run(counters: Counters) {
  audit("RAN", counters.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-COPY-006");
  });

  it("a member the enum does not have", () => {
    expect(ids(withRecord("  state: Status = Status.PENDING;"))).toContain(
      "BANK-COPY-006",
    );
  });

  /** COBOL works a VALUE out when it compiles, so it cannot be computed. */
  it("an expression", () => {
    expect(ids(withRecord("  processed: binary<9> = 1 + 1;"))).toContain(
      "BANK-COPY-006",
    );
  });

  /**
   * A redefining field has no storage of its own — only a second reading of
   * another field's bytes — so a value on it would either be ignored or
   * overwrite one the other field set.
   */
  it("a value on a redefining field", () => {
    const result = withRecord(`  personal: string<20>;
  company: string<20> redefines personal = "ACME";`);

    expect(ids(result)).toContain("BANK-COPY-006");
  });
});

/**
 * COBOL does not allow `VALUE` in the FILE SECTION: an FD record describes a
 * buffer the file fills, so there is nothing to initialise. The same record is
 * emitted in both places, so the clause has to be dropped in one and kept in
 * the other.
 */
describe("the file section", () => {
  const result = compile(`${PREAMBLE}
record Counters {
  processed: binary<9> = 0;
  idempotencyKey: string<36>;
}

file feed sequential output record Counters status feedStatus;

entry transaction run(counters: Counters) {
  audit("RAN", counters.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps the value in working storage and drops it on the FD", () => {
    const text = result.cobol ?? "";
    const fdRecord = text.slice(
      text.indexOf("01  FEED-RECORD."),
      text.indexOf("01  FEED-STATUS"),
    );
    const workingStorage = text.slice(text.indexOf("01  COUNTERS."));

    expect(fdRecord).toContain("PROCESSED");
    expect(fdRecord).not.toContain("VALUE 0");
    expect(workingStorage).toContain("VALUE 0");
  });
});

/** A field that says it starts at a number has to actually start there. */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("starts the field where it says", () => {
    const result = compile(`${PREAMBLE}
record Counters {
  processed: binary<9> = 7;
  rate: decimal<5, 2> = 1.50;
  idempotencyKey: string<36>;
}

entry transaction run(counters: Counters) {
  log "PROC ", counters.processed;
  log "RATE ", counters.rate;
  audit("RAN", counters.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-initial-"));
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

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("000000007");
    expect(ran.stdout).toContain("001.50");
  });
});
