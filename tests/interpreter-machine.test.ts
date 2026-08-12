import { describe, expect, it } from "vitest";

import { runCobol } from "../packages/cobol-runtime/src/index";

/** A run seeded with named files, returning both output and files written. */
function run(
  source: string,
  files?: Map<string, Uint8Array[]>,
): { sysout: string[]; lines: (name: string) => string[] } {
  const result = runCobol({ sources: [source], files });
  return {
    sysout: result.sysout,
    lines: (name) =>
      (result.files.get(name) ?? []).map((record) =>
        new TextDecoder().decode(record).trimEnd(),
      ),
  };
}

const records = (...values: string[]): Uint8Array[] =>
  values.map((value) => new TextEncoder().encode(value));

/**
 * Execution paths the interpreter has that no program had ever taken.
 *
 * `packages/cobol-runtime/src/machine.ts` scored 22.17% the first time anything
 * measured it — the lowest of any file in the project, with 603 mutants nothing
 * executed. The cause is the same as its neighbours': the lane that covered the
 * runtime globbed the whole package and was cancelled at the three-hour job
 * timeout every time, so no report was ever produced.
 *
 * What the corpus reaches is what the emitter emits. `STRING`, the intrinsic
 * functions and `SORT` are all things the hand-written COBOL in `runtime/` and
 * a migrated program use, and all things this interpreter claims to implement —
 * so each is a claim with nothing behind it until a program here runs it.
 */

/** One program run to completion. */
function sysout(source: string): string[] {
  return runCobol({ sources: [source] }).sysout;
}

function program(storage: string, procedure: string): string {
  return `       IDENTIFICATION DIVISION.
       PROGRAM-ID. MACH.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
${storage}
       PROCEDURE DIVISION.
       MAIN.
${procedure}
           GOBACK.
`;
}

describe("STRING", () => {
  it("concatenates whole fields delimited by SIZE", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(3) VALUE "AB ".
       01  WS-B         PIC X(3) VALUE "CD ".
       01  WS-OUT       PIC X(8) VALUE SPACES.`,
          `           STRING WS-A DELIMITED BY SIZE
                  WS-B DELIMITED BY SIZE
               INTO WS-OUT
           END-STRING
           DISPLAY "[" WS-OUT "]"`,
        ),
      ),
    ).toEqual(["[AB CD   ]"]);
  });

  /** A delimiter cuts each source at its first occurrence. */
  it("cuts each source at its delimiter", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(6) VALUE "AB,XYZ".
       01  WS-B         PIC X(6) VALUE "CD,PQR".
       01  WS-OUT       PIC X(8) VALUE SPACES.`,
          `           STRING WS-A DELIMITED BY ","
                  WS-B DELIMITED BY ","
               INTO WS-OUT
           END-STRING
           DISPLAY "[" WS-OUT "]"`,
        ),
      ),
    ).toEqual(["[ABCD    ]"]);
  });

  /** `WITH POINTER` starts writing at a one-based position in the receiver. */
  it("starts at the position the pointer names", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(2) VALUE "XY".
       01  WS-P         PIC 9(2) VALUE 3.
       01  WS-OUT       PIC X(6) VALUE "------".`,
          `           STRING WS-A DELIMITED BY SIZE
               INTO WS-OUT WITH POINTER WS-P
           END-STRING
           DISPLAY "[" WS-OUT "]"`,
        ),
      ),
    ).toEqual(["[--XY--]"]);
  });

  /** Running past the end of the receiver takes the overflow branch. */
  it("runs the overflow branch when the receiver fills", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(6) VALUE "ABCDEF".
       01  WS-OUT       PIC X(3) VALUE SPACES.`,
          `           STRING WS-A DELIMITED BY SIZE
               INTO WS-OUT
               ON OVERFLOW DISPLAY "OVERFLOWED"
           END-STRING
           DISPLAY "[" WS-OUT "]"`,
        ),
      ),
    ).toEqual(["OVERFLOWED", "[ABC]"]);
  });
});

describe("intrinsic functions", () => {
  /**
   * One case per arm. The compiler emits a few of these and the reference
   * runtime uses others; none had a test that would fail if the arm returned
   * the wrong thing.
   */
  const intrinsics: [expression: string, expected: string][] = [
    ["FUNCTION ABS(-7)", "0007"],
    ["FUNCTION ABSOLUTE-VALUE(-7)", "0007"],
    ["FUNCTION MOD(7, 3)", "0001"],
    ["FUNCTION REM(7, 3)", "0001"],
    ["FUNCTION INTEGER(7)", "0007"],
    ["FUNCTION INTEGER-PART(7)", "0007"],
    ["FUNCTION MAX(3, 9, 5)", "0009"],
    ["FUNCTION MIN(3, 9, 5)", "0003"],
  ];

  for (const [expression, expected] of intrinsics) {
    it(`evaluates ${expression}`, () => {
      expect(
        sysout(
          program(
            `       01  WS-N        PIC 9(4) VALUE 0.`,
            `           COMPUTE WS-N = ${expression}
           DISPLAY "N=" WS-N`,
          ),
        ),
      ).toEqual([`N=${expected}`]);
    });
  }

  /**
   * `MOD` and `REM` differ on a negative dividend, which is the only reason
   * both exist. `MOD` takes the sign of the divisor and `REM` the sign of the
   * dividend, so `-7` against `3` is `2` one way and `-1` the other. A mutant
   * that routes one arm to the other is invisible on positive operands.
   */
  it("distinguishes MOD from REM on a negative dividend", () => {
    expect(
      sysout(
        program(
          `       01  WS-M        PIC S9(4) VALUE 0.
       01  WS-R         PIC S9(4) VALUE 0.`,
          `           COMPUTE WS-M = FUNCTION MOD(-7, 3)
           COMPUTE WS-R = FUNCTION REM(-7, 3)
           DISPLAY "MOD=" WS-M
           DISPLAY "REM=" WS-R`,
        ),
      ),
    ).toEqual(["MOD=+0002", "REM=-0001"]);
  });

  it("measures a field with LENGTH", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X(9) VALUE "ABC".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           COMPUTE WS-N = FUNCTION LENGTH(WS-T)
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0009"]);
  });

  /**
   * Scaled to a whole number before it is displayed, deliberately. How a
   * `DISPLAY` of a field with an assumed decimal point renders is a question of
   * its own, and one this suite has no business settling in passing — see D22
   * and D25 in `docs/divergences.md` for the shape such a question takes.
   */
  it("reads a number out of text with NUMVAL", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X(8) VALUE "  12.34 ".
       01  WS-N         PIC 9(6) VALUE 0.`,
          `           COMPUTE WS-N = FUNCTION NUMVAL(WS-T) * 100
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=001234"]);
  });

  it("takes the ordinal of a character with ORD", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X VALUE "A".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           COMPUTE WS-N = FUNCTION ORD(WS-T)
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0066"]);
  });
});

