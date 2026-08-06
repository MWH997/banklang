import { describe, expect, it } from "vitest";

import {
  formatFindings,
  lintCobol,
  lintJcl,
} from "../packages/conformance-lint/src/index";
import { lintAll } from "../tools/conformance-lint";

/**
 * The linter, and the artifacts it reads.
 *
 * Two halves. The rules are checked against programs written here to break
 * them, because a rule with no failing case is a rule that might be inert. And
 * then the whole repository is linted, because that is the point of having it:
 * the 2026-08-05 audit found a 31-character COBOL word, a rounding phrase that
 * is not Enterprise COBOL, and a job whose dataset names could not be
 * catalogued — all three in text that was checked in and read by no test.
 */

/** Reference format, so the fixtures below are the shape a real artifact is. */
function cobol(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("what the linter refuses", () => {
  it("a COBOL word past thirty characters", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("       01  IS-ELIGIBLE-FOR-INTEREST-RESULT PIC S9(9) COMP-3."),
    );

    expect(findings.map((finding) => finding.rule)).toContain("word-length");
    expect(formatFindings(findings)).toContain("is 31 characters");
  });

  /**
   * The one that matters most. `ROUNDED MODE IS NEAREST-EVEN` compiled under
   * GnuCOBOL's default dialect and reads like COBOL; `NEAREST-EVEN` is in no
   * column of the Language Reference's reserved word table at all.
   */
  it("a word Enterprise COBOL has never heard of", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("           COMPUTE X = Y ROUNDED MODE IS NEAREST-EVEN"),
    );

    expect(findings.map((finding) => finding.rule)).toContain("vocabulary");
    expect(formatFindings(findings)).toContain("NEAREST-EVEN");
  });

  it("a line past column 72", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol(`           MOVE ${"A".repeat(70)} TO B`),
    );

    expect(findings.map((finding) => finding.rule)).toContain("line-length");
  });

  it("a PROGRAM-ID that cannot be a load module member", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("       PROGRAM-ID. BATCH-INTEREST-ACCRUAL."),
    );

    expect(findings.map((finding) => finding.rule)).toContain(
      "program-id-length",
    );
  });

  it("a picture with more digits than ARITH(COMPAT) allows", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("       01  TOTAL                PIC S9(18)V99 COMP-3."),
    );

    expect(findings.map((finding) => finding.rule)).toContain("digit-count");
  });

  it("a statement written into Area A", () => {
    const findings = lintCobol("x.cbl", cobol("       MOVE A TO B"));

    expect(findings.map((finding) => finding.rule)).toContain("area-a");
  });

  it("a CALL naming a program nothing supplies", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("       PROGRAM-ID. MAIN.", '           CALL "NOWHERE" USING X'),
      { knownPrograms: ["BANKAUDT"] },
    );

    expect(findings.map((finding) => finding.rule)).toContain(
      "call-resolvable",
    );
  });

  it("a dataset qualifier longer than eight characters", () => {
    const findings = lintJcl(
      "x.jcl",
      "//SYSIN    DD DISP=SHR,DSN=DIST.COBOL.BATCHINTERESTACCRUAL\n",
    );

    expect(findings.map((finding) => finding.rule)).toContain("dsn-qualifier");
  });

  it("a run step with no STEPLIB", () => {
    const findings = lintJcl(
      "x.jcl",
      "//RUN      EXEC PGM=BATCHINT\n//SYSOUT   DD SYSOUT=*\n",
    );

    expect(findings.map((finding) => finding.rule)).toContain("required-dd");
  });

  it("a continuation that does not continue", () => {
    const findings = lintJcl(
      "x.jcl",
      "//COMPILE  EXEC IGYWCL,\n//SYSIN DD DUMMY\n",
    );

    expect(findings.map((finding) => finding.rule)).toContain("continuation");
  });

  /**
   * The Language Reference: a `PROCESS` statement "can be preceded by a
   * sequence number in columns 1 through 6" and "can begin in column 8 or
   * after; if a sequence number is not specified, PROCESS or CBL can begin in
   * column 1 or after". Column 7 is the indicator area and is neither.
   */
  it("a PROCESS statement in the indicator area", () => {
    const findings = lintCobol("x.cbl", cobol("      PROCESS NODYNAM"));

    expect(findings.map((finding) => finding.rule)).toContain(
      "process-statement",
    );
    expect(formatFindings(findings)).toContain("column 7");
  });

  /** It "must be placed before any comment lines or other compiler-directing statements". */
  it("a PROCESS statement after a comment", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("      *> A note.", "       PROCESS NODYNAM"),
    );

    expect(findings.map((finding) => finding.rule)).toContain(
      "process-statement",
    );
  });

  /**
   * The audit's F13, as a rule rather than as an instance. `MOVE 'Y'` sat two
   * lines under a `VALUE "N"` in a shipped example, its evidence bundle and a
   * golden fixture, while a test asserting exactly this passed — because the
   * program it compiled reached the boolean written as a condition and not the
   * boolean written as a literal. Read off the text, there is nothing to miss.
   */
  it("two delimiters for the literals of one program", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol(
        '       01  ELIGIBLE-RESULT      PIC X VALUE "N".',
        "           IF PROJECTED-BALANCE > 1000",
        "               MOVE 'Y' TO ELIGIBLE-RESULT",
        "           END-IF",
      ),
      { fragment: true },
    );

    expect(findings.map((finding) => finding.rule)).toContain(
      "literal-delimiter",
    );
    expect(formatFindings(findings)).toContain("One artifact, one delimiter.");
  });
});

