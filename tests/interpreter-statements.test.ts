import { describe, expect, it } from "vitest";

import {
  CobolUnsupportedError,
  runCobol,
} from "../packages/cobol-runtime/src/index";

/**
 * Statement forms the interpreter parses that nothing had ever run.
 *
 * `packages/cobol-runtime/src/statements.ts` is 2,008 lines deciding what a
 * COBOL statement means, and until 2026-08-12 no run had ever scored it. The
 * lane that covered it globbed the whole runtime package and was cancelled at
 * the three-hour job timeout, so it produced no report at all; splitting it into
 * four made it finish, and finishing put the file at 57.26% against the 60%
 * per-file floor — with 147 mutants no test executed.
 *
 * The gap has a clear shape. `tests/cobol-runtime-differential.test.ts` runs the
 * example corpus under this interpreter and under `cobc` and compares, which is
 * the strongest evidence there is — but it can only reach what the emitter
 * emits. `tests/runtime-semantics.test.ts` adds what the hand-written COBOL in
 * `runtime/` needs. What neither reaches is the rest of the grammar this parser
 * accepts: UNSTRING, the class and sign conditions, the written-out relation
 * operators, INSPECT TALLYING and SET's several forms.
 *
 * The refusals are tested as carefully as the successes. A parser that accepts a
 * construct it cannot execute is worse than one that rejects it, because the
 * program runs and the answer is wrong — so each `CobolUnsupportedError` here is
 * a promise that the interpreter says so rather than guessing.
 */

/** One program run to completion. */
function sysout(source: string): string[] {
  return runCobol({ sources: [source] }).sysout;
}

/** A program body wrapped in the smallest module that will hold it. */
function program(storage: string, procedure: string): string {
  return `       IDENTIFICATION DIVISION.
       PROGRAM-ID. STMT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
${storage}
       PROCEDURE DIVISION.
       MAIN.
${procedure}
           GOBACK.
`;
}

describe("UNSTRING", () => {
  /**
   * The whole statement, from one source field into three receivers.
   *
   * Nothing reached this at all: the emitter never generates UNSTRING, and the
   * reference runtime does not use it. Every line of the parse — the receiver
   * list, the delimiter, the returned statement — was unexecuted.
   */
  it("splits a field into several receivers on a delimiter", () => {
    expect(
      sysout(
        program(
          `       01  WS-SRC      PIC X(20) VALUE "AB,CD,EF".
       01  WS-A        PIC X(4).
       01  WS-B        PIC X(4).
       01  WS-C        PIC X(4).`,
          `           UNSTRING WS-SRC DELIMITED BY ","
               INTO WS-A WS-B WS-C
           END-UNSTRING
           DISPLAY "A=" WS-A
           DISPLAY "B=" WS-B
           DISPLAY "C=" WS-C`,
        ),
      ),
    ).toEqual(["A=AB  ", "B=CD  ", "C=EF  "]);
  });

  /**
   * More receivers than the source has pieces leaves the extras alone, and the
   * overflow branch is not taken — the receivers were enough.
   */
  it("runs the overflow branch only when the receivers run out", () => {
    expect(
      sysout(
        program(
          `       01  WS-SRC      PIC X(20) VALUE "AB,CD,EF".
       01  WS-A        PIC X(4).
       01  WS-B        PIC X(4).`,
          `           UNSTRING WS-SRC DELIMITED BY ","
               INTO WS-A WS-B
               ON OVERFLOW DISPLAY "OVERFLOWED"
           END-UNSTRING
           DISPLAY "A=" WS-A`,
        ),
      ),
    ).toEqual(["OVERFLOWED", "A=AB  "]);
  });

  /**
   * The phrases the parser refuses, each asserted by the message it gives.
   *
   * The message and not just the error class, because the class alone passed
   * while the refusal was unreachable. `startsReference()` accepts any word that
   * is not a verb or a terminator, so the receiver loop read `WITH`, `POINTER`,
   * `TALLYING`, `DELIMITER` and `COUNT` as receiver names and ran past every
   * check below them. What the author got instead was a runtime error naming a
   * data item they never wrote — `WITH is not declared in STMT` — and, for
   * `COUNT IN`, `END is not a statement this interpreter implements`, the loop
   * having swallowed `END-UNSTRING` too. `COUNT IN` therefore threw a
   * `CobolUnsupportedError` and a test asserting only the class went green
   * against a branch nothing reached.
   */
  const refused: [label: string, statement: string, message: RegExp][] = [
    [
      "DELIMITED BY ALL",
      `           UNSTRING WS-SRC DELIMITED BY ALL "," INTO WS-A END-UNSTRING`,
      /DELIMITED BY ALL is not implemented/,
    ],
    [
      "more than one delimiter",
      `           UNSTRING WS-SRC DELIMITED BY "," OR ";" INTO WS-A END-UNSTRING`,
      /more than one delimiter is not implemented/,
    ],
    [
      "COUNT IN",
      `           UNSTRING WS-SRC DELIMITED BY "," INTO WS-A COUNT IN WS-N END-UNSTRING`,
      /DELIMITER IN or COUNT IN is not implemented/,
    ],
    [
      "DELIMITER IN",
      `           UNSTRING WS-SRC DELIMITED BY "," INTO WS-A DELIMITER IN WS-A END-UNSTRING`,
      /DELIMITER IN or COUNT IN is not implemented/,
    ],
    [
      "WITH POINTER",
      `           UNSTRING WS-SRC DELIMITED BY "," INTO WS-A WITH POINTER WS-N END-UNSTRING`,
      /WITH POINTER is not implemented/,
    ],
    [
      "TALLYING",
      `           UNSTRING WS-SRC DELIMITED BY "," INTO WS-A TALLYING IN WS-N END-UNSTRING`,
      /TALLYING is not implemented/,
    ],
  ];

  for (const [label, statement, message] of refused) {
    it(`refuses ${label} in its own words`, () => {
      const run = (): string[] =>
        sysout(
          program(
            `       01  WS-SRC      PIC X(20) VALUE "AB,CD".
       01  WS-A        PIC X(4).
       01  WS-N        PIC 9(4) VALUE 1.`,
            statement,
          ),
        );
      expect(run).toThrow(CobolUnsupportedError);
      expect(run).toThrow(message);
    });
  }
});