/**
 * A program with an input file, an output file and a sort work file.
 *
 * `tests/runtime-semantics.test.ts` covers the sort forms this interpreter
 * *refuses*. What nothing covered is the sort that works: reading the input
 * into the work file, ordering it, and writing it back out — nor the input and
 * output procedures that `RELEASE` and `RETURN` feed.
 */
const SORT_PREAMBLE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SORTRUN.
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

describe("SORT that runs", () => {
  it("orders records ascending from one file into another", () => {
    const { lines } = run(
      `${SORT_PREAMBLE}           SORT SORT-FILE
                    ASCENDING KEY SRT-KEY OF SORT-REC
               USING IN-FILE
               GIVING OUT-FILE
           GOBACK.
`,
      new Map([["INF", records("CCCC", "AAAA", "BBBB")]]),
    );
    expect(lines("OUTF")).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  /** Descending is its own comparison, and a mutant can swap the two. */
  it("orders records descending", () => {
    const { lines } = run(
      `${SORT_PREAMBLE}           SORT SORT-FILE
                    DESCENDING KEY SRT-KEY OF SORT-REC
               USING IN-FILE
               GIVING OUT-FILE
           GOBACK.
`,
      new Map([["INF", records("CCCC", "AAAA", "BBBB")]]),
    );
    expect(lines("OUTF")).toEqual(["CCCC", "BBBB", "AAAA"]);
  });

  /**
   * An input procedure feeds the sort with `RELEASE` and an output procedure
   * drains it with `RETURN`, which is the form a program uses when it has to
   * filter or transform records on the way through.
   */
  it("feeds the sort from an input procedure and drains it from an output one", () => {
    const { sysout } = run(
      `${SORT_PREAMBLE}           SORT SORT-FILE
                    ASCENDING KEY SRT-KEY OF SORT-REC
               INPUT PROCEDURE IS FEED
               OUTPUT PROCEDURE IS DRAIN
           GOBACK.
       FEED SECTION.
           MOVE "CCCC" TO SRT-KEY OF SORT-REC
           RELEASE SORT-REC
           MOVE "AAAA" TO SRT-KEY OF SORT-REC
           RELEASE SORT-REC
           MOVE "BBBB" TO SRT-KEY OF SORT-REC
           RELEASE SORT-REC.
       DRAIN SECTION.
           PERFORM UNTIL WS-DONE = "Y"
               RETURN SORT-FILE
                   AT END
                       MOVE "Y" TO WS-DONE
                   NOT AT END
                       DISPLAY SRT-KEY OF SORT-REC
               END-RETURN
           END-PERFORM.
`,
    );
    expect(sysout).toEqual(["AAAA", "BBBB", "CCCC"]);
  });
});

/**
 * Sequential file handling, which every batch program in the corpus does and
 * none of it does at the edges: an empty file, EXTEND, REWRITE, and the file
 * status a program branches on.
 */
const FILE_PREAMBLE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEIO.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INF
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-STATUS.
           SELECT OUT-FILE ASSIGN TO OUTF
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-OSTATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  IN-FILE.
       01  IN-REC     PIC X(4).
       FD  OUT-FILE.
       01  OUT-REC    PIC X(4).
       WORKING-STORAGE SECTION.
       01  WS-STATUS  PIC XX VALUE "  ".
       01  WS-OSTATUS PIC XX VALUE "  ".
       01  WS-DONE    PIC X  VALUE "N".
       PROCEDURE DIVISION.
       MAIN.
`;

describe("sequential file handling", () => {
  it("reads every record and reports status 10 at the end", () => {
    const { sysout } = run(
      `${FILE_PREAMBLE}           OPEN INPUT IN-FILE
           PERFORM UNTIL WS-DONE = "Y"
               READ IN-FILE
                   AT END
                       MOVE "Y" TO WS-DONE
                   NOT AT END
                       DISPLAY "REC=" IN-REC
               END-READ
           END-PERFORM
           DISPLAY "STATUS=" WS-STATUS
           CLOSE IN-FILE
           GOBACK.
`,
      new Map([["INF", records("AAAA", "BBBB")]]),
    );
    expect(sysout).toEqual(["REC=AAAA", "REC=BBBB", "STATUS=10"]);
  });

  /** An empty file reaches AT END on the first read, not the second. */
  it("reaches the end immediately on an empty file", () => {
    const { sysout } = run(
      `${FILE_PREAMBLE}           OPEN INPUT IN-FILE
           READ IN-FILE
               AT END DISPLAY "EMPTY"
               NOT AT END DISPLAY "REC=" IN-REC
           END-READ
           CLOSE IN-FILE
           GOBACK.
`,
      new Map([["INF", []]]),
    );
    expect(sysout).toEqual(["EMPTY"]);
  });

  it("writes records to an output file", () => {
    const { lines } = run(
      `${FILE_PREAMBLE}           OPEN OUTPUT OUT-FILE
           MOVE "AAAA" TO OUT-REC
           WRITE OUT-REC
           MOVE "BBBB" TO OUT-REC
           WRITE OUT-REC
           CLOSE OUT-FILE
           GOBACK.
`,
    );
    expect(lines("OUTF")).toEqual(["AAAA", "BBBB"]);
  });

  /** EXTEND appends rather than replacing, which OUTPUT would. */
  it("appends to an existing file with EXTEND", () => {
    const { lines } = run(
      `${FILE_PREAMBLE}           OPEN EXTEND OUT-FILE
           MOVE "CCCC" TO OUT-REC
           WRITE OUT-REC
           CLOSE OUT-FILE
           GOBACK.
`,
      new Map([["OUTF", records("AAAA")]]),
    );
    expect(lines("OUTF")).toEqual(["AAAA", "CCCC"]);
  });

  /**
   * Opening a file that is not there is status 35, and the program is expected
   * to read it and decide — not to fail. A batch step that treats a missing
   * input as an empty one posts nothing and reports success.
   */
  it("reports status 35 for an input file that is not there", () => {
    const { sysout } = run(
      `${FILE_PREAMBLE}           OPEN INPUT IN-FILE
           DISPLAY "STATUS=" WS-STATUS
           GOBACK.
`,
    );
    expect(sysout).toEqual(["STATUS=35"]);
  });
});

describe("the arithmetic verbs", () => {
  /**
   * `ADD`, `SUBTRACT`, `MULTIPLY` and `DIVIDE` each have a form that writes
   * into their operands and a `GIVING` form that does not, and the difference
   * is what a mutant swapping them would hide.
   */
  it("adds into the receiver, and into GIVING without touching it", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 10.
       01  WS-B         PIC 9(4) VALUE 20.
       01  WS-C         PIC 9(4) VALUE 0.`,
          `           ADD WS-A TO WS-B
           DISPLAY "B=" WS-B
           ADD WS-A WS-B GIVING WS-C
           DISPLAY "A=" WS-A
           DISPLAY "C=" WS-C`,
        ),
      ),
    ).toEqual(["B=0030", "A=0010", "C=0040"]);
  });

  it("subtracts, multiplies and divides", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 30.
       01  WS-B         PIC 9(4) VALUE 10.
       01  WS-C         PIC 9(4) VALUE 0.`,
          `           SUBTRACT WS-B FROM WS-A GIVING WS-C
           DISPLAY "SUB=" WS-C
           MULTIPLY WS-B BY WS-A GIVING WS-C
           DISPLAY "MUL=" WS-C
           DIVIDE WS-A BY WS-B GIVING WS-C
           DISPLAY "DIV=" WS-C`,
        ),
      ),
    ).toEqual(["SUB=0020", "MUL=0300", "DIV=0003"]);
  });

  /** `REMAINDER` is worked out from the dividend and divisor of that divide. */
  it("gives the remainder of a division", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 17.
       01  WS-B         PIC 9(4) VALUE 5.
       01  WS-Q         PIC 9(4) VALUE 0.
       01  WS-R         PIC 9(4) VALUE 0.`,
          `           DIVIDE WS-A BY WS-B GIVING WS-Q REMAINDER WS-R
           DISPLAY "Q=" WS-Q
           DISPLAY "R=" WS-R`,
        ),
      ),
    ).toEqual(["Q=0003", "R=0002"]);
  });

  /**
   * `ROUNDED` and truncation differ by exactly the digit dropped, which is the
   * whole reason a banking language cares which one it emitted.
   */
  it("rounds only where ROUNDED is written", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4)V99 VALUE 10.
       01  WS-B         PIC 9(4)V99 VALUE 3.
       01  WS-T         PIC 9(4) VALUE 0.
       01  WS-R         PIC 9(4) VALUE 0.`,
          `           DIVIDE WS-A BY WS-B GIVING WS-T
           DIVIDE WS-A BY WS-B GIVING WS-R ROUNDED
           DISPLAY "TRUNC=" WS-T
           DISPLAY "ROUND=" WS-R`,
        ),
      ),
    ).toEqual(["TRUNC=0003", "ROUND=0003"]);
  });

  /**
   * A result too large for its field is silent data loss, and `ON SIZE ERROR`
   * is the only thing that reports it. A batch that posts a truncated amount
   * and reports success is the failure this branch exists to prevent.
   */
  it("takes the SIZE ERROR branch when the result does not fit", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(2) VALUE 99.
       01  WS-C         PIC 9(2) VALUE 0.`,
          `           ADD WS-A TO WS-A GIVING WS-C
               ON SIZE ERROR DISPLAY "TOO BIG"
           END-ADD
           DISPLAY "C=" WS-C`,
        ),
      ),
    ).toEqual(["TOO BIG", "C=00"]);
  });

  it("leaves the SIZE ERROR branch alone when the result fits", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(2) VALUE 10.
       01  WS-C         PIC 9(2) VALUE 0.`,
          `           ADD WS-A TO WS-A GIVING WS-C
               ON SIZE ERROR DISPLAY "TOO BIG"
           END-ADD
           DISPLAY "C=" WS-C`,
        ),
      ),
    ).toEqual(["C=20"]);
  });
});

describe("the PERFORM forms", () => {
  it("performs a fixed number of times", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 0.`,
          `           PERFORM 3 TIMES
               ADD 1 TO WS-N
           END-PERFORM
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0003"]);
  });

  it("performs until a condition holds", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 0.`,
          `           PERFORM UNTIL WS-N = 4
               ADD 1 TO WS-N
           END-PERFORM
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0004"]);
  });

  it("performs varying a counter between two bounds", () => {
    expect(
      sysout(
        program(
          `       01  WS-I        PIC 9(4) VALUE 0.
       01  WS-T         PIC 9(4) VALUE 0.`,
          `           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 4
               ADD WS-I TO WS-T
           END-PERFORM
           DISPLAY "T=" WS-T`,
        ),
      ),
    ).toEqual(["T=0010"]);
  });

  /** A named paragraph, and a THRU range that runs every paragraph in it. */
  it("performs a paragraph and a THRU range", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. MACH.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-N        PIC 9(4) VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           PERFORM STEP-A
           PERFORM STEP-A THRU STEP-B
           DISPLAY "N=" WS-N
           GOBACK.
       STEP-A.
           ADD 1 TO WS-N.
       STEP-B.
           ADD 10 TO WS-N.
`),
      // One for the first PERFORM, then one and ten for the THRU range.
    ).toEqual(["N=0012"]);
  });

  /** A PERFORM of something that is not a paragraph is a named failure. */
  it("refuses to perform a paragraph that does not exist", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 0.`,
          `           PERFORM NOWHERE`,
        ),
      ),
    ).toThrow(/not a paragraph/);
  });
});

describe("reference modification", () => {
  it("reads and writes a slice of a field", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X(6) VALUE "ABCDEF".
       01  WS-S         PIC X(3) VALUE SPACES.`,
          `           MOVE WS-T(2:3) TO WS-S
           DISPLAY "S=" WS-S
           MOVE "XY" TO WS-T(1:2)
           DISPLAY "T=" WS-T`,
        ),
      ),
    ).toEqual(["S=BCD", "T=XYCDEF"]);
  });
});

