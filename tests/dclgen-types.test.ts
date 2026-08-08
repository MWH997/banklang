import { describe, expect, it } from "vitest";

import {
  bankTsTypeForSql,
  importDclgen,
} from "../packages/copybook/src/dclgen";
import { diffGeneratedCopybooks } from "../packages/copybook/src/index";
import { importCopybook } from "../packages/copybook/src/import";

/**
 * The SQL type a DCLGEN declares, and the BankTS type it becomes.
 *
 * This is the mapping that decides how wide a field is when a customer's own
 * DB2 declaration is imported, and getting one wrong moves every field after it
 * in the record. It scored 61.67% in the tools mutation lane with 69 surviving
 * mutants, because the importer is exercised through whole DCLGEN members that
 * happen to use a handful of types.
 *
 * Asked directly here, one row per type, including the ones that must be
 * *refused*. A type this compiler cannot represent has to arrive as a stated
 * problem rather than as a plausible guess: a silent `string<1>` for a `BLOB`
 * is a field the program reads at the wrong offset for ever after.
 */

describe("a SQL type from a DCLGEN", () => {
  const accepted: [string, string][] = [
    ["CHAR(8)", "string<8>"],
    ["CHARACTER(4)", "string<4>"],
    // No length is one character, which is what SQL means by a bare CHAR.
    ["CHAR", "string<1>"],
    ["CHARACTER", "string<1>"],
    ["DECIMAL(9,2)", "decimal<9, 2>"],
    ["DEC(5,0)", "decimal<5, 0>"],
    ["INTEGER", "binary<9>"],
    ["SMALLINT", "binary<4>"],
    ["BIGINT", "binary<18>"],
    // Db2 hands these over as their character representations.
    ["DATE", "string<10>"],
    ["TIME", "string<8>"],
    ["TIMESTAMP", "timestamp"],
  ];

  for (const [sql, bankTs] of accepted) {
    it(`reads ${sql} as ${bankTs}`, () => {
      const result = bankTsTypeForSql(sql);
      expect(result.text).toBe(bankTs);
      expect(result.problem).toBeUndefined();
    });
  }

  const refused: [string, RegExp][] = [
    ["VARCHAR(20)", /varying-length/i],
    ["VARGRAPHIC(10)", /varying-length/i],
    ["REAL", /floating point/i],
    ["DOUBLE", /floating point/i],
    ["BLOB", /No BankTS type/i],
    ["CLOB", /No BankTS type/i],
  ];

  for (const [sql, because] of refused) {
    it(`refuses ${sql}, and says why`, () => {
      const result = bankTsTypeForSql(sql);
      // Empty text and a problem, not a plausible guess: a wrong width here
      // moves every field after it.
      expect(result.text).toBe("");
      expect(result.problem).toMatch(because);
    });
  }

  it("keeps the precision and the scale apart", () => {
    // `decimal<9, 2>` and `decimal<2, 9>` are different records.
    expect(bankTsTypeForSql("DECIMAL(9,2)").text).toBe("decimal<9, 2>");
    expect(bankTsTypeForSql("DECIMAL(2,9)").text).toBe("decimal<2, 9>");
  });

  it("does not read a length as a different length", () => {
    expect(bankTsTypeForSql("CHAR(1)").text).toBe("string<1>");
    expect(bankTsTypeForSql("CHAR(255)").text).toBe("string<255>");
  });
});

/**
 * An elementary item that declares no PICTURE.
 *
 * `05 RATE-FIELD COMP-1.` is a four-byte float and has no picture, and the
 * importer read "no PIC" as "group". It produced an empty record, reported no
 * problem, and gave the field zero bytes — so `ACCOUNT-ID` declared after it
 * landed at offset 0 instead of 4, and every field after that was wrong too.
 *
 * That is the one failure a copybook exists to prevent, and it was silent. It
 * was found by the tools mutation lane: eight uncovered mutants on the binary
 * size table led here, because nothing exercised a field that has a usage and
 * no picture.
 *
 * There is no correct import for any of these. BankTS has no binary floating
 * point — the same reason DCLGEN refuses `REAL` and `DOUBLE` — and an index or
 * a pointer is a run-time address rather than a value a record can carry.
 */
