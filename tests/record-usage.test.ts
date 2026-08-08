import { describe, expect, it } from "vitest";

import {
  addRecordUsage,
  emptyRecordUsage,
  fileRecordShapes,
} from "../packages/migration-analysis/src/record-usage";

/**
 * The measurement that decided a language feature.
 *
 * `record-usage.json` is why BankTS carries several record layouts on an output
 * file and refuses them on an input one: 2,812 of X-COBOL's 6,451 file
 * descriptions declare more than one record, 2,663 of those are opened
 * `OUTPUT`, and 143 are opened `INPUT`. A published number that decides what
 * goes into a language has to be a number somebody can check, and the analyser
 * that produces it had no test at all — 318 mutants, none covered.
 *
 * Detection rather than parsing, because these files do not compile without
 * copybooks nobody has, so what is asserted here is the shape of the detection:
 * where an FD's entries begin and end, which of the four things "several
 * records" can mean this is, and how the program opened the file.
 */

/** The canonical variant file, as `dscobol@Cobol-Projects/BDS1003.cbl` has it. */
const VARIANTS = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. BDS1003.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT TRANSACTIONFILE ASSIGN TO "TRANS.DAT"
           ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD TRANSACTIONFILE
           LABEL RECORDS ARE STANDARD
           RECORDING MODE IS V
           BLOCK CONTAINS 0 RECORDS.
       01 INSERTIONREC.
           88 ENDOFTRANSFILE     VALUE HIGH-VALUES.
           02 TYPECODE-TF        PIC 9.
              88 INSERTION      VALUE 1.
           02 GADGETID-TF        PIC 9(6).
           02 GADGETNAME-IR      PIC X(30).
       01 DELETIONREC.
           02 FILLER             PIC 9(7).
       01 PRICECHANGEREC.
           02 FILLER             PIC 9(7).
           02 PRICE-PCR          PIC 9(4)V99.
       WORKING-STORAGE SECTION.
       01 WS-ANYTHING            PIC X(4).
       PROCEDURE DIVISION.
       MAIN.
           OPEN INPUT TRANSACTIONFILE
           READ TRANSACTIONFILE INTO WS-ANYTHING
           GOBACK.
`;

/** The print-file idiom, which is 93% of the corpus's multi-record FDs. */
const PRINT_FILE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. PRINTER.
       DATA DIVISION.
       FILE SECTION.
       FD PRINT-FILE.
       01 PRINT-REC     PIC X(121).
       01 DUMMY-RECORD  PIC X(121).
       WORKING-STORAGE SECTION.
       01 WS-LINE       PIC X(121).
       PROCEDURE DIVISION.
       MAIN.
           OPEN OUTPUT PRINT-FILE
           WRITE PRINT-REC FROM WS-LINE
           WRITE DUMMY-RECORD
           GOBACK.
`;

describe("reading an FD's records", () => {
  const [shape] = fileRecordShapes(VARIANTS);

  it("finds the FD and every 01 under it", () => {
    expect(shape?.file).toBe("TRANSACTIONFILE");
    expect(shape?.records).toEqual([
      "INSERTIONREC",
      "DELETIONREC",
      "PRICECHANGEREC",
    ]);
  });

  /**
   * The FD's own clauses run to the first period, and the record entries follow
   * it. Reading them as one run would take `LABEL RECORDS ARE STANDARD` for a
   * record description.
   */
  it("stops the FD's clauses at their period", () => {
    expect(shape?.varyingLength).toBe(true);
  });

  it("stops the record list at the next section", () => {
    // `WS-ANYTHING` is in WORKING-STORAGE and must not be a fourth record.
    expect(shape?.records).toHaveLength(3);
  });

  /**
   * The discriminator idiom, and the reason a shared *name* finds none of
   * these: the first record names `TYPECODE-TF` and the others overlay those
   * bytes with `FILLER`.
   */
  it("sees the leading FILLER that overlays the discriminator", () => {
    expect(shape?.leadingFiller).toBe(true);
    expect(shape?.sharedLeadingField).toBe(false);
    expect(shape?.conditionNames).toBe(true);
  });

  it("measures each record's own length", () => {
    // 1 + 6 + 30, then 7, then 7 + 6.
    expect(shape?.lengths).toEqual([37, 7, 13]);
  });

  it("reads how the program opened the file", () => {
    expect(shape?.modes).toEqual(["INPUT"]);
  });

  it("is not an overlay, a copybook, or elementary", () => {
    expect(shape?.redefining).toBe(0);
    expect(shape?.copybook).toBe(false);
    expect(shape?.elementaryOnly).toBe(false);
  });
});

describe("the print-file idiom", () => {
  const [shape] = fileRecordShapes(PRINT_FILE);

  it("is two elementary records of the same length, opened OUTPUT", () => {
    expect(shape?.records).toEqual(["PRINT-REC", "DUMMY-RECORD"]);
    expect(shape?.elementaryOnly).toBe(true);
    expect(shape?.lengths).toEqual([121, 121]);
    expect(shape?.modes).toEqual(["OUTPUT"]);
  });
});

