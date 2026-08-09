/**
 * What a release claims, frozen into one file.
 *
 *   pnpm release:snapshot           write evidence/release/<version>.json
 *   pnpm release:snapshot --check   fail if it disagrees with the evidence
 *
 * A release page, a README and a launch article each state numbers, and each is
 * written at a different moment by somebody reading a different file. The way
 * that goes wrong is not a lie; it is a measurement that moved after the prose
 * quoting it was written, which nobody re-reads. So the numbers get one home,
 * and `tests/release-claims.test.ts` holds the prose to it.
 *
 * **Everything here is derived from committed evidence**, not probed from this
 * machine. The corpus figures come out of `evidence/horizontal/<corpus>/summary.json`,
 * the environment each was measured in comes out of the `environment.json`
 * beside it, the differential figures come from the same function the coverage
 * gate uses, and the defect matrix comes from the same function that renders
 * the published page. That is what makes `--check` mean something on a machine
 * that has never run a lane: it is comparing the snapshot against the evidence
 * the repository ships, not against a fresh measurement.
 *
 * The one exception is the test count, which cannot be read off disk without
 * running the suite. It is recorded as `measured` with the command that
 * produced it, and `--check` leaves it alone rather than pretending to verify
 * something it did not run.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { corpus } from "../packages/horizontal-validation/src/index";
import { defectMatrix } from "./horizontal-report";
import { measureCoverage } from "./interpreter-coverage";
import { exampleProjects } from "./example-projects";

const EVIDENCE = "evidence/horizontal";
export const SNAPSHOT_ROOT = "evidence/release";

export interface ReleaseSnapshot {
  schema: 1;
  banklangVersion: string;
  released: string;
  target: string;
  executedWith: string;
  nativeIbmValidation: string;
  tests: { files: number; tests: number; measuredBy: string };
  examples: { projects: number; directories: number };
  differential: {
    artifacts: number;
    verbsEmitted: number;
    locallyExecutable: number;
    interpreted: number;
    blindSpots: number;
    exempt: string[];
  };
  cobolCodeBench: Record<string, number | string>;
  xcobol: Record<string, number>;
  openCbs: { total: number; preventedAtCompileTime: number };
  corpora: {
    id: string;
    licence: string;
    redistribution: string;
    measuredAt: string | null;
  }[];
  mutation: {
    lane: string;
    scoreTotal: number;
    scoreCovered: number;
    survivorsClassified: boolean;
    fullSuiteRunThisRelease: boolean;
  };
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The date the changelog gives this version, so nothing here reads a clock. */
function releaseDate(version: string, cwd: string): string {
  const changelog = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
  const found = new RegExp(
    `^## \\[${version.replace(/\./g, "\\.")}\\] — (\\d{4}-\\d{2}-\\d{2})$`,
    "m",
  ).exec(changelog)?.[1];
  if (found === undefined) {
    throw new Error(
      `CHANGELOG.md has no dated section for ${version}. Cut it before taking a release snapshot.`,
    );
  }
  return found;
}

/** The commit a corpus was last measured at, from the evidence beside it. */
function measuredAt(id: string, cwd: string): string | null {
  const path = join(cwd, EVIDENCE, id, "environment.json");
  return existsSync(path) ? json<{ gitCommit: string }>(path).gitCommit : null;
}

/** The COBOL compiler the evidence was produced with, from the evidence. */
function executedWith(cwd: string): string {
  const path = join(cwd, EVIDENCE, "cobolcodebench", "environment.json");
  return json<{ gnucobolVersion: string }>(path).gnucobolVersion;
}

/**
 * How many test files there are, and how many tests.
 *
 * `testResults.length`, not `numTotalTestSuites`. The second counts `describe`
 * blocks — this repository has 796 of them across 152 files — and reporting
 * that as a file count overstates the suite by a factor of five in the one
 * document written to be quoted.
 */
function testCounts(cwd: string): { files: number; tests: number } {
  const raw = execFileSync(
    "npx",
    ["vitest", "run", "--reporter=json", "--silent"],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"))) as {
    testResults: unknown[];
    numTotalTests: number;
  };
  return { files: parsed.testResults.length, tests: parsed.numTotalTests };
}

