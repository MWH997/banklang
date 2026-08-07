import { describe, expect, it } from "vitest";

import { check, FILE_FLOOR, scoreFile, scores } from "../tools/mutation-floor";

/**
 * The gate that stops one untested file hiding inside a passing average.
 *
 * Stryker applies `thresholds.break` to the aggregate. The emitter lane scored
 * 61.65 against a break of 60 and the build was green — while
 * `packages/cobol-ir/src/index.ts` inside it scored 44.12, with 81 surviving
 * mutants and 33 lines no test reaches. Two files at 67 and 72 carried it, and
 * nothing in the run said so.
 *
 * **The scorer is held to Stryker's own output, not to arithmetic that looks
 * right.** The first version counted `Ignored` mutants in the denominator and
 * put `cobol-ir` at 10.30% where the tool said 44.12 — 670 of its 874 mutants
 * are ignored by config. A gate that disagrees with the tool it gates will be
 * argued with and then switched off, so these three cases are the three files
 * the emitter lane really produced, with the percentages it really printed.
 */

/** Mutants as the JSON report carries them, by status count. */
function mutants(counts: Record<string, number>): { status: string }[] {
  return Object.entries(counts).flatMap(([status, n]) =>
    Array.from({ length: n }, () => ({ status })),
  );
}

describe("the mutation score", () => {
  /** Straight from `dist/mutation-emitter/mutation.json`, 2026-08-08. */
  const LANE = {
    "packages/cobol-backend/src/prologue.ts": {
      counts: {
        Ignored: 60,
        Killed: 116,
        Survived: 41,
        Timeout: 3,
        NoCoverage: 5,
      },
      stryker: 72.12,
    },
    "packages/cobol-backend/src/reference-format.ts": {
      counts: {
        Killed: 181,
        Survived: 74,
        Ignored: 51,
        NoCoverage: 21,
        Timeout: 20,
        RuntimeError: 1,
      },
      stryker: 67.91,
    },
    "packages/cobol-ir/src/index.ts": {
      counts: {
        Killed: 85,
        Survived: 81,
        Ignored: 670,
        Timeout: 5,
        NoCoverage: 33,
      },
      stryker: 44.12,
    },
  } as const;

  it("matches what Stryker printed, to two decimals", () => {
    for (const [file, { counts, stryker }] of Object.entries(LANE)) {
      expect(scoreFile(mutants(counts)), file).toBeCloseTo(stryker, 2);
    }
  });

  it("counts an uncovered mutant against the score", () => {
    // No test reached it, which is the thing worth knowing.
    expect(scoreFile(mutants({ Killed: 1, NoCoverage: 1 }))).toBe(50);
  });

  it("excludes mutants that were never a fair test", () => {
    const clean = { Killed: 1, Survived: 1 };
    expect(scoreFile(mutants(clean))).toBe(50);
    expect(
      scoreFile(
        mutants({ ...clean, Ignored: 98, CompileError: 5, RuntimeError: 5 }),
      ),
      "an ignored mutant must not move the score",
    ).toBe(50);
  });

  it("treats a timeout as detected, because the mutant changed behaviour", () => {
    expect(scoreFile(mutants({ Timeout: 1, Survived: 1 }))).toBe(50);
  });
});

describe("the per-file floor", () => {
  const report = {
    files: {
      "good.ts": { mutants: mutants({ Killed: 9, Survived: 1 }) },
      "carried.ts": { mutants: mutants({ Killed: 4, Survived: 6 }) },
    },
  };

  it("fails the file the aggregate would have carried", () => {
    // The aggregate here is 65% — above the lane's break of 60 — while
    // `carried.ts` is at 40. That is the emitter lane's shape exactly.
    const aggregate = scoreFile([
      ...report.files["good.ts"].mutants,
      ...report.files["carried.ts"].mutants,
    ]);
    expect(aggregate).toBeGreaterThan(FILE_FLOOR);

    expect(check(report).map((entry) => entry.file)).toEqual(["carried.ts"]);
  });

  it("reports what a reader has to fix, not just a number", () => {
    const carried = scores(report).find((entry) => entry.file === "carried.ts");
    expect(carried?.survived).toBe(6);
  });

  /**
   * A file with no mutants is not a passing file. It is a file the lane's
   * `mutate` globs never reached, and scoring it 100 would report the gap in
   * coverage as the best result in the run.
   */
  it("does not score an unmutated file as perfect", () => {
    expect(scoreFile([])).toBe(0);
    expect(check({ files: { "never.ts": { mutants: [] } } })).toHaveLength(1);
  });
});
