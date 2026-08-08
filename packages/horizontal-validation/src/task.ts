/**
 * One external benchmark task, in a shape this repository can execute.
 *
 * Four corpora, four upstream formats, one internal model. The normalisation is
 * where the anti-contamination rule is enforced rather than merely stated:
 * `SpecOnlyTask` is what a BankTS implementation is written against and it
 * physically cannot carry the reference COBOL, because the field does not
 * exist on the type. The reference material travels separately, in
 * `SealedTask`, and is read by the evaluator after the implementation is
 * checked in.
 *
 * That is a weaker guarantee than it sounds and it is stated honestly in
 * `docs/validation/horizontal-validation.md`: the author of the BankTS is an AI
 * agent that could in principle have read the sealed file. What the split buys
 * is that the *normal* path does not show it, the materialised spec on disk
 * does not contain it, and anybody reproducing this can see which bytes were
 * available at authoring time. Development is AI-assisted and says so;
 * compilation and scoring are neither.
 */

/**
 * Why a task is or is not run.
 *
 * `unsupported-by-design` and `unsupported-not-yet-implemented` are kept apart
 * because they say opposite things about the project. The first is BankTS
 * working as intended — a banking language declining IEEE floating point is not
 * a gap — and the second is a to-do list. Collapsing them would let every
 * missing feature be relabelled a principle.
 *
 * `not-yet-authored` is the honest third category and the one that keeps the
 * denominator straight: the task is expressible, and no BankTS implementation
 * has been written for it. It is neither a pass nor a language limit, and it is
 * never folded into either.
 */
export type Applicability =
  | "applicable"
  | "not-yet-authored"
  | "unsupported-by-design"
  | "unsupported-not-yet-implemented"
  | "malformed-upstream"
  | "excluded-license";

export interface UnsupportedReason {
  /** The construct or requirement that decided it, e.g. `COMP-2`. */
  construct: string;
  /** Why BankTS does not express it, in one sentence. */
  reason: string;
  /** Whether supporting it would be desirable, honestly answered. */
  desirable: boolean;
  /** True when the exclusion follows from what BankTS is for. */
  fundamental: boolean;
}

/**
 * A task as an implementer may see it: the specification and the contract.
 *
 * Everything here came from the upstream record's prose and data fields. No
 * field of this type ever holds COBOL written by the benchmark.
 */
export interface SpecOnlyTask {
  /** `<corpus>/<upstream-id>`, unique across every corpus. */
  id: string;
  corpus: string;
  upstreamId: string;
  upstreamVersion: string;
  licence: string;
  /** The natural-language statement of what the program must do. */
  specification: string;
  /** Input files the program is given, keyed by the name it opens. */
  inputs: Record<string, string>;
  /** Files the program must produce, keyed by name, with exact contents. */
  expectedOutputs: Record<string, string>;
  expectedStdout: string | null;
  expectedExitCode: number | null;
  /** Seconds this task may take before it is recorded as a timeout. */
  timeoutMs: number;
}

/**
 * The upstream material a spec-only task deliberately excludes.
 *
 * Written to a sibling directory that the authoring process does not read, and
 * used by the evaluator only where the benchmark's own expected outputs are not
 * a sufficient oracle — which, for CobolCodeBench, they are.
 */
export interface SealedTask {
  id: string;
  /** The benchmark's own COBOL, kept out of the authoring path. */
  referenceCobol: string;
  /** COBOL test drivers the benchmark supplies, where it supplies them. */
  drivers: string[];
}

/** A task, its applicability verdict, and the BankTS written for it if any. */
export interface NormalizedTask extends SpecOnlyTask {
  applicability: Applicability;
  unsupported: UnsupportedReason | null;
  /**
   * Path to the BankTS implementation, relative to the repository root.
   *
   * Present exactly when `applicability` is `applicable`. The pairing is
   * checked by `tests/horizontal-model.test.ts` rather than trusted, because a
   * task marked applicable with no implementation would be counted in the
   * denominator of the pass rate and could never pass.
   */
  implementation: string | null;
  /** BankTS features the implementation needs, for the coverage matrix. */
  requiresBankTs: string[];
  /** COBOL features the task's contract implies. */
  requiresCobol: string[];
}

export class MalformedTaskError extends Error {}

/**
 * A task read off disk, checked rather than trusted.
 *
 * A manifest is JSON somebody else's generator wrote. Every field is verified
 * here — including that the file names inside `inputs` and `expectedOutputs`
 * are plain names rather than paths — so a malformed record fails loudly at the
 * boundary instead of producing a run whose results are quietly meaningless.
 */
export function parseSpecOnlyTask(
  value: unknown,
  source: string,
): SpecOnlyTask {
  if (typeof value !== "object" || value === null) {
    throw new MalformedTaskError(`${source}: not a JSON object.`);
  }
  const raw = value as Record<string, unknown>;
  const text = (field: string): string => {
    const found = raw[field];
    if (typeof found !== "string" || found.length === 0) {
      throw new MalformedTaskError(
        `${source}: '${field}' must be a non-empty string.`,
      );
    }
    return found;
  };
  const files = (field: string): Record<string, string> => {
    const found = raw[field];
    if (typeof found !== "object" || found === null || Array.isArray(found)) {
      throw new MalformedTaskError(`${source}: '${field}' must be an object.`);
    }
    const result: Record<string, string> = {};
    for (const [name, content] of Object.entries(found)) {
      // A file name from a corpus is the one thing here that becomes a path, so
      // it is checked as a name rather than sanitised into one. `safeJoin`
      // catches the traversal at write time; this catches it at read time, when
      // the message can still name the manifest that carried it.
      if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
        throw new MalformedTaskError(
          `${source}: '${field}' names a path rather than a file: ${JSON.stringify(name)}`,
        );
      }
      if (name === "" || name === "." || name === "..") {
        throw new MalformedTaskError(
          `${source}: '${field}' has an unusable file name: ${JSON.stringify(name)}`,
        );
      }
      if (typeof content !== "string") {
        throw new MalformedTaskError(
          `${source}: '${field}.${name}' must be a string.`,
        );
      }
      result[name] = content;
    }
    return result;
  };

  const timeout = raw.timeoutMs;
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout <= 0
  ) {
    throw new MalformedTaskError(
      `${source}: 'timeoutMs' must be a positive number.`,
    );
  }

  const exitCode = raw.expectedExitCode;
  if (exitCode !== null && typeof exitCode !== "number") {
    throw new MalformedTaskError(
      `${source}: 'expectedExitCode' must be a number or null.`,
    );
  }
  const stdout = raw.expectedStdout;
  if (stdout !== null && typeof stdout !== "string") {
    throw new MalformedTaskError(
      `${source}: 'expectedStdout' must be a string or null.`,
    );
  }

  return {
    id: text("id"),
    corpus: text("corpus"),
    upstreamId: text("upstreamId"),
    upstreamVersion: text("upstreamVersion"),
    licence: text("licence"),
    specification: text("specification"),
    inputs: files("inputs"),
    expectedOutputs: files("expectedOutputs"),
    expectedStdout: stdout,
    expectedExitCode: exitCode,
    timeoutMs: timeout,
  };
}
