import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
} from "../tools/conformance";
import {
  generatedCobol,
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "../tools/interpret";
import {
  CobolUnsupportedError,
  runCobol,
} from "../packages/cobol-runtime/src/index";

/**
 * Four constructs the backend emits that the interpreter could not execute.
 *
 * Each was found the same way: a benchmark task passed under `cobc` and
 * recorded `differentialAgreement: null`, and each was invisible to
 * `pnpm interpreter:coverage`, which counts verbs. A verb can be two thirds
 * missing, and an intrinsic function is not a verb at all:
 *
 *   - `INSPECT ... TALLYING`, which is what `countOf` becomes;
 *   - `INSPECT ... CONVERTING`, which is what `replaceChars` becomes;
 *   - `FUNCTION NUMVAL-C`, which is what `toNumber` becomes;
 *   - `DIVIDE ... GIVING ... REMAINDER`, which every generated rounding mode
 *     emits, `HALF_EVEN` among them, the one this project calls the usual
 *     choice for money.
 *
 * So this runs the *same generated COBOL* through `cobc` and through
 * `packages/cobol-runtime` and requires the same answer. A test that only
 * compiled would have passed throughout the period all four were missing.
 *
 * **Skips without `cobc`.** A skipped run means unchecked, not passing.
 */

const SOURCE = `module GapProbe;

record Line {
  lineText: string<30>;
}

record Result {
  outCommas: unsigned<3, 0>;
  outFolded: string<30>;
  outParsed: unsigned<9, 0>;
  outShare: edited<decimal<9, 4>, "plain">;
}

file probeInput lineSequential input record Line status probeInputStatus;

file probeReport lineSequential output record Result status probeReportStatus;

on error probeInput {
  log "PROBEINPUT FAILED ", probeInputStatus;
}

on error probeReport {
  log "PROBEREPORT FAILED ", probeReportStatus;
}

entry transaction measure(
  line: Line,
  answer: Result,
  idempotencyKey: string<36>,
) {
  open probeInput;
  open probeReport;

  while probeInputStatus == "00" limit 1000 {
    read probeInput into line;

    if probeInputStatus == "00" {
      // INSPECT ... TALLYING
      let commas: decimal<9, 0> = countOf(line.lineText, ",");
      // INSPECT ... CONVERTING
      let folded: string<30> = replaceChars(
        line.lineText,
        "0123456789",
        "##########"
      );
      // FUNCTION NUMVAL-C
      let parsed: decimal<9, 0> = integerPart(
        toNumber(substring(line.lineText, 1, 6))
      );
      // DIVIDE ... GIVING ... REMAINDER, by way of a generated rounding mode.
      let share: decimal<9, 4> = divide(parsed, 7, "HALF_EVEN");

      answer.outCommas = integerPart(commas);
      answer.outFolded = folded;
      answer.outParsed = integerPart(parsed);
      answer.outShare = share;
      write probeReport from answer;
    }
  }

  close probeReport;
  close probeInput;

  audit("GAPS_MEASURED", idempotencyKey);
}
`;

function options(input: string, workDir: string): ConformanceOptions {
  const cobol = generatedCobol(SOURCE, "probe.bank.ts");
  return {
    source: SOURCE,
    sourceFile: "probe.bank.ts",
    workDir,
    inputs: { PROBEINP: Buffer.from(input, "utf8") },
    outputs: ["PROBEREP"],
    driver: takesParm(cobol)
      ? parmDriver(programNameOf(cobol), "GAPS".padEnd(36, "0"))
      : undefined,
  };
}

/** The same program, both ways, with the output file each produced. */
function both(input: string): { compiled: string; interpreted: string } {
  const workDir = mkdtempSync(join(tmpdir(), "banklang-gaps-"));
  try {
    const config = options(input, workDir);
    const compiled = runConformance(config);
    const interpreted = runInterpreted(config);
    return {
      compiled: (compiled.outputs.get("PROBEREP") ?? Buffer.alloc(0)).toString(
        "utf8",
      ),
      interpreted: (
        interpreted.outputs.get("PROBEREP") ?? Buffer.alloc(0)
      ).toString("utf8"),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const AVAILABLE = hasCobc();
const when = AVAILABLE ? it : it.skip;

describe("the constructs the interpreter used to refuse", () => {
  when("emits all four, so the comparison is of something", () => {
    const cobol = generatedCobol(SOURCE, "probe.bank.ts");
    // Named explicitly: if the backend stops lowering one of these the test
    // would still pass on agreement, having compared nothing.
    expect(cobol).toContain("TALLYING");
    expect(cobol).toContain("CONVERTING");
    expect(cobol).toContain("NUMVAL-C");
    expect(cobol).toContain("REMAINDER");
  });

  when("agrees on an ordinary record", () => {
    const { compiled, interpreted } = both("012345,678,90\n");
    expect(interpreted).toBe(compiled);
    expect(compiled.trimEnd().length).toBeGreaterThan(0);
  });

  when("agrees where there is nothing to count or convert", () => {
    const { compiled, interpreted } = both("000000\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees where the conversion changes every character", () => {
    const { compiled, interpreted } = both("999999\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees on a quotient that does not divide", () => {
    // 100000 / 7 is 14285.714285…, which is where a rounding mode is the
    // whole answer rather than a detail of it.
    const { compiled, interpreted } = both("100000\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees across several records in one run", () => {
    const { compiled, interpreted } = both("012345,6\n099999\n000007,,,\n");
    expect(interpreted).toBe(compiled);
  });
});

describe("what the interpreter still refuses, and says so", () => {
  /**
   * The forms deliberately left out.
   *
   * An interpreter that approximated `BEFORE`/`AFTER` would leave a record
   * half-inspected with no error anywhere, which is the failure this second
   * implementation exists to catch rather than commit. Pinned so that
   * "unimplemented" stays a refusal rather than becoming a wrong answer.
   */
  const refused: Record<string, string> = {
    "INSPECT with BEFORE": `           INSPECT WS-A TALLYING WS-N FOR ALL "," BEFORE "X"`,
    "INSPECT with AFTER": `           INSPECT WS-A CONVERTING "AB" TO "CD" AFTER "X"`,
    "INSPECT with no phrase": `           INSPECT WS-A`,
  };

  for (const [label, statement] of Object.entries(refused)) {
    it(`refuses ${label}`, () => {
      const program = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. REFUSED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-A PIC X(10) VALUE "AB,CD".
       01  WS-N PIC 9(4) VALUE 0.
       PROCEDURE DIVISION.
${statement}
           GOBACK.
`;
      expect(() => runCobol({ sources: [program] })).toThrow(
        CobolUnsupportedError,
      );
    });
  }
});

describe("the probe itself", () => {
  it("compiles without error, so a skip is about cobc and nothing else", () => {
    const result = compile(SOURCE, { sourceFile: "probe.bank.ts" });
    expect(
      result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.id}: ${diagnostic.message}`),
    ).toEqual([]);
  });
});
