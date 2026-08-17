import { describe, expect, it } from "vitest";

import {
  addStringUsage,
  emptyStringUsage,
} from "../packages/migration-analysis/src/string-usage";

/**
 * The measurement that nearly decided a language feature.
 *
 * `string-usage.json` reported 130 of X-COBOL's 622 `UNSTRING` statements
 * carrying `TALLYING`, and that number was written down as evidence for a
 * bounded field count in BankTS's `split`. It is a true count and the wrong
 * one: 126 of the 130 are `NC218A.CBL`, the NIST CCVS85 conformance test for
 * `UNSTRING`, vendored into five language-tool repositories. Eleven distinct
 * files in 5,195 carry the clause at all, 99 of the statements also carry
 * `WITH POINTER`, and 133 have a single receiver, so what the corpus shows is
 * a scanning loop advancing a pointer, not a line being taken apart into
 * fields and counted.
 *
 * The file had no test of any kind when it produced that number. These are the
 * three things that make the difference between the two readings: distinct
 * file contents rather than statement occurrences, whether a pointer is in
 * play, and how many receivers there are.
 */

/** The shape the corpus's `TALLYING` statements actually have. */
const SCANNING_LOOP = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SCAN.
       PROCEDURE DIVISION.
       SCAN-IT.
           UNSTRING WS-LINE
               DELIMITED BY ","
               INTO WS-FIELD
               WITH POINTER WS-CURSOR
               TALLYING WS-FOUND
           END-UNSTRING.
`;

/** The shape a bounded field count would be: several receivers, no pointer. */
const FIELD_SPLIT = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SPLIT.
       PROCEDURE DIVISION.
       SPLIT-IT.
           UNSTRING WS-LINE
               DELIMITED BY ","
               INTO WS-ONE WS-TWO WS-THREE
               TALLYING WS-FOUND
           END-UNSTRING.
`;

const PLAIN = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. PLAIN.
       PROCEDURE DIVISION.
       DO-IT.
           UNSTRING WS-LINE DELIMITED BY "-" INTO WS-A WS-B.
`;

describe("UNSTRING", () => {
  it("counts the statements and the files that hold them", () => {
    const report = emptyStringUsage();
    addStringUsage(PLAIN, report);
    addStringUsage(SCANNING_LOOP, report);

    expect(report.unstring.statements).toBe(2);
    expect(report.unstring.files).toBe(2);
    expect(report.unstring.singleDelimiter).toBe(2);
  });

  it("separates a scanning pointer from a plain split", () => {
    const report = emptyStringUsage();
    addStringUsage(SCANNING_LOOP, report);
    addStringUsage(FIELD_SPLIT, report);

    expect(report.unstring.tallying).toBe(2);
    expect(report.unstring.tallyingWithPointer).toBe(1);
  });

  /**
   * One receiver is not a field count. The statement pulls a single field out
   * at wherever the pointer is, and the tally says how far the scan got.
   */
  it("separates one receiver from several", () => {
    const report = emptyStringUsage();
    addStringUsage(SCANNING_LOOP, report);
    addStringUsage(FIELD_SPLIT, report);

    expect(report.unstring.tallyingSingleReceiver).toBe(1);
  });

  it("does not count `DELIMITER IN` and `COUNT IN` as receivers", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           UNSTRING WS-LINE
               DELIMITED BY ","
               INTO WS-ONE DELIMITER IN WS-D COUNT IN WS-C
               TALLYING WS-FOUND
           END-UNSTRING.
`,
      report,
    );

    expect(report.unstring.tallyingSingleReceiver).toBe(1);
  });

  /**
   * The whole point. Two copies of one program are one program, and a corpus
   * that gathers 168 repositories is full of them.
   */
  it("counts distinct file contents rather than copies", () => {
    const report = emptyStringUsage();
    addStringUsage(SCANNING_LOOP, report);
    addStringUsage(SCANNING_LOOP, report);
    addStringUsage(FIELD_SPLIT, report);

    expect(report.unstring.tallying).toBe(3);
    expect(report.unstring.tallyingContents).toHaveLength(2);
  });

  it("counts the delimiter forms apart", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           UNSTRING WS-LINE DELIMITED BY ALL SPACE OR "," INTO WS-A.
`,
      report,
    );

    expect(report.unstring.multipleDelimiters).toBe(1);
    expect(report.unstring.singleDelimiter).toBe(0);
    expect(report.unstring.delimitedByAll).toBe(1);
  });

  it("counts an overflow phrase", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           UNSTRING WS-LINE DELIMITED BY "," INTO WS-A
               ON OVERFLOW DISPLAY "TOO MANY"
           END-UNSTRING.
`,
      report,
    );

    expect(report.unstring.onOverflow).toBe(1);
  });
});

describe("STRING and INSPECT", () => {
  it("counts a STRING's clauses", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           STRING WS-A DELIMITED BY SIZE
                  WS-B DELIMITED BY SPACE
               INTO WS-OUT
               WITH POINTER WS-P
               ON OVERFLOW DISPLAY "FULL"
           END-STRING.
`,
      report,
    );

    expect(report.string.statements).toBe(1);
    expect(report.string.delimitedBySize).toBe(1);
    expect(report.string.delimitedByValue).toBe(1);
    expect(report.string.withPointer).toBe(1);
    expect(report.string.onOverflow).toBe(1);
  });

  it("counts an INSPECT's clauses", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           INSPECT WS-A TALLYING WS-N FOR ALL "," BEFORE INITIAL ".".
           INSPECT WS-B REPLACING LEADING " " BY "0".
           INSPECT WS-C CONVERTING "AB" TO "ab".
`,
      report,
    );

    expect(report.inspect.statements).toBe(3);
    expect(report.inspect.tallying).toBe(1);
    expect(report.inspect.replacing).toBe(1);
    expect(report.inspect.converting).toBe(1);
    expect(report.inspect.all).toBe(1);
    expect(report.inspect.leading).toBe(1);
    expect(report.inspect.beforeAfter).toBe(1);
  });
});

describe("reference modification", () => {
  it("separates constant bounds from computed ones", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       PROCEDURE DIVISION.
       DO-IT.
           MOVE WS-A(1:4) TO WS-B.
           MOVE WS-A(WS-I:4) TO WS-B.
           MOVE WS-A(1:WS-L) TO WS-B.
           MOVE WS-A(WS-I:WS-L) TO WS-B.
           MOVE WS-A(5:) TO WS-B.
`,
      report,
    );

    expect(report.referenceModification.total).toBe(5);
    expect(report.referenceModification.constantBoth).toBe(1);
    expect(report.referenceModification.dynamicStart).toBe(1);
    expect(report.referenceModification.dynamicLength).toBe(1);
    expect(report.referenceModification.dynamicBoth).toBe(1);
    expect(report.referenceModification.openEnded).toBe(1);
  });

  /** `PIC X(20)` and `OCCURS 5 TIMES` are not reference modifications. */
  it("does not read a picture as a reference modification", () => {
    const report = emptyStringUsage();
    addStringUsage(
      `       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A PIC X(20).
       01 WS-T OCCURS 5 TIMES PIC 9(4).
`,
      report,
    );

    expect(report.referenceModification.total).toBe(0);
  });
});