describe("the corpus totals", () => {
  it("counts an FD once and puts it in exactly one bucket", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, "dscobol@Cobol-Projects");
    addRecordUsage(PRINT_FILE, usage, "someone@printer");

    expect(usage.files).toBe(2);
    expect(usage.fileDescriptions).toBe(2);
    expect(usage.multiRecord).toBe(2);
    expect(usage.filesWithMultiRecord).toBe(2);
    expect(usage.recordsPerFile).toEqual({ "2": 1, "3": 1 });

    // Ranked, so the buckets add up to `multiRecord`.
    const buckets =
      usage.overlay +
      usage.copybookDefined +
      usage.elementaryOnly +
      usage.discriminated +
      usage.unclassified;
    expect(buckets).toBe(usage.multiRecord);
    expect(usage.discriminated).toBe(1);
    expect(usage.elementaryOnly).toBe(1);
  });

  it("separates the two open modes, which is what decided the language rule", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, "dscobol@Cobol-Projects");
    addRecordUsage(PRINT_FILE, usage, "someone@printer");

    expect(usage.openedInput).toBe(1);
    expect(usage.openedOutput).toBe(1);
    expect(usage.openedIo).toBe(0);
  });

  it("separates same-length from different-length variants", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, null);
    addRecordUsage(PRINT_FILE, usage, null);

    expect(usage.differentLength).toBe(1);
    expect(usage.sameLength).toBe(1);
    expect(usage.unmeasuredLength).toBe(0);
  });

  /**
   * A pattern found in one teaching repository is not an estate pattern however
   * many times that repository repeats it, so the repositories are counted and
   * the print-file idiom is left out of the count.
   */
  it("counts repositories contributing a structured variant file", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, "dscobol@Cobol-Projects");
    addRecordUsage(VARIANTS, usage, "dscobol@Cobol-Projects");
    addRecordUsage(PRINT_FILE, usage, "someone@printer");

    expect(usage.variantRepositories).toEqual(["dscobol@Cobol-Projects"]);
    expect(usage.inputVariantRepositories).toEqual(["dscobol@Cobol-Projects"]);
  });

  it("counts how a program works with the records", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, null);
    addRecordUsage(PRINT_FILE, usage, null);

    expect(usage.readInto).toBe(1);
    expect(usage.writeFrom).toBe(1);
    // Both of the print file's records are written by name.
    expect(usage.writeOfVariant).toBe(2);
    expect(usage.everyVariantWritten).toBe(1);
  });

  it("ignores a program with no file section", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOFILES.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`,
      usage,
      "someone@nofiles",
    );
    expect(usage.files).toBe(0);
    expect(usage.fileDescriptions).toBe(0);
  });
});

describe("the four things several records can mean", () => {
  const under = (entries: string): string =>
    `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SHAPES.
       DATA DIVISION.
       FILE SECTION.
       FD F.
${entries}       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`;

  const bucket = (entries: string): string => {
    const usage = emptyRecordUsage();
    addRecordUsage(under(entries), usage, null);
    if (usage.overlay > 0) {
      return "overlay";
    }
    if (usage.copybookDefined > 0) {
      return "copybook";
    }
    if (usage.elementaryOnly > 0) {
      return "elementary";
    }
    if (usage.discriminated > 0) {
      return "discriminated";
    }
    return usage.unclassified > 0 ? "unclassified" : "single";
  };

  it("calls a REDEFINES an overlay rather than a variant", () => {
    expect(
      bucket(`       01 A.
           05 A-KEY PIC X(4).
       01 B REDEFINES A.
           05 B-KEY PIC X(4).
`),
    ).toBe("overlay");
  });

  it("says so when the layouts come from a COPY", () => {
    expect(
      bucket(`       01 A.
           05 A-KEY PIC X(4).
       01 B.
           COPY BLAYOUT.
`),
    ).toBe("copybook");
  });

  it("calls a shared leading field name a discriminator", () => {
    expect(
      bucket(`       01 A.
           05 REC-TYPE PIC X.
           05 A-REST   PIC X(9).
       01 B.
           05 REC-TYPE PIC X.
           05 B-REST   PIC X(19).
`),
    ).toBe("discriminated");
  });

  it("leaves the residue unclassified rather than guessing", () => {
    expect(
      bucket(`       01 A.
           05 A-ONE PIC X(4).
       01 B.
           05 B-ONE PIC X(9).
`),
    ).toBe("unclassified");
  });

  it("is not a multi-record FD at all with one record", () => {
    expect(
      bucket(`       01 A.
           05 A-ONE PIC X(4).
`),
    ).toBe("single");
  });
});

describe("a length that cannot be read", () => {
  it("is unmeasured rather than wrong when a table is in the way", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. TABLES.
       DATA DIVISION.
       FILE SECTION.
       FD F.
       01 A.
           05 A-ROW OCCURS 5 TIMES PIC X(4).
       01 B.
           05 B-ONE PIC X(9).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`,
      usage,
      null,
    );
    expect(usage.unmeasuredLength).toBe(1);
    expect(usage.sameLength).toBe(0);
    expect(usage.differentLength).toBe(0);
  });

  it("reads a COMP-3 and a COMP field by their storage, not their digits", () => {
    const [shape] = fileRecordShapes(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. USAGES.
       DATA DIVISION.
       FILE SECTION.
       FD F.
       01 A.
           05 A-PACKED PIC S9(7)V99 COMP-3.
           05 A-BINARY PIC S9(9) COMP.
           05 A-TEXT   PIC X(3).
       01 B.
           05 B-ONE PIC X(9).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`,
    );
    // ceil(9/2) + 1 = 5 packed bytes, 4 binary bytes, 3 text.
    expect(shape?.lengths).toEqual([12, 9]);
  });
});