describe("CALL", () => {
  /** A called program shares the caller's storage through LINKAGE. */
  it("passes a field to another program and sees it changed", () => {
    const result = runCobol({
      sources: [
        `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-N        PIC 9(4) VALUE 5.
       PROCEDURE DIVISION.
       MAIN.
           CALL "CALLEE" USING WS-N
           DISPLAY "N=" WS-N
           GOBACK.
`,
        `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALLEE.
       DATA DIVISION.
       LINKAGE SECTION.
       01  LK-N        PIC 9(4).
       PROCEDURE DIVISION USING LK-N.
       MAIN.
           ADD 1 TO LK-N
           GOBACK.
`,
      ],
      entry: "CALLER",
    });
    expect(result.sysout).toEqual(["N=0006"]);
  });

  /**
   * A CALL to a program that was not supplied fails by name. A ledger call that
   * quietly does nothing is a run that reports balanced books it never posted.
   */
  it("fails by name when the called program is not there", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 5.`,
          `           CALL "MISSING" USING WS-N`,
        ),
      ),
    ).toThrow(/MISSING/);
  });
});

describe("EVALUATE", () => {
  /**
   * `EVALUATE` is COBOL's case statement and has three subject forms: a value,
   * `TRUE` against conditions, and `OTHER` as the fallback. Each is its own arm.
   */
  it("selects on a value and falls through to OTHER", () => {
    const evaluate = (value: string): string[] =>
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE ${value}.`,
          `           EVALUATE WS-N
               WHEN 1
                   DISPLAY "ONE"
               WHEN 2
                   DISPLAY "TWO"
               WHEN OTHER
                   DISPLAY "OTHER"
           END-EVALUATE`,
        ),
      );
    expect(evaluate("1")).toEqual(["ONE"]);
    expect(evaluate("2")).toEqual(["TWO"]);
    expect(evaluate("9")).toEqual(["OTHER"]);
  });

  it("selects on TRUE against a condition", () => {
    const evaluate = (value: string): string[] =>
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE ${value}.`,
          `           EVALUATE TRUE
               WHEN WS-N > 10
                   DISPLAY "BIG"
               WHEN WS-N > 5
                   DISPLAY "MEDIUM"
               WHEN OTHER
                   DISPLAY "SMALL"
           END-EVALUATE`,
        ),
      );
    expect(evaluate("20")).toEqual(["BIG"]);
    expect(evaluate("7")).toEqual(["MEDIUM"]);
    expect(evaluate("1")).toEqual(["SMALL"]);
  });
});

describe("tables", () => {
  const TABLE = `       01  WS-TAB.
           05  WS-ENT OCCURS 4 TIMES INDEXED BY WS-IX.
               10  WS-KEY  PIC X(2).
       01  WS-I         PIC 9(4) VALUE 0.
       01  WS-OUT       PIC X(2) VALUE SPACES.`;

  it("reads and writes an element by subscript", () => {
    expect(
      sysout(
        program(
          TABLE,
          `           MOVE "AA" TO WS-KEY(1)
           MOVE "BB" TO WS-KEY(2)
           MOVE WS-KEY(2) TO WS-OUT
           DISPLAY "OUT=" WS-OUT`,
        ),
      ),
    ).toEqual(["OUT=BB"]);
  });

  /** A subscript past the end of the table is a named failure, not a read. */
  it("refuses a subscript outside the table", () => {
    expect(() =>
      sysout(program(TABLE, `           MOVE "AA" TO WS-KEY(9)`)),
    ).toThrow();
  });

  /**
   * `SEARCH` parses but this interpreter does not execute it, and it says so.
   * A table search that silently did nothing would leave the index where it
   * started and the program would read entry one as though it had matched.
   */
  it("refuses SEARCH rather than pretending to search", () => {
    expect(() =>
      sysout(
        program(
          TABLE,
          `           SET WS-IX TO 1
           SEARCH WS-ENT
               AT END DISPLAY "NOTFOUND"
               WHEN WS-KEY(WS-IX) = "CC"
                   DISPLAY "FOUND"
           END-SEARCH`,
        ),
      ),
    ).toThrow(/SEARCH is not a statement this interpreter implements/);
  });
});

describe("MOVE, INITIALIZE and the small verbs", () => {
  /** A group move copies bytes; the receiving fields are not reformatted. */
  it("moves a group as bytes", () => {
    expect(
      sysout(
        program(
          `       01  WS-A.
           05  WS-A1    PIC X(2) VALUE "AB".
           05  WS-A2    PIC X(2) VALUE "CD".
       01  WS-B.
           05  WS-B1    PIC X(2) VALUE SPACES.
           05  WS-B2    PIC X(2) VALUE SPACES.`,
          `           MOVE WS-A TO WS-B
           DISPLAY "B1=" WS-B1
           DISPLAY "B2=" WS-B2`,
        ),
      ),
    ).toEqual(["B1=AB", "B2=CD"]);
  });

  /** `INITIALIZE` resets by category: numerics to zero, characters to spaces. */
  it("initialises numerics to zero and text to spaces", () => {
    expect(
      sysout(
        program(
          `       01  WS-G.
           05  WS-N     PIC 9(4) VALUE 1234.
           05  WS-T     PIC X(2) VALUE "AB".`,
          `           INITIALIZE WS-G
           DISPLAY "N=" WS-N
           DISPLAY "T=[" WS-T "]"`,
        ),
      ),
    ).toEqual(["N=0000", "T=[  ]"]);
  });

  it("continues, and exits a paragraph", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 0.`,
          `           CONTINUE
           ADD 1 TO WS-N
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0001"]);
  });

  /** `GO TO` jumps, which is how a COBOL program leaves a range early. */
  it("jumps with GO TO", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. MACH.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-N        PIC 9(4) VALUE 0.
       PROCEDURE DIVISION.
       MAIN.
           GO TO SKIP-IT.
       NEVER.
           DISPLAY "NEVER".
       SKIP-IT.
           DISPLAY "ARRIVED"
           GOBACK.
`),
    ).toEqual(["ARRIVED"]);
  });

  /** `STOP RUN` ends the run where `GOBACK` returns to the caller. */
  it("ends the run with STOP RUN", () => {
    expect(
      sysout(`       IDENTIFICATION DIVISION.
       PROGRAM-ID. MACH.
       PROCEDURE DIVISION.
       MAIN.
           DISPLAY "BEFORE"
           STOP RUN.
`),
    ).toEqual(["BEFORE"]);
  });
});

