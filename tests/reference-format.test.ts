import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  emitCobol,
  emitJcl,
  renderCopybook,
} from "../packages/cobol-backend/src/index";
import {
  COBOL_LAST_COLUMN,
  JCL_LAST_COLUMN,
  toJclStatement,
  toReferenceFormat,
} from "../packages/cobol-backend/src/reference-format";
import { checked, compileExample, corpus, unpadded } from "./helpers";

/**
 * COBOL reference format, which is the shape of the page rather than of the
 * program — and which z/OS enforces absolutely.
 *
 * Enterprise COBOL reads a 72-character line: columns 1-6 sequence number,
 * column 7 indicator, 8-11 Area A, 12-72 Area B. Columns 73-80 are the
 * identification area and are not part of the program, and there is no compiler
 * option on z/OS that widens any of it.
 *
 * Every generated program used to break both halves of this. The three header
 * comments started in column 1, which puts their fourth character in the
 * indicator area, and hundreds of lines ran past column 72 — where the compiler
 * does not truncate with a diagnostic, it simply does not see the rest, so
 * `ACCOUNT-INPUT-STATUS` arrives as `ACCOUNT-INPUT-S` and the compile fails on a
 * name the source appears to define.
 *
 * None of it was caught because the local validator passed `-free`, and because
 * GnuCOBOL reading a file whose first line starts in column 1 switches to free
 * format on its own — where no column means anything. Every `cobc` invocation
 * in this repository is now `-fixed`.
 */

const cobcAvailable =
  spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

/** The examples whose artifacts are checked whole. */
const EXAMPLES = [
  "examples/account-file-batch",
  "examples/account-posting",
  "examples/account-transfer",
  "examples/amortisation-schedule",
  "examples/batch-interest-accrual",
  "examples/branch-accrual-cursor",
  "examples/interest-posting-batch",
  "examples/online-enquiry",
  "examples/statement-generation",
  "examples/withdrawal-with-recovery",
];

function offenders(text: string, last: number): string[] {
  return text
    .split("\n")
    .filter((line) => line.length > last)
    .map((line) => `${line.length}: ${line}`);
}