describe("a copybook field with a usage and no picture", () => {
  const book = (declaration: string) => `       01  TEST-REC.
           05  A-FIELD    ${declaration}
           05  ACCOUNT-ID PIC X(16).
`;

  const refused: [string, RegExp][] = [
    ["COMP-1.", /floating point/i],
    ["COMP-2.", /floating point/i],
    ["COMPUTATIONAL-1.", /floating point/i],
    ["INDEX.", /run-time address/i],
    ["POINTER.", /run-time address/i],
  ];

  for (const [declaration, because] of refused) {
    it(`refuses ${declaration} rather than importing it as a group`, () => {
      const result = importCopybook(book(declaration));
      expect(
        result.problems.map((problem) => problem.message).join("\n"),
      ).toMatch(because);
      // And it does not appear in the record as an empty group.
      expect(result.source).not.toContain("record AField");
    });
  }

  it("still imports the fields around it", () => {
    // The problem names one field; the rest of the record is still readable,
    // which is what makes the message actionable rather than fatal.
    expect(importCopybook(book("COMP-1.")).source).toContain(
      "accountId: string<16>",
    );
  });

  it("does not refuse a group, which legitimately has no picture", () => {
    const grouped = `       01  TEST-REC.
           05  NAME-PART.
               10  FIRST-NAME PIC X(10).
               10  LAST-NAME  PIC X(10).
           05  ACCOUNT-ID PIC X(16).
`;
    const result = importCopybook(grouped);
    expect(result.problems).toEqual([]);
    expect(result.source).toContain("record NamePart");
  });

  it("does not refuse a picture that merely mentions a binary usage", () => {
    // `PIC S9(9) COMP` is binary integer, not floating point, and imports.
    const result = importCopybook(book("PIC S9(9) COMP."));
    expect(result.problems).toEqual([]);
  });
});

/**
 * A copybook arrives in reference format, written by somebody else.
 *
 * Columns 1-6 are the sequence area, column 7 is the indicator, and anything
 * past 72 is not part of the program. Reading any of those as code puts a field
 * in the record that is not in the copybook, or drops one that is — and either
 * moves every offset after it.
 *
 * The importer handles all of this, and nothing asserted it: the mutation lane
 * found the column-72 slice, the indicator test and the blank-line skip all
 * surviving. These are the shapes a customer's copybook actually arrives in.
 */
describe("a copybook in reference format", () => {
  const oneField = (source: string) => {
    const result = importCopybook(source);
    expect(result.problems).toEqual([]);
    expect(result.recordName).toBe("R");
    return (result.source.match(/^\s+\w+: /gm) ?? []).length;
  };

  it("reads a plain one", () => {
    expect(oneField("       01  R.\n           05  A  PIC X(4).\n")).toBe(1);
  });

  it("skips a comment marked in column 7", () => {
    expect(
      oneField(
        "       01  R.\n      * this is a comment\n           05  A  PIC X(4).\n",
      ),
    ).toBe(1);
  });

  it("skips a page eject, which is also an indicator", () => {
    expect(
      oneField(
        "       01  R.\n      / page eject\n           05  A  PIC X(4).\n",
      ),
    ).toBe(1);
  });

  it("ignores anything past column 72", () => {
    // The identification area holds a change tag, not a field.
    const withTag =
      "       01  R.\n" +
      "           05  A  PIC X(4).".padEnd(72, " ") +
      "IGNORED-SEQ\n";
    expect(oneField(withTag)).toBe(1);
  });

  it("ignores the sequence area", () => {
    expect(oneField("000100 01  R.\n000200     05  A  PIC X(4).\n")).toBe(1);
  });

  it("skips a blank line between entries", () => {
    expect(oneField("       01  R.\n\n           05  A  PIC X(4).\n")).toBe(1);
  });
});

/**
 * The column list, split on the commas that separate columns.
 *
 * `DECIMAL(15, 2)` carries a comma of its own, so the split is depth-aware.
 * Getting that wrong does not fail: it produces a column called `2)` and loses
 * the one after it, which is a record with the wrong fields at the wrong
 * offsets — read from a real table.
 *
 * The mutation lane found the depth counter surviving in both directions, and
 * the checked-in member is the only DCLGEN anything ran over.
 */