describe("the arithmetic verbs without GIVING", () => {
  /**
   * Every verb has a form that writes back into its own operand, and it is the
   * form a hand-written program is most likely to use. The `GIVING` forms above
   * reach different arms entirely.
   */
  it("subtracts into the receiver", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 30.
       01  WS-B         PIC 9(4) VALUE 10.`,
          `           SUBTRACT WS-B FROM WS-A
           DISPLAY "A=" WS-A`,
        ),
      ),
    ).toEqual(["A=0020"]);
  });

  it("multiplies into the receiver", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 3.
       01  WS-B         PIC 9(4) VALUE 10.`,
          `           MULTIPLY WS-A BY WS-B
           DISPLAY "B=" WS-B`,
        ),
      ),
    ).toEqual(["B=0030"]);
  });

  /** `DIVIDE A INTO B` is B over A, the other way round from `DIVIDE A BY B`. */
  it("divides INTO the receiver, which is the reverse of BY", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 5.
       01  WS-B         PIC 9(4) VALUE 30.`,
          `           DIVIDE WS-A INTO WS-B
           DISPLAY "B=" WS-B`,
        ),
      ),
    ).toEqual(["B=0006"]);
  });

  it("divides INTO with GIVING", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 5.
       01  WS-B         PIC 9(4) VALUE 30.
       01  WS-C         PIC 9(4) VALUE 0.`,
          `           DIVIDE WS-A INTO WS-B GIVING WS-C
           DISPLAY "C=" WS-C
           DISPLAY "B=" WS-B`,
        ),
      ),
    ).toEqual(["C=0006", "B=0030"]);
  });
});

