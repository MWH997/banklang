/**
 * What a horizontal run produces, and the arithmetic nobody gets to choose.
 *
 * The temptation this file exists to remove: BankTS expresses 20 of 46 tasks
 * and 18 of those pass, so the headline reads 90%. Both numbers are true and
 * the sentence is a lie, because the reader supplies the missing denominator
 * themselves and supplies 46. So `tally` below computes every rate, always, and
 * `formatRate` refuses to render one without its denominator attached.
 *
 * There are four rates rather than two, and the extra pair is the harder
 * lesson. `pass / applicable` was 4/4 for a phase, while `applicable` meant
 * "somebody has written one", so the rate could not have been anything else,
 * and twenty-eight tasks sat in a bucket that carried no verdict at all. A
 * denominator computed from its own numerator is not a denominator, so
 * applicability and authorship are separate axes now and `authored /
 * applicable` travels beside `pass / authored` because the second conceals the
 * first.
 *
 * The failure taxonomy is deliberately fine-grained for the same reason. "It
 * failed" invites a single number; "the generated COBOL compiled, ran, and
 * wrote a different byte at offset 41" invites a fix. Every outcome below names
 * the phase that produced it, so a run's failures sort into work items rather
 * than into a percentage.
 */

/**
 * The phase a task reached, and what happened there.
 *
 * Ordered as the pipeline runs, which is also the order a reader should think
 * about them: everything above `pass` is a stage that did not complete, and the
 * earliest one is where the work is.
 */
export type Outcome =
  /** The BankTS did not typecheck or was refused by the safety analyser. */
  | "bankts-check-failure"
  /** It checked and produced no artifacts. */
  | "bankts-build-failure"
  /** Two compilations of identical input produced different bytes. */
  | "determinism-failure"
  /** The generated COBOL broke a target-conformance rule. */
  | "conformance-failure"
  /** `cobc` refused the COBOL this compiler emitted. */
  | "cobol-compile-failure"
  /** It compiled and the run did not complete. */
  | "runtime-failure"
  | "timeout"
  /** It ran and produced output the benchmark does not expect. */
  | "semantic-mismatch"
  /**
   * It ran, and no spec-only implementation could have matched.
   *
   * A failure, counted against the score, and named apart from
   * `semantic-mismatch` because it is a different fact about the world. Ten of
   * CobolCodeBench's 46 tasks expect literal text that appears in neither the
   * specification nor the input data: `MAXIMAM TEMP:`, complete with the
   * misspelling, or a lookup table of foods that exists only inside the
   * reference solution. Under the anti-contamination rule those bytes are
   * unavailable when the implementation is written, so the task cannot be
   * matched however correct the program is.
   *
   * Reported rather than excluded. Dropping these would improve the pass rate
   * by shrinking the denominator, which is precisely the move this taxonomy
   * exists to prevent; `isOracleDerivable` decides it deterministically.
   */
  | "oracle-not-derivable"
  /** `cobc` and the interpreter disagree. Always a defect until explained. */
  | "execution-divergence"
  /** Only the compiled side matched the oracle. */
  | "gnucobol-only-pass"
  /** Only the interpreter matched the oracle. */
  | "runtime-only-pass"
  /** The harness itself broke: no compiler, unreadable cache, a crash. */
  | "infrastructure-failure"
  /**
   * Nothing ran, because nothing was written.
   *
   * Named for what happened rather than for a judgement about it. It used to be
   * `skipped`, which read as "and correctly so" and covered both a task BankTS
   * cannot express and a task nobody had got round to, so the applicability axis
   * now carries that distinction, and this says only that no run took place.
   */
  | "not-executed"
  | "pass";

/** Outcomes that mean the toolchain produced the expected observable behaviour. */
export const PASSING: ReadonlySet<Outcome> = new Set<Outcome>(["pass"]);

/**
 * Whether a BankTS implementation exists, which is not whether one could.
 *
 * Its own axis because the previous model had none: `applicability` answered
 * `applicable` exactly when a `main.bank.ts` was on disk, so the two questions
 * had one answer and "applicable" meant "done". `applicable + unauthored` is
 * the state that says there is work left, and it could not be expressed.
 */
export type Authoring = "authored" | "unauthored";