describe("class and sign conditions", () => {
  /**
   * One case per arm, each with its negation.
   *
   * `NUMERIC` was the only one any test reached. The others share a shape — the
   * optional `IS`, the optional `NOT`, then the test word — so a mutant in the
   * shared `wrap` is caught by any of them, but a mutant that deletes an arm is
   * caught only by that arm.
   */
  const tests: [label: string, condition: string, expected: string][] = [
    ["NUMERIC on digits", "WS-NUM IS NUMERIC", "YES"],
    ["NOT NUMERIC on letters", "WS-TXT IS NOT NUMERIC", "YES"],
    ["ALPHABETIC on letters", "WS-TXT IS ALPHABETIC", "YES"],
    ["NOT ALPHABETIC on digits", "WS-NUM IS NOT ALPHABETIC", "YES"],
    ["POSITIVE on a positive", "WS-POS IS POSITIVE", "YES"],
    ["NOT POSITIVE on a negative", "WS-NEG IS NOT POSITIVE", "YES"],
    ["NEGATIVE on a negative", "WS-NEG IS NEGATIVE", "YES"],
    ["NOT NEGATIVE on a positive", "WS-POS IS NOT NEGATIVE", "YES"],
    ["ZERO on nought", "WS-ZERO IS ZERO", "YES"],
    ["ZEROS on nought", "WS-ZERO IS ZEROS", "YES"],
    ["NOT ZERO on a positive", "WS-POS IS NOT ZERO", "YES"],
  ];

  for (const [label, condition, expected] of tests) {
    it(`reads ${label}`, () => {
      expect(
        sysout(
          program(
            `       01  WS-NUM      PIC 9(4) VALUE 1234.
       01  WS-TXT       PIC X(4) VALUE "ABCD".
       01  WS-POS       PIC S9(4) VALUE 7.
       01  WS-NEG       PIC S9(4) VALUE -7.
       01  WS-ZERO      PIC S9(4) VALUE 0.`,
            `           IF ${condition}
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
          ),
        ),
      ).toEqual([expected]);
    });
  }
});

describe("relation operators written as words", () => {
  /**
   * COBOL spells its relations several ways and this parser accepts all of
   * them. Only the punctuation forms were ever exercised, so `EQUAL TO`,
   * `GREATER THAN`, `LESS THAN` and the two `OR EQUAL` compounds went unrun —
   * as did the inversion table that `NOT` selects.
   */
  const relations: [condition: string, expected: string][] = [
    ["WS-A IS EQUAL TO WS-A", "YES"],
    ["WS-B IS GREATER THAN WS-A", "YES"],
    ["WS-A IS LESS THAN WS-B", "YES"],
    ["WS-B IS GREATER THAN OR EQUAL TO WS-A", "YES"],
    ["WS-A IS LESS THAN OR EQUAL TO WS-A", "YES"],
    ["WS-A IS NOT EQUAL TO WS-B", "YES"],
    ["WS-A IS NOT GREATER THAN WS-B", "YES"],
    ["WS-B IS NOT LESS THAN WS-A", "YES"],
    ["WS-A <> WS-B", "YES"],
    ["WS-A NOT = WS-B", "YES"],
  ];

  for (const [condition, expected] of relations) {
    it(`reads ${condition}`, () => {
      expect(
        sysout(
          program(
            `       01  WS-A        PIC 9(4) VALUE 10.
       01  WS-B         PIC 9(4) VALUE 20.`,
            `           IF ${condition}
               DISPLAY "YES"
           ELSE
               DISPLAY "NO"
           END-IF`,
          ),
        ),
      ).toEqual([expected]);
    });
  }

  /** `NOT` inverts, so each of these must come out the other way. */
  it("inverts every operator it negates", () => {
    expect(
      sysout(
        program(
          `       01  WS-A        PIC 9(4) VALUE 10.
       01  WS-B         PIC 9(4) VALUE 20.`,
          `           IF WS-A IS NOT LESS THAN WS-B
               DISPLAY "WRONG"
           ELSE
               DISPLAY "RIGHT"
           END-IF`,
        ),
      ),
    ).toEqual(["RIGHT"]);
  });
});

describe("INSPECT TALLYING", () => {
  /**
   * The three counting phrases, each of which is its own arm.
   *
   * `CHARACTERS` counts every character, `ALL` counts occurrences of a value and
   * `LEADING` counts only the run at the front — three different answers on the
   * same field, which is what makes a mutant that swaps them visible.
   */
  it("counts characters, all occurrences and leading runs", () => {
    expect(
      sysout(
        program(
          `       01  WS-SRC      PIC X(6) VALUE "AABAAB".
       01  WS-CHARS     PIC 9(4) VALUE 0.
       01  WS-ALL       PIC 9(4) VALUE 0.
       01  WS-LEAD      PIC 9(4) VALUE 0.`,
          `           INSPECT WS-SRC TALLYING WS-CHARS FOR CHARACTERS
           INSPECT WS-SRC TALLYING WS-ALL FOR ALL "A"
           INSPECT WS-SRC TALLYING WS-LEAD FOR LEADING "A"
           DISPLAY "CHARS=" WS-CHARS
           DISPLAY "ALL=" WS-ALL
           DISPLAY "LEAD=" WS-LEAD`,
        ),
      ),
    ).toEqual(["CHARS=0006", "ALL=0004", "LEAD=0002"]);
  });

  it("refuses a TALLYING with no FOR phrase", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-SRC      PIC X(6) VALUE "AABAAB".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           INSPECT WS-SRC TALLYING WS-N`,
        ),
      ),
    ).toThrow(CobolUnsupportedError);
  });

  it("refuses a counting phrase it cannot execute", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-SRC      PIC X(6) VALUE "AABAAB".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           INSPECT WS-SRC TALLYING WS-N FOR TRAILING "B"`,
        ),
      ),
    ).toThrow(CobolUnsupportedError);
  });

  /**
   * `BEFORE` and `AFTER` restrict an INSPECT to part of the field. Accepting
   * and ignoring them would count over the whole field and report a number that
   * looks perfectly reasonable.
   */
  it("refuses BEFORE and AFTER rather than counting the whole field", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-SRC      PIC X(6) VALUE "AABAAB".
       01  WS-N         PIC 9(4) VALUE 0.`,
          `           INSPECT WS-SRC TALLYING WS-N FOR ALL "A" BEFORE "B"`,
        ),
      ),
    ).toThrow(CobolUnsupportedError);
  });
});