/**
 * The two rules the previous pass added, mutated.
 *
 * `pnpm test:mutation:lint` was run over the linter for the first time on
 * 2026-08-06 and scored 61.10%, with 247 survivors. They concentrated in these
 * two rules: `unreferenced-item` had no test whatsoever — every mutant
 * survived, including replacing the collection condition with `if (true)` and
 * emptying the loop that reports the findings — and `literal-delimiter` had
 * exactly one, covering the case F13 was found in and nothing else.
 *
 * A rule that reads text is mostly edge: which lines it skips, where it stops
 * skipping, and which shapes it deliberately lets through. None of that was
 * held. What follows is written from the surviving mutants, so each case names
 * a behaviour that could have been deleted in silence.
 */

/**
 * One rule's findings.
 *
 * The fixtures below are fragments written to exercise one rule, so they name
 * fields they never declare and the vocabulary rule has something to say about
 * every one of them. Narrowing to the rule under test keeps each case about the
 * behaviour it is named for.
 */
function only(
  findings: ReturnType<typeof lintCobol>,
  rule: string,
): ReturnType<typeof lintCobol> {
  return findings.filter((finding) => finding.rule === rule);
}

describe("the delimiter rule reads the artifact's own convention", () => {
  it("takes the apostrophe as the convention when most literals use one", () => {
    // Kills `chosen = true ? '"' : "'"`. The rule does not have a preferred
    // delimiter; it reports whichever is in the minority.
    const findings = lintCobol(
      "x.cbl",
      cobol(
        "           MOVE 'A' TO FIELD-ONE",
        "           MOVE 'B' TO FIELD-TWO",
        '           MOVE "C" TO FIELD-THREE',
      ),
      { fragment: true },
    );

    expect(only(findings, "literal-delimiter")).toHaveLength(1);
    expect(formatFindings(findings)).toContain('"C" is delimited by a quote');
  });

  it("says nothing when every literal uses the same delimiter", () => {
    // Kills emptying the `quoted === 0 || quoted === found.length` guard, which
    // would have the rule report the whole artifact against itself.
    for (const delimiter of ['"', "'"]) {
      expect(
        only(
          lintCobol(
            "x.cbl",
            cobol(
              `           MOVE ${delimiter}A${delimiter} TO FIELD-ONE`,
              `           MOVE ${delimiter}B${delimiter} TO FIELD-TWO`,
            ),
            { fragment: true },
          ),
          "literal-delimiter",
        ),
      ).toEqual([]);
    }
  });

  it("exempts a literal that has to use the other delimiter", () => {
    // Kills dropping `!literal.text.includes(chosen)`. A literal containing a
    // quote cannot be written with quotes without doubling them, so switching
    // it is not an improvement and the rule does not ask for it.
    const findings = lintCobol(
      "x.cbl",
      cobol(
        '           MOVE "PLAIN" TO FIELD-ONE',
        '           MOVE "ALSO PLAIN" TO FIELD-TWO',
        "           MOVE 'HE SAID \"NO\"' TO FIELD-THREE",
      ),
      { fragment: true },
    );

    expect(only(findings, "literal-delimiter")).toEqual([]);
  });

  it("keeps checking after an EXEC block ends", () => {
    // Kills emptying `if (/END-EXEC/) { inExec = false; }`. Left in, the rule
    // treats the rest of the program as SQL and stops looking — and most of
    // this corpus has an EXEC SQL block near the top, so the rule would have
    // been dead over exactly the programs it most needs to read.
    const findings = lintCobol(
      "x.cbl",
      cobol(
        '           MOVE "A" TO FIELD-ONE',
        "           EXEC SQL",
        "               SELECT BALANCE INTO :WS-BALANCE FROM ACCOUNTS",
        "           END-EXEC",
        "           MOVE 'B' TO FIELD-TWO",
      ),
      { fragment: true },
    );

    const delimiter = only(findings, "literal-delimiter");
    expect(delimiter).toHaveLength(1);
    expect(delimiter[0].line).toBe(5);
  });

  it("does not read a literal inside a comment", () => {
    // Kills emptying the comment guard. A comment is not code, and an example
    // quoted in one is the commonest way to trip a text rule.
    expect(
      only(
        lintCobol(
          "x.cbl",
          cobol(
            '           MOVE "A" TO FIELD-ONE',
            "      * The old form was MOVE 'A' TO FIELD-ONE.",
            '           MOVE "B" TO FIELD-TWO',
          ),
          { fragment: true },
        ),
        "literal-delimiter",
      ),
    ).toEqual([]);
  });
});

