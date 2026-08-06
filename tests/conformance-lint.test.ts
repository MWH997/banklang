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
