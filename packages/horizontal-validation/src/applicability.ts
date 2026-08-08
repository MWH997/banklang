/**
 * Deciding, by rule, whether BankTS can express an externally specified task.
 *
 * The two semantic corpora hand this project 192 programs written to somebody
 * else's contract. Some of them BankTS can express; many it cannot, and the
 * honest reporting of *which* is the whole value of the exercise. The rules
 * below are applied to the task's own text — its specification, and for
 * COBOLEval the calling interface the benchmark fixes — so the verdict is
 * reproducible and arguable rather than a judgement somebody made once.
 *
 * The bar this file has to clear: it must not be possible to raise the score by
 * moving a hard task into an excluded bucket. So the rules only ever fire on a
 * *construct BankTS demonstrably lacks*, each one named, and everything they do
 * not fire on stays in the applicable denominator whether or not an
 * implementation exists for it. A task with no implementation is
 * `not-yet-authored`, which counts against the pass rate exactly as a failure
 * would; it is simply labelled truthfully.
 */

import type { Applicability, UnsupportedReason } from "./task";

export interface ApplicabilityRule {
  /** Matched against the task's specification and interface text. */
  pattern: RegExp;
  construct: string;
  reason: string;
  desirable: boolean;
  fundamental: boolean;
}

/**
 * Constructs that put a task outside BankTS, each with the evidence.
 *
 * Ordered most-fundamental first, so a task excluded for several reasons is
 * reported under the one that matters. `COMP-2` leads because it is the single
 * largest exclusion in COBOLEval and the least negotiable: the benchmark
 * defines almost every task's interface in IEEE binary floating point.
 */
export const APPLICABILITY_RULES: ApplicabilityRule[] = [
  {
    pattern:
      /(?<![A-Z0-9-])COMP-2(?![A-Z0-9-])|(?<![A-Z0-9-])COMP-1(?![A-Z0-9-])/,
    construct: "COMP-2 / COMP-1",
    reason:
      "The task's interface is defined in IEEE binary floating point. BankTS has no floating-point type: money arithmetic that cannot be reproduced exactly is the thing the language exists to prevent, and adding a float type to score on a benchmark would be exactly the distortion this exercise forbids.",
    desirable: false,
    fundamental: true,
  },
  {
    /*
     * The benchmark fixes the calling interface, and BankTS's entry contract
     * does not fit inside it.
     *
     * COBOLEval's drivers `CALL "X" USING LINKED-ITEMS` where LINKED-ITEMS is
     * declared field for field — `05 L-N PIC S9(10). 05 RESULT PIC 9.` — and
     * assert on what the program leaves in `RESULT`. A BankTS program's only
     * entry point is `entry transaction`, which the compiler requires to carry
     * an idempotency key (`BANK-TXN-001`) and to emit an audit event
     * (`BANK-AUD-001`). Both are deliberate: they are how the language makes a
     * unit of work replayable and traceable, and `docs/adr/0003` is the
     * decision. Neither can be added without putting a field in the record the
     * driver declares, which changes the interface the benchmark calls through.
     *
     * So this is a boundary at the *program interface*, upstream of anything
     * about the algorithm — several of these tasks are otherwise perfectly
     * expressible, and one of them is what found the `if`-inside-a-loop defect
     * in the typechecker. Recorded as `desirable: false` because a callable
     * entry point with no transaction contract is a different language feature,
     * not a missing one.
     */
    pattern: /LINKAGE SECTION[\s\S]*\bRESULT\b/,
    construct:
      "a fixed calling interface with no room for the transaction contract",
    reason:
      "The benchmark declares the exact LINKAGE the caller passes and asserts on a RESULT field in it. BankTS's only program entry point is `entry transaction`, which must carry an idempotency key and emit an audit event — both fields in the same record — so a conforming program cannot be written without changing the interface the benchmark calls through.",
    desirable: false,
    fundamental: true,
  },
  {
    pattern: /\bRECURSI/i,
    construct: "unbounded recursion over a data structure",
    reason:
      "BankTS supports recursive functions with LOCAL-STORAGE, but a task whose contract is an unbounded recursive walk has no fixed working set, and a banking batch is required to declare its storage.",
    desirable: false,
    fundamental: false,
  },
  {
    pattern: /\b(?:regular expression|regex)\b/i,
    construct: "regular expressions",
    reason:
      "No pattern-matching library exists in BankTS or in Enterprise COBOL.",
    desirable: false,
    fundamental: false,
  },
  {
    pattern: /\b(?:random|shuffle)\b/i,
    construct: "randomness",
    reason:
      "The compiler's central claim is byte-identical output for identical input, and a program whose behaviour depends on a random source cannot be part of a deterministic evidence bundle.",
    desirable: false,
    fundamental: true,
  },
  {
    pattern: /\bdynamic(?:ally)? (?:allocat|size|length|grow)/i,
    construct: "dynamically sized storage",
    reason:
      "COBOL tables are declared with a maximum, and BankTS follows: `depending` gives a variable length within a declared bound. A task requiring a container that grows without one is not expressible.",
    desirable: false,
    fundamental: true,
  },
];

export interface ApplicabilityVerdict {
  applicability: Applicability;
  unsupported: UnsupportedReason | null;
}

/**
 * Whether a task's files are newline-delimited.
 *
 * Kept, and no longer an exclusion. This decided the whole of CobolCodeBench's
 * applicability until 2026-08-08: every one of the 46 tasks reads a text file,
 * BankTS had no line-sequential organization, and so nothing in that corpus was
 * expressible. The evidence is what prompted the feature — see
 * `docs/language/files.md` — and the organization now exists.
 *
 * The predicate stays because the *shape* of the finding is still worth
 * measuring, and because a caller may want to know which tasks need it. What
 * changed is the answer to "and can BankTS do that", which is now yes.
 *
 * Decided from the data rather than from the file name. The first version of
 * this rule matched `*.txt` in the specification and missed nineteen tasks
 * whose files are called `task_func23_inp` — extensionless, and every bit as
 * line-delimited. A rule that depends on somebody's naming habit is a rule that
 * silently under-reports.
 */
export function needsLineSequential(files: Record<string, string>[]): boolean {
  return files.some((group) =>
    Object.values(group).some((content) => content.includes("\n")),
  );
}

/**
 * A task's verdict from its own text.
 *
 * `hasImplementation` is passed in rather than looked up so this stays a pure
 * function: the caller knows whether a BankTS file exists, and the distinction
 * between "BankTS could express this and nobody has written it" and "BankTS
 * cannot express this" is the one the whole report depends on.
 */
export function classifyTask(
  text: string,
  hasImplementation: boolean,
): ApplicabilityVerdict {
  const upper = text.toUpperCase();
  for (const rule of APPLICABILITY_RULES) {
    // Tested against the upper-cased text for the COBOL constructs and the
    // original for the prose rules, which are written case-insensitively.
    if (rule.pattern.test(upper) || rule.pattern.test(text)) {
      return {
        applicability: rule.fundamental
          ? "unsupported-by-design"
          : "unsupported-not-yet-implemented",
        unsupported: {
          construct: rule.construct,
          reason: rule.reason,
          desirable: rule.desirable,
          fundamental: rule.fundamental,
        },
      };
    }
  }
  return {
    applicability: hasImplementation ? "applicable" : "not-yet-authored",
    unsupported: null,
  };
}