describe("the unreferenced-item rule", () => {
  /** Working storage, wrapped in enough program for the rule to find it. */
  function program(...storage: string[]): string {
    return cobol(
      "       IDENTIFICATION DIVISION.",
      "       PROGRAM-ID. X.",
      "       DATA DIVISION.",
      "       WORKING-STORAGE SECTION.",
      ...storage,
      "       PROCEDURE DIVISION.",
      "       BANK-MAIN.",
      "           GOBACK.",
    );
  }

  it("reports an elementary item nothing names again", () => {
    // Kills emptying the reporting loop, and `if (true)` on the collection
    // guard. Nothing asserted this rule fires at all until now.
    const findings = lintCobol("x.cbl", program("       01  WS-UNUSED PIC X."));

    const unreferenced = only(findings, "unreferenced-item");
    expect(unreferenced).toHaveLength(1);
    expect(formatFindings(findings)).toContain(
      "WS-UNUSED is declared and never referenced",
    );
    expect(unreferenced[0].line).toBe(5);
  });

  it("says nothing about an item the procedure division uses", () => {
    // Kills `uses > 1` becoming `uses >= 1`, which counts the declaration
    // itself as a use and silences the rule entirely.
    expect(
      only(
        lintCobol(
          "x.cbl",
          cobol(
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. X.",
            "       DATA DIVISION.",
            "       WORKING-STORAGE SECTION.",
            "       01  WS-COUNTER PIC 9(4).",
            "       PROCEDURE DIVISION.",
            "       BANK-MAIN.",
            "           MOVE 0 TO WS-COUNTER",
            "           GOBACK.",
          ),
        ),
        "unreferenced-item",
      ),
    ).toEqual([]);
  });

  it("exempts EXTERNAL storage, which belongs to the run unit", () => {
    expect(
      only(
        lintCobol("x.cbl", program("       01  WS-SHARED PIC X EXTERNAL.")),
        "unreferenced-item",
      ),
    ).toEqual([]);
  });

  it("exempts a group item, which may be the record's copybook", () => {
    // A level-01 with no PICTURE of its own is the program's data model. Every
    // BankTS record becomes both working storage and a copybook, so a program
    // that only validates one legitimately never names the group again.
    expect(
      only(
        lintCobol(
          "x.cbl",
          program(
            "       01  TRANSFER-REQUEST.",
            "           05  TR-AMOUNT PIC S9(16)V99 COMP-3.",
          ),
        ),
        "unreferenced-item",
      ),
    ).toEqual([]);
  });

  it("looks only at working storage", () => {
    // Kills emptying `if (section !== "WORKING-STORAGE") return`. Linkage is
    // the caller's storage and a program may legitimately not touch a field of
    // it; local storage is re-established per invocation.
    expect(
      only(
        lintCobol(
          "x.cbl",
          cobol(
            "       IDENTIFICATION DIVISION.",
            "       PROGRAM-ID. X.",
            "       DATA DIVISION.",
            "       LINKAGE SECTION.",
            "       01  LS-UNUSED PIC X.",
            "       PROCEDURE DIVISION.",
            "       BANK-MAIN.",
            "           GOBACK.",
          ),
        ),
        "unreferenced-item",
      ),
    ).toEqual([]);
  });

  it("does not carry one program's storage into the next", () => {
    // Kills emptying the PROGRAM-ID reset. Without it, a name declared in the
    // first program and used only there is still on the list when the second
    // program is scanned — and because uses are counted over the whole file,
    // the rule stays quiet about a genuinely dead item in the second.
    const findings = lintCobol(
      "x.cbl",
      cobol(
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. FIRST.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-FIRST PIC X.",
        "       PROCEDURE DIVISION.",
        "       FIRST-MAIN.",
        "           MOVE SPACE TO WS-FIRST",
        "           GOBACK.",
        "       END PROGRAM FIRST.",
        "       IDENTIFICATION DIVISION.",
        "       PROGRAM-ID. SECOND.",
        "       DATA DIVISION.",
        "       WORKING-STORAGE SECTION.",
        "       01  WS-SECOND PIC X.",
        "       PROCEDURE DIVISION.",
        "       SECOND-MAIN.",
        "           GOBACK.",
        "       END PROGRAM SECOND.",
      ),
    );

    expect(
      findings
        .filter((finding) => finding.rule === "unreferenced-item")
        .map((finding) => finding.message),
    ).toEqual([expect.stringContaining("WS-SECOND")]);
  });
});

