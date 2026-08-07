import { describe, expect, it } from "vitest";

import { formatCobol } from "../packages/cobol-backend/src/format";
import { COBOL_LAST_COLUMN } from "../packages/cobol-backend/src/reference-format";
import { runCobol } from "../packages/cobol-runtime/src/index";
import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { exampleProjects } from "../tools/example-projects";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The reference runtime, so a formatted program can be run against it. */
const RUNTIME_PROGRAMS = [
  "BANKLEDG",
  "BANKAUDT",
  "DSNHLI",
  "DFHEI1",
  "CBLTDLI",
  "BANKMQ",
  "BANKJSON",
  "BANKXML",
];

let cached: string[] | null = null;
function runtime(): string[] {
  cached ??= RUNTIME_PROGRAMS.map(
    (program) =>
      precompile(readFileSync(join("runtime", `${program}.cbl`), "utf8")).cobol,
  );
  return cached;
}

/**
 * The COBOL formatter, held to the one thing a formatter must never do: change
 * what a program does.
 *
 * The obvious test would be that formatting the emitter's own output is a
 * no-op. It is not, and it should not be: the emitter puts some clauses on
 * lines of their own where they would have fitted, and nothing in the text says
 * which of those was a choice and which was a wrap at column 72. A formatter
 * that reproduced it exactly would be a second copy of the emitter.
 *
 * So the corpus is formatted and then *executed*, and the run has to come out
 * the same: the same return code, the same DISPLAY output, the same bytes in
 * every file it wrote. That is a stronger statement than byte-identity, because
 * byte-identity to one emitter is a coincidence of layout and this is the
 * property somebody formatting a program they have to ship actually needs.
 */

/** The generated COBOL for one example. */
function cobolFor(project: string): string {
  const source = readFileSync(join(project, "src/main.bank.ts"), "utf8");
  const result = compile(source, { sourceFile: `${project}/src/main.bank.ts` });
  if (!result.cobol) {
    throw new Error(`${project} does not compile.`);
  }
  return precompile(result.cobol).cobol;
}

describe("formatting generated COBOL", () => {
  for (const project of exampleProjects()) {
    it(`does not change what ${project} does`, () => {
      const cobol = cobolFor(project);
      const formatted = formatCobol(cobol).text;

      // Every line still inside the margin. A formatter that pushes a name past
      // column 72 produces a program the target compiler reads as a different
      // one, with no warning anywhere.
      for (const line of formatted.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
      }

      // And the program runs the same. This is the property that matters, and
      // it is stronger than byte-identity: it says the formatter changed the
      // layout and nothing else. Two of the corpus are not interpretable —
      // Report Writer and a LINAGE print file — and are checked on the margin
      // alone.
      let before;
      try {
        before = runCobol({ sources: [cobol, ...runtime()] });
      } catch {
        return;
      }
      const after = runCobol({ sources: [formatted, ...runtime()] });

      expect(after.returnCode, "RETURN-CODE").toBe(before.returnCode);
      expect(after.sysout, "DISPLAY output").toEqual(before.sysout);
      expect([...after.files.keys()].sort(), "files written").toEqual(
        [...before.files.keys()].sort(),
      );
      for (const [name, records] of before.files) {
        expect(
          (after.files.get(name) ?? []).map((record) =>
            new TextDecoder().decode(record),
          ),
          name,
        ).toEqual(records.map((record) => new TextDecoder().decode(record)));
      }
    });
  }

  it("is idempotent", () => {
    for (const project of exampleProjects()) {
      const once = formatCobol(cobolFor(project)).text;
      expect(formatCobol(once).text, project).toBe(once);
    }
  });
});

describe("formatting COBOL that is not", () => {
  const MANGLED = [
    "       IDENTIFICATION DIVISION.",
    "PROGRAM-ID. MESSY.",
    "DATA DIVISION.",
    "WORKING-STORAGE SECTION.",
    "01  WS-TOTAL PIC S9(9)V99 COMP-3.",
    "01  WS-COUNT PIC S9(4) COMP.",
    "PROCEDURE DIVISION.",
    "MAIN-PARA.",
    "MOVE 0 TO WS-TOTAL",
    "MOVE 3 TO WS-COUNT",
    "PERFORM UNTIL WS-COUNT < 1",
    "COMPUTE WS-TOTAL = WS-TOTAL + 1.50",
    "SUBTRACT 1 FROM WS-COUNT",
    "END-PERFORM",
    "DISPLAY WS-TOTAL UPON SYSOUT",
    "GOBACK.",
    "",
  ].join("\n");

  it("puts the headers in Area A and the statements in Area B", () => {
    const { text } = formatCobol(MANGLED);
    const lines = text.split("\n");

    const areaA = (name: string): number =>
      lines.findIndex((line) => line.trim().startsWith(name));
    expect(lines[areaA("PROGRAM-ID")]?.indexOf("PROGRAM-ID")).toBe(7);
    expect(lines[areaA("WORKING-STORAGE")]?.indexOf("WORKING-STORAGE")).toBe(7);
    expect(lines[areaA("MAIN-PARA")]?.indexOf("MAIN-PARA")).toBe(7);
    expect(lines[areaA("01  WS-TOTAL")]?.indexOf("01")).toBe(7);
    // A statement is Area B, and one inside a PERFORM is one level in from it.
    expect(lines[areaA("MOVE 0")]?.indexOf("MOVE")).toBe(11);
    expect(lines[areaA("SUBTRACT")]?.indexOf("SUBTRACT")).toBe(15);
  });

  it("keeps every line inside the margin", () => {
    for (const line of formatCobol(MANGLED).text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
    }
  });

  it("produces a program that runs the same as the one it was given", () => {
    // The mangled program is free-format enough that a compiler guessing the
    // format would read it; the formatter's job is to make it fixed-format
    // without changing what it does.
    const formatted = formatCobol(MANGLED).text;
    expect(formatted).not.toBe(MANGLED);

    const after = runCobol({ sources: [formatted], entry: "MESSY" });
    // Three iterations of 1.50, displayed from a PIC S9(9)V99: nine integer
    // digits, a point, and two more.
    expect(after.sysout).toEqual(["+000000004.50"]);
    expect(after.returnCode).toBe(0);
  });

  it("is idempotent", () => {
    const once = formatCobol(MANGLED).text;
    const twice = formatCobol(once);
    expect(twice.text).toBe(once);
    expect(twice.unchanged).toBe(true);
  });
});