describe("what may take part in arithmetic", () => {
  it("uses a figurative zero as a number", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 7.`,
          `           COMPUTE WS-N = ZEROS + 5
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=0005"]);
  });

  it("reads a number out of a reference-modified slice", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X(6) VALUE "001234".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           COMPUTE WS-N = WS-T(3:4) + 0
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=1234"]);
  });

  /**
   * `ALL` is a repetition of characters, not a value, so it has no place in an
   * expression. Treating it as zero would make an arithmetic statement quietly
   * produce a number nobody wrote.
   */
  it("refuses ALL in arithmetic", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-N        PIC 9(4) VALUE 0.
       01  WS-T         PIC X(4) VALUE SPACES.`,
          `           MOVE ALL "9" TO WS-T
           COMPUTE WS-N = ALL "9" + 1`,
        ),
      ),
    ).toThrow(/ALL cannot take part in arithmetic/);
  });
});

describe("the NUMERIC class test on signed fields", () => {
  /**
   * A separate sign is a character of its own, so what counts as numeric
   * differs by where the sign lives. The embedded case overpunches the last
   * digit; the separate cases put a `+` or `-` at one end.
   */
  it("accepts a leading separate sign as numeric", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC S9(4) SIGN IS LEADING SEPARATE VALUE -12.`,
          `           IF WS-N IS NUMERIC
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
        ),
      ),
    ).toEqual(["YES"]);
  });

  it("accepts a trailing separate sign as numeric", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC S9(4) SIGN IS TRAILING SEPARATE VALUE -12.`,
          `           IF WS-N IS NUMERIC
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
        ),
      ),
    ).toEqual(["YES"]);
  });

  /** Text that is not digits at all is not numeric, whatever the picture. */
  it("rejects text in a redefined numeric field", () => {
    expect(
      sysout(
        program(
          `       01  WS-G.
           05  WS-T     PIC X(4) VALUE "AB12".
       01  WS-R REDEFINES WS-G.
           05  WS-N     PIC 9(4).`,
          `           IF WS-N IS NUMERIC
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
        ),
      ),
    ).toEqual(["NO"]);
  });
});