describe("the margin", () => {
  it("leaves a line that already fits exactly alone", () => {
    const line = `${" ".repeat(11)}${"A".repeat(61)}`;

    expect(line.length).toBe(COBOL_LAST_COLUMN);
    expect(toReferenceFormat(line)).toEqual([line]);
  });

  it("breaks a longer statement into lines that all fit", () => {
    const line = `           MOVE POSTING-ACCOUNT-ID OF POSTING-RECORD TO POSTING-ACCOUNT-ID OF POSTING-OUTPUT-RECORD`;
    const wrapped = toReferenceFormat(line);

    expect(wrapped.length).toBeGreaterThan(1);
    for (const wrappedLine of wrapped) {
      expect(wrappedLine.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
    }
    // Area A of a continuation line must be blank, so every one of them starts
    // in Area B — column 12, which is index 11.
    for (const continuation of wrapped.slice(1)) {
      expect(continuation.search(/\S/)).toBeGreaterThanOrEqual(11);
    }
    expect(wrapped.join(" ").replace(/\s+/g, " ").trim()).toBe(
      line.trim().replace(/\s+/g, " "),
    );
  });

  /**
   * The columns a record lines its pictures up in are why anyone can read a
   * layout at a glance. An earlier version of the wrapper rebuilt the line from
   * its words and put single spaces between them, which fits and compiles and
   * turns every copybook into a wall of text.
   */
  it("keeps the spacing a data description entry was written with", () => {
    const line =
      "           05  LEGACY-BALANCE       PIC S9(9)V99 SIGN IS TRAILING SEPARATE.";
    const wrapped = toReferenceFormat(line);

    expect(unpadded(wrapped[0])).toContain("05 LEGACY-BALANCE PIC");
  });

  it("continues a comment as a comment", () => {
    const line = `       *> ${"word ".repeat(30).trim()}`;

    for (const wrapped of toReferenceFormat(line)) {
      expect(wrapped.trimStart().startsWith("*>")).toBe(true);
      expect(wrapped.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
    }
  });
});

/**
 * A literal wider than the line, which is the one case a break at a space
 * cannot solve.
 *
 * The rule is unforgiving: every column of a continued line through column 72
 * counts as part of the literal, so the line has to be filled to the margin
 * exactly — stopping one column short pads the value with a blank. The
 * continuation carries a hyphen in the indicator area and reopens the literal
 * with a quote, and only the last one closes it. Without the hyphen the two
 * halves are two literals, and a `DISPLAY` prints the first and drops the rest.
 */
describe("a literal that does not fit", () => {
  const value =
    "The quick brown fox jumps over the lazy dog, and then it does the whole thing again twice over.";
  const statement = `                   DISPLAY "${value}" UPON SYSOUT`;

  it("fills the continued line to the margin and hyphenates the next", () => {
    const wrapped = toReferenceFormat(statement);
    // The lines holding the literal: the hyphen sits in column 7, so what
    // marks one is a quote as the first thing in Area A or B.
    const continued = wrapped.filter((line) =>
      line.slice(7).trimStart().startsWith('"'),
    );

    expect(continued.length).toBeGreaterThan(1);
    // Every line but the last one that holds part of the literal runs to the
    // margin exactly, and every line after the first carries the hyphen.
    for (const line of continued.slice(0, -1)) {
      expect(line.length).toBe(COBOL_LAST_COLUMN);
    }
    for (const line of continued.slice(1)) {
      expect(line[6]).toBe("-");
      expect(line.slice(0, 6)).toBe("      ");
    }
  });

  it.skipIf(!cobcAvailable)("survives the round trip through cobc", () => {
    const dir = mkdtempSync(join(tmpdir(), "bankc-refformat-"));
    const file = join(dir, "litproof.cbl");
    writeFileSync(
      file,
      `${[
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. LITPROOF.",
        "       PROCEDURE DIVISION.",
        ...toReferenceFormat(statement),
        "           GOBACK.",
      ].join("\n")}\n`,
      "utf8",
    );

    const built = spawnSync(
      "cobc",
      ["-x", "-fixed", "-Wcolumn-overflow", file, "-o", join(dir, "litproof")],
      { encoding: "utf8" },
    );
    expect(`${built.stdout}${built.stderr}`).not.toMatch(/error|warning/);

    const ran = spawnSync(join(dir, "litproof"), [], { encoding: "utf8" });
    expect(ran.stdout.trim()).toBe(value);
  });
});

describe("JCL card images", () => {
  /**
   * A JOB card naming a long program runs past column 71, and what is lost is
   * the tail — `NOTIFY=&SYSUID` disappearing is the mild case; an operand cut in
   * half flushes the job with a JCL error before a step runs.
   */
  it("continues a JOB card after a complete parameter", () => {
    const card =
      "//BATCHINT JOB (BANKLANG),'BATCH-INTEREST-ACCRUAL',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID";
    const cards = toJclStatement(card);

    expect(cards.length).toBe(2);
    for (const line of cards) {
      expect(line.length).toBeLessThanOrEqual(JCL_LAST_COLUMN);
    }
    // The comma at the break is what says the statement continues, and the
    // continuation resumes between columns 4 and 16 after `//` and a blank.
    expect(cards[0]!.endsWith(",")).toBe(true);
    expect(cards[1]!.startsWith("//")).toBe(true);
    expect(cards[1]![2]).toBe(" ");
    const resumesAt = cards[1]!.slice(2).search(/\S/) + 3;
    expect(resumesAt).toBeGreaterThanOrEqual(4);
    expect(resumesAt).toBeLessThanOrEqual(16);
  });

  /** A comma inside apostrophes or brackets is not a parameter boundary. */
  it("does not break inside a quoted parameter", () => {
    const card = `//STEP1    EXEC PGM=IEFBR14,PARM='${"A,".repeat(40)}',REGION=0M`;

    for (const line of toJclStatement(card)) {
      expect(line.length).toBeLessThanOrEqual(JCL_LAST_COLUMN);
    }
  });
});

/**
 * The reference stubs are hand-written, and they are compiled by the same
 * `-fixed` invocations as everything else. Two of them were added past the
 * margin and only the compiler noticed, which is the whole argument for
 * checking it here rather than by eye.
 */
describe("the reference runtime", () => {
  for (const file of readdirSync("runtime").filter((name) =>
    name.endsWith(".cbl"),
  )) {
    it(`writes runtime/${file} within the reference format`, () => {
      const text = readFileSync(join("runtime", file), "utf8");

      expect(offenders(text, COBOL_LAST_COLUMN)).toEqual([]);
      for (const line of text.split("\n")) {
        if (line.length >= 7) {
          expect([" ", "*", "/", "-", "D"]).toContain(line[6]);
        }
        expect(line.slice(0, 6).trim()).toBe("");
      }
    });
  }
});

describe("every generated artifact", () => {
  for (const example of EXAMPLES) {
    it(`writes ${example} within the reference format`, () => {
      const { ir } = compileExample(example);
      if (!ir.program) {
        throw new Error(`Expected ${example} to compile.`);
      }
      const emit = emitCobol(ir.program);
      const job = emitJcl(ir.program);

      expect(offenders(emit.cobol, COBOL_LAST_COLUMN)).toEqual([]);
      expect(offenders(job.jcl, JCL_LAST_COLUMN)).toEqual([]);
      for (const record of ir.program.records) {
        expect(offenders(renderCopybook(record), COBOL_LAST_COLUMN)).toEqual(
          [],
        );
      }

      // Column 7 is the indicator area: blank, `*` or `/` for a comment, `-`
      // for a continued literal, `D` for a debugging line. Anything else is
      // rejected, which is what a comment starting in column 1 produced.
      //
      // A `CBL` statement is the exception, and the Programming Guide makes it
      // one: it is a compiler-directing statement rather than a source line,
      // and with no sequence field it "can start in column 1 or after". It has
      // no indicator area, so it has no rule about column 7 to break.
      for (const line of emit.cobol.split("\n")) {
        if (/^(?:CBL|PROCESS)\s/.test(line)) {
          expect(line.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
          continue;
        }
        if (line.length >= 7) {
          expect([" ", "*", "/", "-", "D"]).toContain(line[6]);
        }
        // Columns 1-6 are the sequence number area and this compiler does not
        // number its lines, so nothing belongs there.
        expect(line.slice(0, 6).trim()).toBe("");
      }
    });
  }
});

/**
 * The margin, over every example rather than the ones named above.
 *
 * A statement wider than Area B is continued rather than truncated, and a
 * literal broken at the margin carries a hyphen in the indicator area. The
 * compiler reads to column 72 and discards the rest without a diagnostic, so
 * an over-long line is a statement silently changed.
 */
describe("across the corpus", () => {
  it("ends every line at column 72", () => {
    let lines = 0;
    for (const { example, cobol } of corpus()) {
      lines += cobol.split("\n").length;
      const over = cobol
        .split("\n")
        .map((line, index) => ({ line, at: index + 1 }))
        .filter((entry) => entry.line.length > 72);

      expect(
        over.map((entry) => `${example}:${entry.at}`),
        `${example} writes past column 72, where the compiler stops reading.`,
      ).toEqual([]);
    }

    checked(lines, 2000, "generated lines");
  });

  it("continues a broken literal with a hyphen in the indicator area", () => {
    for (const { example, cobol } of corpus()) {
      const lines = cobol.split("\n");
      lines.forEach((line, index) => {
        // An odd number of delimiters means the literal opened here and is
        // closed on the next line, which therefore has to be a continuation.
        const quotes = (line.match(/"/g) ?? []).length;
        if (quotes % 2 === 0 || index + 1 >= lines.length) {
          return;
        }
        expect(
          lines[index + 1]![6],
          `${example}:${index + 2} continues a literal without a hyphen in column 7.`,
        ).toBe("-");
      });
    }
  });
});
