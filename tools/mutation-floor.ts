/**
 * A mutation score floor that every file has to clear on its own.
 *
 * Stryker's `thresholds.break` is applied to the aggregate, and an aggregate
 * hides exactly the file you most want to know about. The emitter lane scored
 * 61.65 against a break of 60 and passed — while `packages/cobol-ir/src/index.ts`
 * inside it scored **44.12**, with 81 surviving mutants and 33 lines no test
 * reaches. Two files at 67 and 72 carried it. Nothing in the run said so, and
 * the build was green.
 *
 * So this reads the JSON report each lane now writes and fails when any single
 * file is below the floor. The aggregate threshold stays where it is: the two
 * checks answer different questions, and a project can be in trouble on either.
 *
 * A file with no mutants at all is not a pass. It is a file the lane's `mutate`
 * globs do not reach, and reporting it as fine is the same mistake one level up.
 *
 * Usage: pnpm tsx tools/mutation-floor.ts dist/mutation-emitter/mutation.json
 */

import { existsSync, readFileSync } from "node:fs";

/** Below this, a file's tests are not evidence of anything. */
export const FILE_FLOOR = 60;

interface Mutant {
  status: string;
}
interface MutationReport {
  files: Record<string, { mutants: Mutant[] }>;
}

export interface FileScore {
  file: string;
  score: number;
  killed: number;
  survived: number;
  noCoverage: number;
  total: number;
}

/**
 * Stryker's own definition, and it has to be exactly Stryker's or the gate
 * reports one number while the run reports another.
 *
 * Detected is killed plus timed-out. The denominator is detected plus survived
 * plus no-coverage — an uncovered mutant counts *against* the score, because no
 * test ran it, which is the point. `Ignored`, `CompileError` and `RuntimeError`
 * are excluded: they are mutants that were never a fair test of anything.
 *
 * The first version of this counted `Ignored` in the denominator and scored
 * `cobol-ir/src/index.ts` at 10.30% where Stryker said 44.12% — 670 of its 874
 * mutants are ignored by config. A gate whose number disagrees with the tool it
 * gates is worse than no gate, so `tests/mutation-floor.test.ts` holds this
 * function to the three figures the emitter lane actually printed.
 */
export function scoreFile(mutants: Mutant[]): FileScore["score"] {
  const counted = mutants.filter(
    (m) =>
      m.status === "Killed" ||
      m.status === "Timeout" ||
      m.status === "Survived" ||
      m.status === "NoCoverage",
  );
  const detected = counted.filter(
    (m) => m.status === "Killed" || m.status === "Timeout",
  ).length;
  return counted.length === 0 ? 0 : (detected / counted.length) * 100;
}

export function scores(report: MutationReport): FileScore[] {
  return Object.entries(report.files).map(([file, entry]) => ({
    file,
    score: scoreFile(entry.mutants),
    killed: entry.mutants.filter((m) => m.status === "Killed").length,
    survived: entry.mutants.filter((m) => m.status === "Survived").length,
    noCoverage: entry.mutants.filter((m) => m.status === "NoCoverage").length,
    total: entry.mutants.length,
  }));
}

export function check(report: MutationReport, floor = FILE_FLOOR): FileScore[] {
  return scores(report).filter((entry) => entry.score < floor);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    throw new Error("Usage: mutation-floor.ts <mutation.json>");
  }
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. The lane writes it through the json reporter; a missing report is a lane that did not run, not a lane that passed.`,
    );
  }

  const report = JSON.parse(readFileSync(path, "utf8")) as MutationReport;
  const all = scores(report).sort((a, b) => a.score - b.score);
  for (const entry of all) {
    const mark = entry.score < FILE_FLOOR ? "FAIL" : "ok  ";
    console.log(
      `  ${mark} ${entry.score.toFixed(2).padStart(6)}%  ` +
        `${String(entry.survived).padStart(4)} survived  ` +
        `${String(entry.noCoverage).padStart(4)} uncovered  ${entry.file}`,
    );
  }

  const failing = all.filter((entry) => entry.score < FILE_FLOOR);
  if (failing.length > 0) {
    throw new Error(
      `${String(failing.length)} file(s) below the ${String(FILE_FLOOR)}% mutation floor. ` +
        `The lane's aggregate can still pass while one file is untested; that is what this check exists for.`,
    );
  }
  console.log(
    `All ${String(all.length)} file(s) clear the ${String(FILE_FLOOR)}% floor.`,
  );
}

if (process.argv[1]?.endsWith("mutation-floor.ts")) {
  main();
}