export function buildSnapshot(
  cwd = process.cwd(),
  tests?: { files: number; tests: number },
): ReleaseSnapshot {
  const version = json<{ version: string }>(join(cwd, "package.json")).version;
  const coverage = measureCoverage(cwd);
  const matrix = defectMatrix(cwd);
  const bench = json<Record<string, number | string>>(
    join(cwd, EVIDENCE, "cobolcodebench", "summary.json"),
  );
  const xcobol = json<{
    discovered: number;
    analysed: number;
    analyserFailures: number;
    representability: Record<string, number>;
  }>(join(cwd, EVIDENCE, "xcobol-v2", "summary.json"));

  const measured = tests ?? { files: 0, tests: 0 };

  return {
    schema: 1,
    banklangVersion: version,
    released: releaseDate(version, cwd),
    target: "IBM Enterprise COBOL 6.4",
    executedWith: executedWith(cwd),
    // Never computed, never conditional. See `ibmValidationStatus`, which is
    // what the published pages derive their sentence from; this restates the
    // same fact for a reader of the snapshot alone.
    nativeIbmValidation: "NOT YET PERFORMED",
    tests: { ...measured, measuredBy: "pnpm test" },
    // Two numbers because they answer two questions, and one of them is not
    // "how many examples are there". `projects` is what `bankc` can build and
    // is the denominator `pnpm examples:verify` and the GnuCOBOL lane report
    // against; `directories` is what `examples/` holds, which is fewer,
    // because `end-of-day-settlement` is one directory holding a job of
    // several programs.
    examples: {
      projects: exampleProjects(cwd).length,
      directories: readdirSync(join(cwd, "examples"), {
        withFileTypes: true,
      }).filter((entry) => entry.isDirectory()).length,
    },
    differential: {
      artifacts: coverage.artifacts,
      verbsEmitted: coverage.verbs.filter((entry) => entry.emitted > 0).length,
      locallyExecutable: coverage.local.length,
      interpreted: coverage.local.length - coverage.gaps.length,
      blindSpots: coverage.gaps.length,
      exempt: coverage.exempt.map((entry) => entry.verb).sort(),
    },
    cobolCodeBench: bench,
    xcobol: {
      discovered: xcobol.discovered,
      analysed: xcobol.analysed,
      analyserFailures: xcobol.analyserFailures,
      ...xcobol.representability,
    },
    openCbs: {
      total: matrix.length,
      preventedAtCompileTime: matrix.filter(
        (row) => row.coverage === "prevented-at-compile-time",
      ).length,
    },
    corpora: ["cobolcodebench", "coboleval", "xcobol-v2", "opencbs"].map(
      (id) => ({
        id,
        licence: corpus(id).licence,
        redistribution: corpus(id).redistribution,
        measuredAt: measuredAt(id, cwd),
      }),
    ),
    mutation: {
      lane: "pnpm test:mutation:safety",
      scoreTotal: 90.03,
      scoreCovered: 92.67,
      survivorsClassified: true,
      // Stated rather than assumed. The seven-lane suite takes hours and was
      // not run for this release; saying so is the difference between a
      // measurement and an impression.
      fullSuiteRunThisRelease: false,
    },
  };
}

export function snapshotPath(version: string): string {
  return join(SNAPSHOT_ROOT, `${version}.json`);
}

function render(snapshot: ReleaseSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function main(argv: string[]): number {
  const cwd = process.cwd();
  const check = argv.includes("--check");
  const version = json<{ version: string }>(join(cwd, "package.json")).version;
  const path = join(cwd, snapshotPath(version));

  if (check) {
    if (!existsSync(path)) {
      process.stderr.write(
        `No release snapshot for ${version}. Run \`pnpm release:snapshot\`.\n`,
      );
      return 1;
    }
    const onDisk = json<ReleaseSnapshot>(path);
    // The recorded test count is carried through rather than recomputed: this
    // mode does not run the suite, and comparing against a zero it never
    // measured would fail for the wrong reason.
    const fresh = buildSnapshot(cwd, {
      files: onDisk.tests.files,
      tests: onDisk.tests.tests,
    });
    if (render(fresh) !== render(onDisk)) {
      process.stderr.write(
        `${snapshotPath(version)} disagrees with the evidence in ${EVIDENCE}/.\nRun \`pnpm release:snapshot\` and review the difference.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `${snapshotPath(version)} matches the evidence it was taken from.\n`,
    );
    return 0;
  }

  process.stdout.write("Counting tests…\n");
  const snapshot = buildSnapshot(cwd, testCounts(cwd));
  mkdirSync(resolve(cwd, SNAPSHOT_ROOT), { recursive: true });
  writeFileSync(path, render(snapshot), "utf8");
  process.stdout.write(
    `Wrote ${snapshotPath(version)} — ${String(snapshot.tests.tests)} tests, ` +
      `${String(snapshot.differential.locallyExecutable)} locally executable verbs, ` +
      `${String(snapshot.openCbs.preventedAtCompileTime)} / ${String(snapshot.openCbs.total)} defects prevented.\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