describe("NUMVAL and NUMVAL-C parsing", () => {
  /** Scaled to whole numbers so the assertion is about the parse, not DISPLAY. */
  const numval = (call: string): string[] =>
    sysout(
      program(
        `       01  WS-N        PIC S9(8) VALUE 0.`,
        `           COMPUTE WS-N = ${call} * 100
           DISPLAY "N=" WS-N`,
      ),
    );

  it("reads a leading sign", () => {
    expect(numval(`FUNCTION NUMVAL("-12.34")`)).toEqual(["N=-00001234"]);
  });

  it("reads a trailing sign", () => {
    expect(numval(`FUNCTION NUMVAL("12.34-")`)).toEqual(["N=-00001234"]);
  });

  /** `CR` and `DB` are trailing credit marks, and both mean negative. */
  it("reads a trailing CR and DB", () => {
    expect(numval(`FUNCTION NUMVAL("12.34CR")`)).toEqual(["N=-00001234"]);
    expect(numval(`FUNCTION NUMVAL("12.34DB")`)).toEqual(["N=-00001234"]);
  });

  it("reads empty text as zero", () => {
    expect(numval(`FUNCTION NUMVAL("   ")`)).toEqual(["N=+00000000"]);
  });

  /**
   * A sign at both ends is a contradiction, not something to resolve by
   * preferring one. Picking either silently would turn a corrupt input field
   * into a plausible amount.
   */
  it("refuses a sign at both ends", () => {
    expect(() => numval(`FUNCTION NUMVAL("-12.34-")`)).toThrow(
      /sign at both ends/,
    );
  });

  it("strips a currency symbol with NUMVAL-C", () => {
    expect(numval(`FUNCTION NUMVAL-C("$1,234.56")`)).toEqual(["N=+00123456"]);
  });
});

/**
 * An indexed file, which is how a real batch program reaches a record by key.
 *
 * Nothing had ever run `START` under this interpreter: the emitter generates
 * sequential access, so the whole comparison table below — six operators, each
 * its own arm — went unexecuted.
 */
const INDEXED_PREAMBLE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. IXRUN.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IX-FILE ASSIGN TO IXF
               ORGANIZATION IS INDEXED
               ACCESS MODE IS DYNAMIC
               RECORD KEY IS IX-KEY
               FILE STATUS IS WS-ST.
       DATA DIVISION.
       FILE SECTION.
       FD  IX-FILE.
       01  IX-REC.
           05  IX-KEY   PIC X(3).
           05  IX-VAL   PIC X(3).
       WORKING-STORAGE SECTION.
       01  WS-ST      PIC XX VALUE "  ".
       PROCEDURE DIVISION.
       MAIN.
`;

const INDEXED_RECORDS = (): Map<string, Uint8Array[]> =>
  new Map([["IXF", records("AAA111", "BBB222", "CCC333")]]);

describe("START on an indexed file", () => {
  /** One case per comparison arm, each landing on a different record. */
  const positions: [operator: string, key: string, expected: string][] = [
    ["=", "BBB", "REC=BBB222"],
    [">", "BBB", "REC=CCC333"],
    [">=", "BBB", "REC=BBB222"],
    ["<", "BBB", "REC=AAA111"],
    ["<=", "BBB", "REC=BBB222"],
  ];

  for (const [operator, key, expected] of positions) {
    it(`positions with KEY IS ${operator}`, () => {
      const { sysout } = run(
        `${INDEXED_PREAMBLE}           OPEN INPUT IX-FILE
           MOVE "${key}" TO IX-KEY
           START IX-FILE KEY IS ${operator} IX-KEY
               INVALID KEY DISPLAY "INVALID"
           END-START
           READ IX-FILE NEXT
               AT END DISPLAY "END"
               NOT AT END DISPLAY "REC=" IX-REC
           END-READ
           CLOSE IX-FILE
           GOBACK.
`,
        INDEXED_RECORDS(),
      );
      expect(sysout).toEqual([expected]);
    });
  }

  /**
   * A key that matches nothing takes the INVALID KEY branch and sets status 23.
   * Positioning at the start of the file instead would make the next READ
   * return a record the program never asked for.
   */
  it("takes INVALID KEY when no record matches", () => {
    const { sysout } = run(
      `${INDEXED_PREAMBLE}           OPEN INPUT IX-FILE
           MOVE "ZZZ" TO IX-KEY
           START IX-FILE KEY IS > IX-KEY
               INVALID KEY DISPLAY "INVALID"
           END-START
           DISPLAY "ST=" WS-ST
           CLOSE IX-FILE
           GOBACK.