/**
 * Which engines ran the generated COBOL.
 *
 * Reported apart from the semantic result, because "it passed" and "both
 * implementations of these semantics agreed" are different claims and the
 * second is the one this project's green rests on. A task `cobc` ran and the
 * interpreter refused is `gnucobol-only` and is never called a differential
 * pass.
 */
export type Execution =
  "not-executed" | "gnucobol-only" | "runtime-only" | "both-engines";

export interface TaskResult {
  taskId: string;
  corpus: string;
  /** Whether BankTS could express it, decided without looking for a solution. */
  applicability: string;
  /** Whether one was written. */
  authoring: Authoring;
  /** Which engines ran it. */
  execution: Execution;
  outcome: Outcome;
  /** Free text naming the specific defect, never a category on its own. */
  detail: string | null;
  /** Diagnostics BankLang produced, by stable id. */
  diagnostics: string[];
  /** sha256 of each deterministic artifact, keyed by kind. */
  artifactHashes: Record<string, string>;
  durationMs: number;
  /** True when both execution engines ran and agreed on everything observed. */
  differentialAgreement: boolean | null;
}

/** The environment a run happened in, so a number can be reproduced. */
export interface RunEnvironment {
  banklangVersion: string;
  gitCommit: string;
  nodeVersion: string;
  gnucobolVersion: string | null;
  platform: string;
  arch: string;
  /** sha256 over `validation/corpus-lock.json`, pinning what was measured. */
  corpusLockHash: string;
}

export interface CorpusTally {
  corpus: string;
  /** Tasks the upstream record contains. Never reduced for any reason. */
  discovered: number;
  /** Tasks that parsed into the internal model. */
  imported: number;
  /** Tasks BankTS can express, whether or not anybody has written one. */
  applicable: number;
  unsupportedByDesign: number;
  unsupportedNotYetImplemented: number;
  benchmarkAmbiguous: number;
  malformedUpstream: number;
  excludedLicence: number;
  /** Implementations that exist, over the whole corpus and over the applicable. */
  authored: number;
  authoredOfApplicable: number;
  executed: number;
  bothEngines: number;
  agreements: number;
  divergences: number;
  /** Ran under `cobc` and not under the interpreter. Never a differential pass. */
  interpreterUnavailable: number;
  passed: number;
  /**
   * Passes from tasks classified as ones BankTS could not have matched.
   *
   * Always zero, and checked rather than assumed. Every category other than
   * `applicable` is a claim that no conforming program could match this task;
   * a pass refutes the claim, and this is what makes that refutation loud
   * instead of a quietly improved score.
   */
  passedNotApplicable: number;
  /** Every non-passing outcome, counted by name. */
  failures: Record<string, number>;
  /**
   * Four rates, and the first is why there are four.
   *
   * `pass / applicable` alone reads as a score out of everything BankTS can
   * express, and it did read that way while thirty-eight tasks had no verdict
   * at all. `authored / applicable` is the coverage that rate assumes, so it is
   * reported beside it and cannot be left behind.
   */
  authoringCoverage: string;
  passOfAuthored: string;
  passOfApplicable: string;
  passOfDiscovered: string;
}

/**
 * A rate that carries its own denominator.
 *
 * Returns `n / d` rather than a percentage on purpose. A percentage is the
 * form that survives being copied into a slide with the denominator left
 * behind; `18 / 20` does not.
 */
export function formatRate(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return `${String(numerator)} / 0`;
  }
  const percent = ((numerator / denominator) * 100).toFixed(1);
  return `${String(numerator)} / ${String(denominator)} (${percent}%)`;
}

/**
 * The counts for one corpus, derived from results rather than maintained.
 *
 * `discovered` is passed in rather than counted from `results`, because it is
 * the one number that must come from the upstream record: a task this harness
 * failed to import must still appear in the denominator, and a task it never
 * saw at all is exactly what a silently-shrinking corpus looks like.
 */
