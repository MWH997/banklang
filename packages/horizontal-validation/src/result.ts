/**
 * What a horizontal run produces, and the arithmetic nobody gets to choose.
 *
 * The temptation this file exists to remove: BankTS expresses 20 of 46 tasks
 * and 18 of those pass, so the headline reads 90%. Both numbers are true and
 * the sentence is a lie, because the reader supplies the missing denominator
 * themselves and supplies 46. So `tally` below computes both rates, always, and
 * `formatRate` refuses to render one without its denominator attached.
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
   * specification nor the input data — `MAXIMAM TEMP:`, complete with the
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
  /** Not run, and correctly so. Carries the applicability that decided it. */
  | "skipped"
  | "pass";

/** Outcomes that mean the toolchain produced the expected observable behaviour. */
export const PASSING: ReadonlySet<Outcome> = new Set<Outcome>(["pass"]);

export interface TaskResult {
  taskId: string;
  corpus: string;
  /** Why it was or was not run, carried alongside what happened. */
  applicability: string;
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
  /** Tasks BankTS can express *and* has an implementation for. */
  applicable: number;
  notYetAuthored: number;
  unsupportedByDesign: number;
  unsupportedNotYetImplemented: number;
  malformedUpstream: number;
  excludedLicence: number;
  passed: number;
  /** Every non-passing outcome, counted by name. */
  failures: Record<string, number>;
  /** passed / applicable, and passed / discovered. Both, always. */
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
    if (result.outcome !== "pass" && result.outcome !== "skipped") {
      failures[result.outcome] = (failures[result.outcome] ?? 0) + 1;
    }
  }

  const applicable = of("applicable");
  const passed = results.filter((result) => PASSING.has(result.outcome)).length;

  return {
    corpus,
    discovered,
    imported: results.length,
    applicable,
    notYetAuthored: of("not-yet-authored"),
    unsupportedByDesign: of("unsupported-by-design"),
    unsupportedNotYetImplemented: of("unsupported-not-yet-implemented"),
    malformedUpstream: of("malformed-upstream"),
    excludedLicence: of("excluded-license"),
    passed,
    failures,
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
    tally.notYetAuthored +
    tally.unsupportedByDesign +
    tally.unsupportedNotYetImplemented +
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
  if (tally.passed > tally.applicable) {
    problems.push(
      `${tally.corpus}: ${String(tally.passed)} passed out of ${String(tally.applicable)} applicable. A task that is not applicable was never run and cannot pass.`,
    );
  }
  return problems;
}
