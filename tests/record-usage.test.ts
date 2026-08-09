import { describe, expect, it } from "vitest";

import {
  addRecordUsage,
  emptyRecordUsage,
  fileRecordShapes,
  type FileRecordShape,
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

/**
 * The first shape of a program, read inside the test that asserts about it.
 *
 * Inside, deliberately. These fixtures were read once in the `describe` body
 * and shared, which is a readable arrangement and one that measures nothing: a
 * `describe` body runs when the file is collected, before Stryker activates a
 * mutant, so every assertion over such a value passed no matter what the
 * analyser had been changed to. Fourteen mutants in `fileRecordShapes` survived
 * against assertions that fail the moment the same mutation is applied by hand.
 * Reading the fixture per test is what makes these assertions load-bearing.
 */
const shapeOf = (text: string): FileRecordShape | undefined =>
  fileRecordShapes(text)[0];

/** One FD holding the given entries, in a program that does nothing else. */
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

describe("reading an FD's records", () => {
  it("finds the FD and every 01 under it", () => {
    const shape = shapeOf(VARIANTS);
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
    expect(shapeOf(VARIANTS)?.varyingLength).toBe(true);
  });

  /**
   * The other half of that: an FD whose clauses also span several lines and
   * which says nothing about varying length must not acquire it. Reading the
   * clause run as "varying" regardless is a mutation the fixture above cannot
   * see, because it is varying.
   */
  it("does not invent a varying length for a plain multi-line FD", () => {
    const shape = shapeOf(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. PLAIN.
       DATA DIVISION.
       FILE SECTION.
       FD F
           LABEL RECORDS ARE STANDARD
           BLOCK CONTAINS 0 RECORDS.
       01 A.
           05 A-KEY PIC X(4).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`);
    expect(shape?.varyingLength).toBe(false);
    expect(shape?.records).toEqual(["A"]);
  });

  it("stops the record list at the next section", () => {
    // `WS-ANYTHING` is in WORKING-STORAGE and must not be a fourth record.
    expect(shapeOf(VARIANTS)?.records).toHaveLength(3);
  });

  /**
   * The discriminator idiom, and the reason a shared *name* finds none of
   * these: the first record names `TYPECODE-TF` and the others overlay those
   * bytes with `FILLER`.
   */
  it("sees the leading FILLER that overlays the discriminator", () => {
    const shape = shapeOf(VARIANTS);
    expect(shape?.leadingFiller).toBe(true);
    expect(shape?.sharedLeadingField).toBe(false);
    expect(shape?.conditionNames).toBe(true);
  });

  /**
   * `leadingFiller` is about the records *after* the first, because the first
   * record is the one that names the discriminator. A `FILLER` at the head of
   * the first record and nowhere else is not the idiom and must not be read as
   * one.
   */
  it("ignores a FILLER at the head of the first record", () => {
    const shape = shapeOf(
      under(`       01 A.
           05 FILLER PIC X(4).
       01 B.
           05 B-KEY PIC X(4).
`),
    );
    expect(shape?.leadingFiller).toBe(false);
  });

  /** One later record overlaying the discriminator is enough; all of them is not required. */
  it("sees a leading FILLER on one of several later records", () => {
    const shape = shapeOf(
      under(`       01 A.
           05 A-TYPE PIC X.
       01 B.
           05 FILLER PIC X.
       01 C.
           05 C-KEY PIC X.
`),
    );
    expect(shape?.leadingFiller).toBe(true);
  });

  /** A shared leading field needs two records to share it. */
  it("does not call a single record's leading field shared", () => {
    const shape = shapeOf(
      under(`       01 A.
           05 REC-TYPE PIC X.
           05 A-REST   PIC X(9).
`),
    );
    expect(shape?.records).toEqual(["A"]);
    expect(shape?.sharedLeadingField).toBe(false);
  });

  it("measures each record's own length", () => {
    // 1 + 6 + 30, then 7, then 7 + 6.
    expect(shapeOf(VARIANTS)?.lengths).toEqual([37, 7, 13]);
  });

  it("reads how the program opened the file", () => {
    expect(shapeOf(VARIANTS)?.modes).toEqual(["INPUT"]);
  });

  it("is not an overlay, a copybook, or elementary", () => {
    const shape = shapeOf(VARIANTS);
    expect(shape?.redefining).toBe(0);
    expect(shape?.copybook).toBe(false);
    expect(shape?.elementaryOnly).toBe(false);
  });

  /**
   * A clause continued onto its own line is not a data description entry, and
   * reading it as one asks `Number` for the level of nothing.
   */
  it("skips a line under the FD that is not an entry at all", () => {
    const shape = shapeOf(
      under(`       01 A.
           05 A-KEY PIC X(4)
               VALUE SPACES.
       01 B.
           05 B-KEY PIC X(4).
`),
    );
    expect(shape?.records).toEqual(["A", "B"]);
    expect(shape?.lengths).toEqual([4, 4]);
  });

  /**
   * An FD can describe no records at all — 113 of X-COBOL's 6,451 do, where the
   * layout arrives some other way. A subordinate entry with no `01` above it
   * belongs to no record, and attributing it to one turns a record area into a
   * structured record.
   */
  it("attributes nothing to a record that has not started", () => {
    const shape = shapeOf(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. NORECORD.
       DATA DIVISION.
       FILE SECTION.
       FD F.
           05 STRAY PIC X(4).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`);
    expect(shape?.records).toEqual([]);
    expect(shape?.elementaryOnly).toBe(true);
  });

  /** A file the program never opens has no modes, not an invented one. */
  it("leaves the modes empty for a file that is never opened", () => {
    expect(
      shapeOf(
        under(`       01 A.
           05 A-KEY PIC X(4).
`),
      )?.modes,
    ).toEqual([]);
  });
});

describe("the print-file idiom", () => {
  it("is two elementary records of the same length, opened OUTPUT", () => {
    const shape = shapeOf(PRINT_FILE);
    expect(shape?.records).toEqual(["PRINT-REC", "DUMMY-RECORD"]);
    expect(shape?.elementaryOnly).toBe(true);
    expect(shape?.lengths).toEqual([121, 121]);
    expect(shape?.modes).toEqual(["OUTPUT"]);
  });
});

describe("how the program opened the file", () => {
  const opened = (statements: string): string[] =>
    shapeOf(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. OPENS.
       DATA DIVISION.
       FILE SECTION.
       FD F.
       01 A.
           05 A-KEY PIC X(4).
       01 B.
           05 B-KEY PIC X(9).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
${statements}           GOBACK.
`)?.modes ?? [];

  it("reads I-O, which is neither input nor output", () => {
    expect(opened("           OPEN I-O F\n")).toEqual(["I-O"]);
  });

  it("records a mode once however often the file is opened in it", () => {
    expect(
      opened("           OPEN INPUT F\n           OPEN INPUT F\n"),
    ).toEqual(["INPUT"]);
  });

  it("keeps both modes when a program opens a file two ways", () => {
    expect(
      opened("           OPEN INPUT F\n           OPEN EXTEND F\n"),
    ).toEqual(["INPUT", "EXTEND"]);
  });

  /**
   * A name before any mode keyword has no mode to be opened in. Attributing one
   * anyway puts a null into the evidence file's `modes` array.
   */
  it("records nothing from an OPEN with no mode keyword", () => {
    expect(opened("           OPEN F\n")).toEqual([]);
  });

  it("counts an I-O file in its own total", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. UPDATER.
       DATA DIVISION.
       FILE SECTION.
       FD F.
       01 A.
           05 A-KEY PIC X(4).
       01 B.
           05 B-KEY PIC X(9).
       WORKING-STORAGE SECTION.
       01 WS PIC X.
       PROCEDURE DIVISION.
       MAIN.
           OPEN I-O F
           GOBACK.
`,
      usage,
      null,
    );
    expect(usage.openedIo).toBe(1);
    expect(usage.openedInput).toBe(0);
    expect(usage.openedOutput).toBe(0);
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

  /**
   * The same program vendored twice is one program.
   *
   * A corpus of 168 repositories is full of files that appear in several of
   * them — the NIST CCVS85 suite is in four — and a count of file descriptions
   * counts each copy. 143 multi-record `INPUT` FDs are 51 distinct file
   * contents, and
   * the difference is what separates "an estate pattern" from "a conformance
   * suite everybody vendored".
   */
  it("counts distinct file contents, not copies of one file", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, "dscobol@Cobol-Projects");
    addRecordUsage(VARIANTS, usage, "someone@else");
    addRecordUsage(VARIANTS.replace("BDS1003", "BDS1004"), usage, "third@repo");

    expect(usage.openedInput).toBe(3);
    expect(usage.inputVariantContents).toHaveLength(2);
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

  /** `varyingLength` is 150 of the corpus's multi-record FDs, and it is per FD. */
  it("counts the FDs whose records differ in length", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(VARIANTS, usage, null);
    addRecordUsage(PRINT_FILE, usage, null);

    expect(usage.multiRecord).toBe(2);
    expect(usage.varyingLength).toBe(1);
  });

  /** A file whose FDs all describe one record is not a multi-record file. */
  it("does not count a single-record file among the multi-record ones", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(
      under(`       01 A.
           05 A-KEY PIC X(4).
`),
      usage,
      null,
    );

    expect(usage.files).toBe(1);
    expect(usage.fileDescriptions).toBe(1);
    expect(usage.multiRecord).toBe(0);
    expect(usage.filesWithMultiRecord).toBe(0);
  });

  /** The last bucket is `5+`, so five records belong to it and four do not. */
  it("puts five records in the last bucket and four in their own", () => {
    const usage = emptyRecordUsage();
    const record = (name: string): string =>
      `       01 ${name}.\n           05 ${name}-KEY PIC X(4).\n`;
    addRecordUsage(
      under(["A", "B", "C", "D"].map(record).join("")),
      usage,
      null,
    );
    addRecordUsage(
      under(["V", "W", "X", "Y", "Z"].map(record).join("")),
      usage,
      null,
    );

    expect(usage.recordsPerFile).toEqual({ "4": 1, "5+": 1 });
  });

  /**
   * `everyVariantWritten` is about an FD all of whose records the program
   * writes by name. One of two is the case that separates it from its negation.
   */
  it("does not count an FD whose records are only partly written", () => {
    const usage = emptyRecordUsage();
    addRecordUsage(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. PARTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD F.
       01 A.
           05 A-KEY PIC X(4).
       01 B.
           05 B-KEY PIC X(4).
       WORKING-STORAGE SECTION.
       01 WS PIC X(4).
       PROCEDURE DIVISION.
       MAIN.
           OPEN OUTPUT F
           WRITE A
           GOBACK.
`,
      usage,
      null,
    );

    expect(usage.writeOfVariant).toBe(1);
    expect(usage.everyVariantWritten).toBe(0);
  });

  /**
   * The shapes are kept so a reader can check the counts, and capped so the
   * evidence file stays a file. The cap is on the front of the list: what is
   * kept is the first forty seen, not the last.
   */
  it("keeps the first forty shapes and no more", () => {
    const usage = emptyRecordUsage();
    expect(usage.examples).toEqual([]);
    for (let index = 0; index < 41; index += 1) {
      addRecordUsage(PRINT_FILE, usage, null);
    }

    expect(usage.multiRecord).toBe(41);
    expect(usage.examples).toHaveLength(40);
    expect(usage.examples[0]?.file).toBe("PRINT-FILE");
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

  /**
   * A group inside a record has no picture of its own, and its subordinates
   * are what carry the bytes. The running sum has to stop at the group rather
   * than treat "no length" as zero: `null + 4` is `4` in JavaScript, so the
   * arithmetic does not fail, it just reports a record four bytes long. A wrong
   * length reported as a length is what moves an FD from `unmeasuredLength`
   * into `sameLength` or `differentLength`, which is a published number.
   */
  it("is unmeasured rather than wrong when a record has a nested group", () => {
    const usage = emptyRecordUsage();
    const source = under(`       01 A.
           05 A-GROUP.
               10 A-ONE PIC X(4).
               10 A-TWO PIC X(6).
       01 B.
           05 B-ONE PIC X(9).
`);
    expect(shapeOf(source)?.lengths).toEqual([null, 9]);
    addRecordUsage(source, usage, null);
    expect(usage.unmeasuredLength).toBe(1);
    expect(usage.sameLength).toBe(0);
    expect(usage.differentLength).toBe(0);
  });

  /**
   * A picture this analyser has no rule for is unmeasured too. `PIC G(10)` is
   * DBCS, whose bytes depend on the compiler's encoding options, and guessing
   * would put a wrong length into the same published totals.
   */
  it("is unmeasured when the picture holds a symbol it cannot read", () => {
    const usage = emptyRecordUsage();
    const source = under(`       01 A.
           05 A-WIDE PIC G(10).
       01 B.
           05 B-ONE PIC X(9).
`);
    expect(shapeOf(source)?.lengths).toEqual([null, 9]);
    addRecordUsage(source, usage, null);
    expect(usage.unmeasuredLength).toBe(1);
  });

  /**
   * `COMP` is a halfword to nine digits and a doubleword beyond, and the
   * boundaries are where an off-by-one lives. Four digits is the last halfword
   * and eighteen is the first that is neither.
   */
  it("reads a binary field's width at both of its boundaries", () => {
    expect(
      shapeOf(
        under(`       01 A.
           05 A-SMALL  PIC S9(4)  COMP.
           05 A-MEDIUM PIC S9(9)  COMP.
           05 A-LARGE  PIC S9(18) COMP.
`),
      )?.lengths,
      // 2 + 4 + 8.
    ).toEqual([14]);
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
