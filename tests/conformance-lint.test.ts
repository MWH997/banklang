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
});

describe("what the linter accepts", () => {
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