describe("SET", () => {
  it("sets several indexes in one statement", () => {
    expect(
      sysout(
        program(
          `       01  WS-I        PIC 9(4) VALUE 0.
       01  WS-J         PIC 9(4) VALUE 0.`,
          `           SET WS-I WS-J TO 5
           DISPLAY "I=" WS-I
           DISPLAY "J=" WS-J`,
        ),
      ),
    ).toEqual(["I=0005", "J=0005"]);
  });

  it("sets a condition name to true", () => {
    expect(
      sysout(
        program(
          `       01  WS-FLAG     PIC X VALUE "N".
           88  WS-DONE  VALUE "Y".`,
          `           SET WS-DONE TO TRUE
           DISPLAY "FLAG=" WS-FLAG`,
        ),
      ),
    ).toEqual(["FLAG=Y"]);
  });

  /**
   * `SET ... TO FALSE` needs a `FALSE` phrase on the 88 to know what value to
   * write. Without one there is no answer, and guessing would put an arbitrary
   * value in the field.
   */
  it("refuses SET TO FALSE", () => {
    expect(() =>
      sysout(
        program(
          `       01  WS-FLAG     PIC X VALUE "N".
           88  WS-DONE  VALUE "Y".`,
          `           SET WS-DONE TO FALSE`,
        ),
      ),
    ).toThrow(CobolUnsupportedError);
  });
});
