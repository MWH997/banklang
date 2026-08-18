import { describe, expect, it } from "vitest";

import { runCobol } from "../packages/cobol-runtime/src/index";

/**
 * Interpreter behaviours the example corpus does not reach.
 *
 * `tests/cobol-runtime-differential.test.ts` is the real check on this
 * interpreter: every example run under it and under `cobc`, compared. What it
 * cannot check is anything the generated corpus never emits, and the reference
 * runtime in `runtime/` is hand-written COBOL that uses rather more of the
 * language than the emitter does. Each of these was found by writing such a
 * program and watching the two disagree.
 */

/** One program, or several, run to completion. */
function sysout(...sources: string[]): string[] {
  return runCobol({ sources }).sysout;
}

/**
 * An 01 REDEFINES describes the same bytes as the record it names.
 *
 * Every 01 used to get storage of its own, `REDEFINES` or not, so a program
 * that wrote through one and read through the other got back whatever the
 * other had been initialised to. It is how a packed field is turned into bytes
 * a program can move around, which is what `runtime/DSNHLI.cbl` needs
 * to hand a fetched row to a caller.
 */
describe("REDEFINES at the 01 level", () => {
  it("reads the bytes the redefined record holds", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. REDEF.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-PACKED.
           05  WS-AMOUNT   PIC S9(5)V99 COMP-3 VALUE 1234.56.
       01  WS-BYTES REDEFINES WS-PACKED.
           05  WS-RAW      PIC X(4).
       01  WS-ORD          PIC 9(4).
       PROCEDURE DIVISION.
       MAIN.
           MOVE FUNCTION ORD(WS-RAW(4:1)) TO WS-ORD
           DISPLAY "ORD=" WS-ORD
           GOBACK.
`),
    ).toEqual([
      // 1234.56 packed into four bytes is 01 23 45 6C, so the last byte is
      // 0x6C, ordinal 109, counting the collating sequence from one. Moved
      // into a picture of its own first: how wide a DISPLAY of a bare
      // intrinsic comes out is implementation-defined, and D22 records it.
      "ORD=0109",
    ]);
  });

  it("sees a write made through the other description", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. REDEF2.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TEXT         PIC X(6) VALUE "ABCDEF".
       01  WS-PARTS REDEFINES WS-TEXT.
           05  WS-HEAD     PIC X(3).
           05  WS-TAIL     PIC X(3).
       PROCEDURE DIVISION.
       MAIN.
           MOVE "XYZ" TO WS-HEAD
           DISPLAY "TEXT=" WS-TEXT
           MOVE "123456" TO WS-TEXT
           DISPLAY "TAIL=" WS-TAIL
           GOBACK.
`),
    ).toEqual(["TEXT=XYZDEF", "TAIL=456"]);
  });

  /** A name that resolves to nothing would quietly get storage of its own. */
  it("refuses a redefinition of a record that is not there", () => {
    expect(() =>
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. REDEF3.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ONE          PIC X(4).
       01  WS-TWO REDEFINES WS-MISSING PIC X(4).
       PROCEDURE DIVISION.
       MAIN.
           GOBACK.
`),
    ).toThrow(/WS-MISSING/);
  });
});

/**
 * `CHAR` and `ORD`, which are inverses.
 *
 * The Language Reference numbers the collating sequence from one, so the
 * ordinal of a byte is the byte plus one. `CHAR` is how a program turns a
 * computed number into a byte, which is what reading hex out of a script comes
 * down to.
 */
describe("the collating-sequence intrinsics", () => {
  it("round-trips a byte through ORD and CHAR", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. CHARS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ONE          PIC X.
       01  WS-ORD          PIC 9(4).
       PROCEDURE DIVISION.
       MAIN.
           MOVE FUNCTION CHAR(66) TO WS-ONE
           DISPLAY "CHAR=" WS-ONE
           MOVE FUNCTION ORD("A") TO WS-ORD
           DISPLAY "ORD=" WS-ORD
           GOBACK.
`),
    ).toEqual(["CHAR=A", "ORD=0066"]);
  });

  /**
   * A `MOVE` of an alphanumeric intrinsic used to be pushed through the
   * arithmetic path, which threw "not implemented" for every one of them.
   * `TRIM` included, outside the `DISPLAY` and `STRING` statements that ask for
   * their text directly.
   */
  it("moves the result of a text intrinsic into an item", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. TEXTFN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-PADDED       PIC X(10) VALUE "  hi      ".
       01  WS-OUT          PIC X(10).
       PROCEDURE DIVISION.
       MAIN.
           MOVE FUNCTION TRIM(WS-PADDED) TO WS-OUT
           DISPLAY "TRIM=[" WS-OUT "]"
           MOVE FUNCTION UPPER-CASE(WS-OUT) TO WS-OUT
           DISPLAY "UPPER=[" WS-OUT "]"
           GOBACK.
`),
    ).toEqual(["TRIM=[hi        ]", "UPPER=[HI        ]"]);
  });
});

/**
 * `SORT` and `MERGE` forms the emitter never produces.
 *
 * `tests/sort-differential.test.ts` runs the emitted subset under both engines
 * and compares. What it cannot reach is the COBOL a person might hand the
 * playground: a `RETURN` with no `AT END`, a `RELEASE` outside a procedure, a
 * `COLLATING SEQUENCE` phrase whose ordering this interpreter does not
 * implement. Each of those has a wrong answer that looks like a right one,
 * a loop that never ends, a record quietly dropped, an order the target would
 * not produce, so each is refused by name instead.
 */
describe("sort forms the interpreter refuses", () => {
  const PREAMBLE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SORTREF.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INF
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT OUT-FILE ASSIGN TO OUTF
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT SORT-FILE ASSIGN TO SORTWORK.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC     PIC X(4).
       FD  OUT-FILE.
       01  OUT-REC    PIC X(4).
       SD  SORT-FILE.
       01  SORT-REC.
           05  SRT-KEY  PIC X(4).
       WORKING-STORAGE SECTION.
       01  WS-DONE    PIC X VALUE "N".
       PROCEDURE DIVISION.
       MAIN.
`;

  it("refuses a COLLATING SEQUENCE it does not implement", () => {
    expect(() =>
      sysout(`${PREAMBLE}           SORT SORT-FILE
                    ASCENDING KEY SRT-KEY OF SORT-REC
               COLLATING SEQUENCE IS NATIVE
               USING IN-FILE
               GIVING OUT-FILE
           GOBACK.
`),
    ).toThrow(/COLLATING SEQUENCE/);
  });

  it("refuses a RETURN with no AT END, which would never end", () => {
    expect(() =>
      sysout(`${PREAMBLE}           SORT SORT-FILE
                    ASCENDING KEY SRT-KEY OF SORT-REC
               USING IN-FILE
               OUTPUT PROCEDURE IS DRAIN
           GOBACK.
       DRAIN SECTION.
           RETURN SORT-FILE
           GOBACK.
`),
    ).toThrow(/AT END/);
  });

  it("refuses a RELEASE outside an input procedure", () => {
    expect(() =>
      sysout(`${PREAMBLE}           MOVE "AAAA" TO SRT-KEY OF SORT-REC
           RELEASE SORT-REC
           GOBACK.
`),
    ).toThrow(/RELEASE SORT-REC outside/);
  });

  it("refuses a MERGE with an input procedure", () => {
    expect(() =>
      sysout(`${PREAMBLE}           MERGE SORT-FILE
                    ASCENDING KEY SRT-KEY OF SORT-REC
               INPUT PROCEDURE IS FEED
               GIVING OUT-FILE
           GOBACK.
       FEED SECTION.
           CONTINUE.
`),
    ).toThrow(/MERGE has no INPUT PROCEDURE/);
  });

  /**
   * The table `SORT` shares only the verb: it orders the elements of a
   * `data-name`, not the records of an `SD`. Parsed as a file sort it would
   * name a work file that is not one.
   */
  it("refuses the table SORT", () => {
    expect(() =>
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. TABLESORT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TABLE.
           05  WS-ROW OCCURS 3 TIMES.
               10  WS-CODE  PIC X(2).
       PROCEDURE DIVISION.
       MAIN.
           SORT WS-ROW ASCENDING KEY WS-CODE
           GOBACK.
`),
    ).toThrow(/WS-ROW/);
  });
});

/**
 * A section is every paragraph in it.
 *
 * `PERFORM a-section` used to run the header paragraph alone, which is right
 * for the `PERFORM x THRU x-EXIT` the emitter writes and wrong for everything
 * else. A sort's input procedure is a section, so the same defect would have
 * ordered whatever had been released before the section's first internal
 * paragraph and dropped the rest.
 */
describe("PERFORM of a section", () => {
  it("runs every paragraph of the section, and stops at the next one", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. SECPERF.
       PROCEDURE DIVISION.
       MAIN SECTION.
           PERFORM WORK
           DISPLAY "BACK"
           GOBACK.
       WORK SECTION.
       WORK-FIRST.
           DISPLAY "FIRST".
       WORK-SECOND.
           DISPLAY "SECOND".
       AFTER-WORK SECTION.
           DISPLAY "NOT REACHED BY PERFORM".
`),
    ).toEqual(["FIRST", "SECOND", "BACK"]);
  });
});