export function tally(
  corpus: string,
  discovered: number,
  results: TaskResult[],
): CorpusTally {
  const of = (applicability: string): number =>
    results.filter((result) => result.applicability === applicability).length;

  const failures: Record<string, number> = {};
  for (const result of results) {
    if (result.outcome !== "pass" && result.outcome !== "not-executed") {
      failures[result.outcome] = (failures[result.outcome] ?? 0) + 1;
    }
  }

  const applicable = of("applicable");
  const passed = results.filter((result) => PASSING.has(result.outcome)).length;
  const authored = results.filter(
    (result) => result.authoring === "authored",
  ).length;
  const authoredOfApplicable = results.filter(
    (result) =>
      result.authoring === "authored" && result.applicability === "applicable",
  ).length;
  const executed = results.filter(
    (result) => result.execution !== "not-executed",
  ).length;
  const bothEngines = results.filter(
    (result) => result.execution === "both-engines",
  ).length;

  return {
    corpus,
    discovered,
    imported: results.length,
    applicable,
    unsupportedByDesign: of("unsupported-by-design"),
    unsupportedNotYetImplemented: of("unsupported-not-yet-implemented"),
    benchmarkAmbiguous: of("benchmark-ambiguous"),
    malformedUpstream: of("malformed-upstream"),
    excludedLicence: of("excluded-license"),
    authored,
    authoredOfApplicable,
    executed,
    bothEngines,
    agreements: results.filter(
      (result) => result.differentialAgreement === true,
    ).length,
    divergences: results.filter(
      (result) => result.differentialAgreement === false,
    ).length,
    interpreterUnavailable: results.filter(
      (result) => result.execution === "gnucobol-only",
    ).length,
    passed,
    passedNotApplicable: results.filter(
      (result) =>
        PASSING.has(result.outcome) && result.applicability !== "applicable",
    ).length,
    failures,
    authoringCoverage: formatRate(authoredOfApplicable, applicable),
    passOfAuthored: formatRate(passed, authored),
    passOfApplicable: formatRate(passed, applicable),
    passOfDiscovered: formatRate(passed, discovered),
  };
}

/**
 * Every task is accounted for exactly once, or the tally is wrong.
 *
 * The check that makes the numbers above trustworthy: applicability categories
 * partition the imported tasks, and imported can never exceed discovered. A
 * corpus that quietly drops six hard tasks fails here rather than reporting a
 * better score.
 */
export function checkTallyIsComplete(tally: CorpusTally): string[] {
  const problems: string[] = [];
  const categorised =
    tally.applicable +
    tally.unsupportedByDesign +
    tally.unsupportedNotYetImplemented +
    tally.benchmarkAmbiguous +
    tally.malformedUpstream +
    tally.excludedLicence;
  if (categorised !== tally.imported) {
    problems.push(
      `${tally.corpus}: ${String(categorised)} tasks carry an applicability and ${String(tally.imported)} were imported. Every task must be classified exactly once.`,
    );
  }
  if (tally.imported > tally.discovered) {
    problems.push(
      `${tally.corpus}: ${String(tally.imported)} tasks imported from ${String(tally.discovered)} discovered, which is impossible.`,
    );
  }
  if (tally.passed > tally.authored) {
    problems.push(
      `${tally.corpus}: ${String(tally.passed)} passed out of ${String(tally.authored)} authored. A task with no implementation cannot pass.`,
    );
  }
  if (tally.authoredOfApplicable > tally.applicable) {
    problems.push(
      `${tally.corpus}: ${String(tally.authoredOfApplicable)} applicable tasks are authored out of ${String(tally.applicable)} applicable, which is impossible.`,
    );
  }
  /*
   * The guard against relabelling a task to shrink the denominator.
   *
   * Every category other than `applicable` is a claim that a conforming BankTS
   * program could not match this task, either because the language cannot express it,
   * or because the benchmark's own expectation is not derivable from its own
   * contract. A task in one of those categories that then *passes* refutes the
   * claim, and the run says so rather than quietly banking the pass.
   */
  if (tally.passedNotApplicable > 0) {
    problems.push(
      `${tally.corpus}: ${String(tally.passedNotApplicable)} passed from tasks classified unsupported or ambiguous, so the classification is wrong.`,
    );
  }
  if (tally.agreements + tally.divergences > tally.bothEngines) {
    problems.push(
      `${tally.corpus}: ${String(tally.agreements + tally.divergences)} differential verdicts from ${String(tally.bothEngines)} tasks both engines ran. A verdict needs two engines.`,
    );
  }
  return problems;
}