describe("what the linter accepts", () => {
  /**
   * The compiler options are the compiler's vocabulary rather than COBOL's,
   * and the statement has no Area A. A generated zUnit driver opens with one.
   */
  it("a PROCESS statement and its options", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "       PROCESS NODLL,NODYNAM,TEST(NOSEP),NOCICS,NOSQL,PGMN(LU),NOSEQ",
          "       IDENTIFICATION DIVISION.",
          "       PROGRAM-ID. X.",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });

  /** The same statement in column 1, which is the other placement allowed. */
  it("a PROCESS statement in column 1", () => {
    expect(
      lintCobol("x.cbl", cobol("PROCESS NODYNAM"), { fragment: true }),
    ).toEqual([]);
  });

  /**
   * `ITER` and `TC-WORK-AREA` are IBM's, from a copybook the linter does not
   * have. They are accepted in an artifact that copies the member declaring
   * them, and nowhere else — the same rule the MQI's names get.
   */
  it("the zUnit info block's fields, where the artifact copies EQAITERC", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "       01  AZ-INFO-BLOCK.",
          "           COPY EQAITERC.",
          "       01  AZ-GRP-INDEX             PIC 9(8).",
          "           MOVE 1 TO AZ-GRP-INDEX",
          "           CALL 'GTMEMRC' USING TC-WORK-AREA OF AZ-INFO-BLOCK",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });

  it("refuses those same fields where it does not", () => {
    const findings = lintCobol(
      "x.cbl",
      cobol("           MOVE 1 TO TC-WORK-AREA OF AZ-INFO-BLOCK"),
      { fragment: true },
    );

    expect(formatFindings(findings)).toContain("TC-WORK-AREA");
  });

  it("a well-formed data description entry", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "       01  TRANSFER-REQUEST.",
          "           05  DEBIT-ACCOUNT        PIC X(16).",
          "           05  AMOUNT               PIC S9(16)V99 COMP-3.",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });

  /**
   * The generated zUnit driver's shape, copied from what IBM's own generator
   * produces: apostrophes throughout, because the message text it has to hold
   * contains a quote. One delimiter, consistently — which is the rule.
   */
  it("an artifact that chose the apostrophe and kept to it", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "       01  PROGRAM-NAME             PIC X(8) VALUE 'ZUNITTES'.",
          "       01  AZ-TEST                  PIC X(80).",
          "           DISPLAY 'AZU2001W THE TEST \"' AZ-TEST",
          "               '\" FAILED DUE TO AN ASSERTION.'",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });

  /** SQL's string constant is delimited by an apostrophe. That is SQL's rule. */
  it("an EXEC SQL block whose literal is delimited the SQL way", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "       01  ACCOUNT-STATUS       PIC X(2).",
          '           MOVE "00" TO ACCOUNT-STATUS',
          "           EXEC SQL",
          "               SELECT BALANCE INTO :ROW-BALANCE FROM ACCOUNT",
          "               WHERE STATUS = 'OPEN'",
          "           END-EXEC",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });

  /** SQL is the precompiler's language, and its names follow Db2's rules. */
  it("an EXEC SQL block whose column names are not COBOL words", () => {
    expect(
      lintCobol(
        "x.cbl",
        cobol(
          "           EXEC SQL",
          "               SELECT ACCOUNT_IDENTIFIER_WITH_A_VERY_LONG_NAME",
          "               INTO :ROW-ACCOUNT-ID",
          "               FROM ACCOUNT",
          "           END-EXEC",
        ),
        { fragment: true },
      ),
    ).toEqual([]);
  });
});

/**
 * Fresh output, the checked-in fixtures, and the evidence bundles.
 *
 * All three, because they go stale in different ways. `pnpm fixtures:refresh`
 * and `pnpm evidence:refresh` are what put them right.
 */
describe("everything this repository ships", () => {
  it("meets the target's rules", () => {
    const findings = lintAll(process.cwd());

    expect(formatFindings(findings)).toBe("No conformance findings.\n");
  });
});
