import { describe, expect, it } from "vitest";

import { alignPictureColumns } from "../packages/cobol-backend/src/align";
import { COBOL_LAST_COLUMN } from "../packages/cobol-backend/src/reference-format";
import { compile } from "../packages/compiler/src/index";
import { checked, compileExample, corpus } from "./helpers";

/**
 * Where a `PIC` clause starts, which is the one layout rule the rest of the
 * suite is deliberately blind to.
 *
 * Every other test asserts what a field is declared as through `unpadded`,
 * because the width of the gap in front of a clause is not theirs to pin: it
 * is decided here, from the names of the fields around it. Forty tests used to
 * hold it by accident, so renaming one field failed assertions about a
 * different one.
 *
 * The emitter padded to a fixed twenty characters and a longer name simply
 * overran it, which broke the column for the whole block. That is cosmetic and
 * it is the cosmetic a mainframe reviewer reads as "generated".
 */

const PROGRAM = `module Alignment;

type BDT = currency<"BDT", 18, 2>;

enum Outcome { OPEN, CLOSED }

record Posting {
  postingAccountIdentifier: string<16>;
  amt: BDT;
  outcome: Outcome;
  idempotencyKey: string<36>;
}

entry transaction post(posting: Posting) {
  audit("POSTED", posting.idempotencyKey);
}`;

describe("a group of fields", () => {
  const cobol = compile(PROGRAM).cobol ?? "";
  const record = cobol.slice(
    cobol.indexOf("01  POSTING."),
    cobol.indexOf("01  BANK-AUDIT-INTERFACE"),
  );

  /** One column for the record, set by the longest name in it. */
  it("puts every picture in one column, past the longest name", () => {
    const columns = new Set(
      record
        .split("\n")
        .filter((line) => / {2}05 {2}/.test(line) && line.includes("PIC"))
        .map((line) => line.indexOf("PIC")),
    );
    expect(columns.size, `pictures at columns ${[...columns].join(", ")}`).toBe(
      1,
    );
    // Two spaces after the longest name, one after the rest of the padding.
    expect(record).toContain("05  POSTING-ACCOUNT-IDENTIFIER  PIC X(16).");
    expect(record).toContain("05  AMT                         PIC");
  });

  /**
   * A condition name is a column of its own. It sits under the field it
   * qualifies, so lining it up with that field's siblings would put it in a
   * column it is not in.
   */
  it("gives the condition names under a field a column of their own", () => {
    const conditions = record
      .split("\n")
      .filter((line) => line.includes("88  "));
    expect(conditions.length).toBeGreaterThan(1);
    expect(new Set(conditions.map((line) => line.indexOf("VALUE"))).size).toBe(
      1,
    );
  });
});

/**
 * The case the fixed column produced, kept as the smallest statement of it.
 */
describe("a name past the column", () => {
  it("pulls the whole run out to meet it", () => {
    const { emit } = compileExample("examples/account-transfer");
    expect(emit.cobol).toContain(
      '01  VALIDATE-AMOUNT-RESULT  PIC X(1) VALUE "N".',
    );
    expect(emit.cobol).toContain("01  VALIDATE-AMOUNT-P1      PIC");
  });
});

/**
 * The pass runs after reference format, so a wider column cannot be paid for
 * by wrapping: an entry that will not fit keeps the single space the fixed
 * column used to give an over-long name, and the rest of its run still lines
 * up.
 */
describe("the margin", () => {
  it("is never crossed to reach a column", () => {
    // A run whose column is set by a 29-character name, and one entry whose
    // clause is too wide to sit at that column and still end inside 72.
    const wide = `PIC X(30) VALUE ${'"'}${"9".repeat(19)}${'"'}.`;
    const aligned = alignPictureColumns([
      `       01  SHORT                ${wide}`,
      "       01  A-VERY-LONG-GENERATED-NAME    PIC X(1).",
    ]);

    for (const line of aligned) {
      expect(line.length).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
    }
    // The one that fits reached the column; the one that could not is as far
    // out as the margin allowed, rather than dragging the run back with it.
    expect(aligned[1]).toBe("       01  A-VERY-LONG-GENERATED-NAME  PIC X(1).");
    expect(aligned[0]!.indexOf("PIC")).toBeLessThan(aligned[1]!.indexOf("PIC"));
    expect(aligned[0]).toMatch(/^ {7}01 {2}SHORT {2,}PIC/);
  });

  it("holds across every generated program", () => {
    let entries = 0;
    for (const { example, cobol } of corpus()) {
      for (const [index, line] of cobol.split("\n").entries()) {
        if (/^\s+\d{2}\s\s+[A-Z]/.test(line)) {
          entries += 1;
        }
        expect(
          line.length,
          `${example} line ${String(index + 1)} runs past the margin`,
        ).toBeLessThanOrEqual(COBOL_LAST_COLUMN);
      }
    }
    checked(entries, 200, "data description entries");
  });
});

/**
 * The REPORT SECTION is not data description. An `01` there may carry `TYPE IS
 * PAGE HEADING` with no name at all, and `COLUMN 1 PIC X(22)` puts a number
 * where a name goes — read as "name, then clause" it became
 * `01  TYPE            IS PAGE HEADING.`
 */
describe("the report section", () => {
  it("is left alone", () => {
    const { emit } = compileExample("examples/report-with-controls");
    expect(emit.cobol).toContain("01  TYPE IS PAGE HEADING.");
    expect(emit.cobol).toContain("10  COLUMN 1 PIC X(22)");
  });
});