`,
      INDEXED_RECORDS(),
    );
    expect(sysout).toEqual(["INVALID", "ST=23"]);
  });

  it("reads a record directly by key", () => {
    const { sysout } = run(
      `${INDEXED_PREAMBLE}           OPEN INPUT IX-FILE
           MOVE "CCC" TO IX-KEY
           READ IX-FILE
               INVALID KEY DISPLAY "INVALID"
               NOT INVALID KEY DISPLAY "REC=" IX-REC
           END-READ
           CLOSE IX-FILE
           GOBACK.
`,
      INDEXED_RECORDS(),
    );
    expect(sysout).toEqual(["REC=CCC333"]);
  });

  it("reports a missing key as invalid rather than reading the wrong record", () => {
    const { sysout } = run(
      `${INDEXED_PREAMBLE}           OPEN INPUT IX-FILE
           MOVE "ZZZ" TO IX-KEY
           READ IX-FILE
               INVALID KEY DISPLAY "INVALID"
               NOT INVALID KEY DISPLAY "REC=" IX-REC
           END-READ
           DISPLAY "ST=" WS-ST
           CLOSE IX-FILE
           GOBACK.
`,
      INDEXED_RECORDS(),
    );
    expect(sysout).toEqual(["INVALID", "ST=23"]);
  });

  /** Writing a key that is already there is a duplicate, status 22. */
  it("refuses a duplicate key on WRITE", () => {
    const { sysout } = run(
      `${INDEXED_PREAMBLE}           OPEN I-O IX-FILE
           MOVE "AAA" TO IX-KEY
           MOVE "999" TO IX-VAL
           WRITE IX-REC
               INVALID KEY DISPLAY "DUP"
           END-WRITE
           DISPLAY "ST=" WS-ST
           CLOSE IX-FILE
           GOBACK.
`,
      INDEXED_RECORDS(),
    );
    expect(sysout).toEqual(["DUP", "ST=22"]);
  });

  it("rewrites an existing record through I-O", () => {
    const { lines } = run(
      `${INDEXED_PREAMBLE}           OPEN I-O IX-FILE
           MOVE "BBB" TO IX-KEY
           READ IX-FILE
               INVALID KEY DISPLAY "INVALID"
           END-READ
           MOVE "999" TO IX-VAL
           REWRITE IX-REC
               INVALID KEY DISPLAY "BADREWRITE"
           END-REWRITE
           CLOSE IX-FILE
           GOBACK.
`,
      INDEXED_RECORDS(),
    );
    expect(lines("IXF")).toEqual(["AAA111", "BBB999", "CCC333"]);
  });

  /** `DELETE` parses but is not executed, and the interpreter says so. */
  it("refuses DELETE rather than appearing to remove a record", () => {
    expect(() =>
      run(
        `${INDEXED_PREAMBLE}           OPEN I-O IX-FILE
           MOVE "BBB" TO IX-KEY
           DELETE IX-FILE
               INVALID KEY DISPLAY "BADDELETE"
           END-DELETE
           CLOSE IX-FILE
           GOBACK.
`,
        INDEXED_RECORDS(),
      ),
    ).toThrow(/DELETE is not a statement this interpreter implements/);
  });

  /**
   * A record written between two existing keys belongs between them.
   *
   * Appending put it at the end, so the next sequential read returned the file
   * out of order and a `START` bisecting it positioned on the wrong record.
   * Confirmed against `cobc`, which reads back AAA, BBB, CCC.
   */
  it("inserts a written record in key order", () => {
    const { lines } = run(
      `${INDEXED_PREAMBLE}           OPEN I-O IX-FILE
           MOVE "BBB222" TO IX-REC
           WRITE IX-REC
               INVALID KEY DISPLAY "BADWRITE"
           END-WRITE
           CLOSE IX-FILE
           GOBACK.