describe("a DCLGEN column list", () => {
  const member = (columns: string, pictures: string) =>
    `           EXEC SQL DECLARE BANKDB.T TABLE
           ( ${columns}
           ) END-EXEC.
       01  DCLT.
${pictures}
`;

  const columnsOf = (source: string) =>
    (source.match(/^\s+(\w+):/gm) ?? []).map((line) =>
      line.trim().replace(":", ""),
    );

  it("does not split on the comma inside a precision and scale", () => {
    const result = importDclgen(
      member(
        `A DECIMAL(15, 2) NOT NULL,
             B DECIMAL(9, 4) NOT NULL,
             C CHAR(8) NOT NULL`,
        `           10 A PIC S9(13)V9(2) USAGE COMP-3.
           10 B PIC S9(5)V9(4) USAGE COMP-3.
           10 C PIC X(8).`,
      ),
    );
    expect(result.problems).toEqual([]);
    expect(columnsOf(result.source)).toEqual(["a", "b", "c"]);
  });

  it("reads a single column with no separator at all", () => {
    const result = importDclgen(
      member("A CHAR(4) NOT NULL", "           10 A PIC X(4)."),
    );
    expect(columnsOf(result.source)).toEqual(["a"]);
  });

  it("reads the last column when it is the one carrying parentheses", () => {
    // The tail after the final comma is pushed separately; a decimal there is
    // where an off-by-one in the depth counter shows up.
    const result = importDclgen(
      member(
        `A CHAR(8) NOT NULL,
             B DECIMAL(15, 2)`,
        `           10 A PIC X(8).
           10 B PIC S9(13)V9(2) USAGE COMP-3.`,
      ),
    );
    expect(columnsOf(result.source)).toEqual(["a", "b"]);
  });
});

/**
 * Comparing two copybooks, which is how an import is shown to have worked.
 *
 * A copybook is a contract about bytes, so `bankc copybook diff` answers one
 * question: same names, same order, same offsets, same lengths. The mutation
 * lane found its comparisons surviving — the record-name test, the total-length
 * test and the per-field test each flipped without anything noticing.
 *
 * Each shape below is a different way an import can be wrong, and they have to
 * be told apart: a renamed record with an identical layout is a cosmetic
 * difference, and a field one byte wider moves everything after it.
 */
describe("comparing two copybooks", () => {
  const record = (name: string, fields: string) =>
    `       01  ${name}.\n${fields}`;
  const FIELDS =
    "           05  ACCOUNT-ID  PIC X(16).\n           05  BALANCE     PIC S9(13)V99 COMP-3.\n";
  const ORIGINAL = record("ACCT-REC", FIELDS);

  const changed = (diff: ReturnType<typeof diffGeneratedCopybooks>) =>
    diff.fieldDiffs.filter(
      (field) =>
        !field.left ||
        !field.right ||
        field.left.cobolName !== field.right.cobolName ||
        field.left.offset !== field.right.offset ||
        field.left.length !== field.right.length,
    ).length;

  it("calls two identical copybooks identical", () => {
    const diff = diffGeneratedCopybooks(ORIGINAL, ORIGINAL);
    expect(diff.identical).toBe(true);
    expect(diff.recordNameDiffers).toBe(false);
    expect(diff.totalLengthDiffers).toBe(false);
    expect(changed(diff)).toBe(0);
  });

  it("separates a renamed record from a changed layout", () => {
    // The bytes are the same; only the name a program refers to it by moved.
    const diff = diffGeneratedCopybooks(ORIGINAL, record("ACCTREC", FIELDS));
    expect(diff.identical).toBe(false);
    expect(diff.recordNameDiffers).toBe(true);
    expect(diff.totalLengthDiffers).toBe(false);
    expect(changed(diff)).toBe(0);
  });

  it("reports a renamed field without claiming the record grew", () => {
    const diff = diffGeneratedCopybooks(
      ORIGINAL,
      record(
        "ACCT-REC",
        "           05  ACCT-ID     PIC X(16).\n           05  BALANCE     PIC S9(13)V99 COMP-3.\n",
      ),
    );
    expect(diff.totalLengthDiffers).toBe(false);
    expect(changed(diff)).toBe(1);
  });

  it("reports every field a widened one moved", () => {
    // Four more bytes in the first field is a new offset for the second, so
    // both differ — which is the thing a reader has to see.
    const diff = diffGeneratedCopybooks(
      ORIGINAL,
      record(
        "ACCT-REC",
        "           05  ACCOUNT-ID  PIC X(20).\n           05  BALANCE     PIC S9(13)V99 COMP-3.\n",
      ),
    );
    expect(diff.totalLengthDiffers).toBe(true);
    expect(changed(diff)).toBe(2);
  });

  it("reports a field present on one side only, in both directions", () => {
    const dropped = diffGeneratedCopybooks(
      ORIGINAL,
      record("ACCT-REC", "           05  ACCOUNT-ID  PIC X(16).\n"),
    );
    expect(dropped.identical).toBe(false);
    expect(changed(dropped)).toBe(1);

    const added = diffGeneratedCopybooks(
      ORIGINAL,
      record("ACCT-REC", `${FIELDS}           05  EXTRA       PIC X(2).\n`),
    );
    expect(added.identical).toBe(false);
    expect(changed(added)).toBe(1);
  });
});