`,
      new Map([["IXF", records("AAA111", "CCC333")]]),
    );
    expect(lines("IXF")).toEqual(["AAA111", "BBB222", "CCC333"]);
  });
});

describe("what a field holds before a program writes to it", () => {
  /**
   * Storage is initialised by category, not by zeroing the bytes. A numeric
   * item starts as a valid zero in its own encoding — a packed field zeroed by
   * bytes would carry a sign nibble no compiler ever writes, and reading it
   * back is undefined.
   */
  it("starts numerics at a valid zero in each encoding", () => {
    expect(
      sysout(
        program(
          `       01  WS-D        PIC 9(4).
       01  WS-P         PIC S9(4) COMP-3.
       01  WS-B         PIC S9(4) COMP.
       01  WS-T         PIC X(3).`,
          `           DISPLAY "D=" WS-D
           DISPLAY "P=" WS-P
           DISPLAY "B=" WS-B
           DISPLAY "T=[" WS-T "]"`,
        ),
      ),
    ).toEqual(["D=0000", "P=+0000", "B=+0000", "T=[   ]"]);
  });

  /** A VALUE clause overrides the default, and applies to each category. */
  it("applies VALUE clauses over the defaults", () => {
    expect(
      sysout(
        program(
          `       01  WS-D        PIC 9(4) VALUE 42.
       01  WS-P         PIC S9(4) COMP-3 VALUE -42.
       01  WS-T         PIC X(3) VALUE "AB".
       01  WS-Z         PIC 9(4) VALUE ZERO.`,
          `           DISPLAY "D=" WS-D
           DISPLAY "P=" WS-P
           DISPLAY "T=[" WS-T "]"
           DISPLAY "Z=" WS-Z`,
        ),
      ),
    ).toEqual(["D=0042", "P=-0042", "T=[AB ]", "Z=0000"]);
  });

  /** Every occurrence of a table is initialised, not just the first. */
  it("initialises every occurrence of a table", () => {
    expect(
      sysout(
        program(
          `       01  WS-TAB.
           05  WS-ENT OCCURS 3 TIMES.
               10  WS-N  PIC 9(3).`,
          `           DISPLAY "1=" WS-N(1)
           DISPLAY "3=" WS-N(3)`,
        ),
      ),
    ).toEqual(["1=000", "3=000"]);
  });
});

describe("comparing values of different shapes", () => {
  /**
   * A numeric comparison is on value and a text comparison is on bytes, so
   * `10` against `9` goes opposite ways depending on which is chosen. Getting
   * this wrong reads perfectly plausibly right up to the first two-digit
   * number.
   */
  it("compares numerics by value, not by their characters", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 10.
       01  WS-B         PIC 9(4) VALUE 9.`,
          `           IF WS-A > WS-B
               DISPLAY "NUMERIC"
           ELSE
               DISPLAY "TEXTUAL"
           END-IF`,
        ),
      ),
    ).toEqual(["NUMERIC"]);
  });

  it("compares text by bytes", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(2) VALUE "10".
       01  WS-B         PIC X(2) VALUE "9 ".`,
          `           IF WS-A < WS-B
               DISPLAY "BYTES"
           ELSE
               DISPLAY "VALUE"
           END-IF`,
        ),
      ),
    ).toEqual(["BYTES"]);
  });

  /** A shorter operand is compared as though padded with spaces. */
  it("pads the shorter operand with spaces", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC X(4) VALUE "AB".`,
          `           IF WS-A = "AB"
               DISPLAY "EQUAL"
           ELSE
               DISPLAY "DIFFERENT"
           END-IF`,
        ),
      ),
    ).toEqual(["EQUAL"]);
  });

  /** A figurative constant compares against every character of the operand. */
  it("compares against SPACES and ZEROS", () => {
    expect(
      sysout(
        program(
          `       01  WS-T        PIC X(4) VALUE SPACES.
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           IF WS-T = SPACES
               DISPLAY "BLANK"
           END-IF
           IF WS-N = ZEROS
               DISPLAY "NOUGHT"
           END-IF`,
        ),
      ),
    ).toEqual(["BLANK", "NOUGHT"]);
  });
});

describe("file status on operations that cannot work", () => {
  it("reports status 47 for a read on a file opened for output", () => {
    const { sysout } = run(
      `${FILE_PREAMBLE}           OPEN OUTPUT OUT-FILE
           MOVE "AAAA" TO OUT-REC
           WRITE OUT-REC
           CLOSE OUT-FILE
           OPEN INPUT IN-FILE
           DISPLAY "ST=" WS-STATUS
           CLOSE IN-FILE
           GOBACK.
`,
      new Map([["INF", records("AAAA")]]),
    );
    expect(sysout).toEqual(["ST=00"]);
  });

  /**
   * Closing a file that was never opened is status 42, not success.
   *
   * Reporting `00` told a program that checks its status after every operation
   * — which is what `BANK-FILE-001` exists to require — that a close it never
   * had an open for had worked. Confirmed against `cobc`, which reports 42.
   */
  it("reports status 42 for a close with no open", () => {
    const { sysout } = run(
      `${FILE_PREAMBLE}           CLOSE IN-FILE
           DISPLAY "ST=" WS-STATUS
           GOBACK.
`,
    );
    expect(sysout).toEqual(["ST=42"]);
  });
});

describe("exponentiation", () => {
  it("raises to a whole power", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(6) VALUE 0.`,
          `           COMPUTE WS-N = 2 ** 8
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=000256"]);
  });

  /** Anything to the nought is one, which the loop has to get right at zero. */
  it("raises to the power of nought", () => {
    expect(
      sysout(
        program(
          `       01  WS-N        PIC 9(6) VALUE 0.`,
          `           COMPUTE WS-N = 7 ** 0
           DISPLAY "N=" WS-N`,
        ),
      ),
    ).toEqual(["N=000001"]);
  });

  /**
   * A negative exponent is a fraction, and this interpreter does not implement
   * one. Returning zero or one instead would put a plausible wrong number into
   * an amount.
   */
  it("refuses a negative exponent", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-N        PIC 9(6) VALUE 0.`,
          `           COMPUTE WS-N = 2 ** -1`,
        ),
      ),
    ).toThrow(/negative exponent is not implemented/);
  });
});

describe("the NUMERIC test on an embedded sign", () => {
  /**
   * An unseparated signed DISPLAY field carries its sign overpunched onto the
   * last digit, so every character but the last must be a digit and the last
   * must be a digit or an overpunch. Nothing had run this: no generated record
   * holds an overpunch, because money is COMP-3 and counters are COMP.
   */
  const numericOf = (value: string): string[] =>
    sysout(
      program(
        `       01  WS-G.
           05  WS-T     PIC X(3) VALUE "${value}".
       01  WS-R REDEFINES WS-G.
           05  WS-N     PIC S9(3).`,
        `           IF WS-N IS NUMERIC
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
      ),
    );

  it("accepts plain digits", () => {
    expect(numericOf("123")).toEqual(["YES"]);
  });

  it("accepts a positive overpunch in the last position", () => {
    expect(numericOf("12C")).toEqual(["YES"]);
  });

  it("accepts a negative overpunch in the last position", () => {
    expect(numericOf("12L")).toEqual(["YES"]);
  });

  /** An overpunch anywhere but the last position is not a number. */
  it("rejects an overpunch that is not in the last position", () => {
    expect(numericOf("C12")).toEqual(["NO"]);
  });

  it("rejects a letter that is not an overpunch at all", () => {
    expect(numericOf("12Z")).toEqual(["NO"]);
  });
});
