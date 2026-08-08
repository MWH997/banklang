/**
 * Why a benchmark task has no BankTS implementation, recorded rather than told.
 *
 * `not-yet-authored` is an honest category and a useless one on its own: it
 * counts against the pass rate without saying whether anybody could close it.
 * Two of the previous phases produced a prose list of blockers in a commit
 * message, which is where a finding goes to be forgotten.
 *
 * So a blocker is data. Each entry names the task, what stopped it, and — where
 * the answer is a property of BankTS rather than of the benchmark — the exact
 * observation that established it. The reports read this, so the funnel says
 * why 38 tasks are unauthored instead of leaving a reader to assume nobody
 * tried.
 *
 * A task with no entry here is simply one nobody has attempted yet, and that is
 * a different and more embarrassing thing than one that was attempted and
 * found to need a language feature. Keeping them apart is the point.
 */

export type BlockerKind =
  /** BankTS cannot express it, and the reason is recorded. */
  | "language-gap"
  /** The benchmark's expected output is not derivable from its own contract. */
  | "benchmark-ambiguous"
  /** The task asks for something BankTS refuses on purpose. */
  | "by-design"
  /** Nobody has attempted it. No claim is made about difficulty. */
  | "unattempted";

export interface TaskBlocker {
  /** Upstream id, e.g. `task_func_37`. */
  task: string;
  kind: BlockerKind;
  /** One sentence a reader can act on. */
  reason: string;
  /**
   * What was actually observed, where something was.
   *
   * A diagnostic id, a measured property of the fixture — something a person
   * can reproduce. Absent for `unattempted`, which is a statement about this
   * repository rather than about the task.
   */
  evidence?: string;
}

/**
 * The blockers established by attempting the task, not by reading it.
 *
 * Everything here was found by writing BankTS and compiling it. A task that
 * merely looks hard is `unattempted` until somebody tries.
 */
export const TASK_BLOCKERS: TaskBlocker[] = [
  {
    task: "task_func_37",
    kind: "language-gap",
    reason:
      "The task sorts records on a field and writes them out in a different field order. BankTS's `sort` requires the input and output files to hold the same record type, so a sort that also reformats has no form — the reformat would have to happen through an intermediate file.",
    evidence:
      "BANK-FILE-005: `task7Inp holds RawLine but task7Out holds SortedLine`, and BANK-FILE-006 on the output procedure's record. Reproduced by `sort task7Inp into task7Out on rawDepartment` with an output procedure that reformats.",
  },
];

const BY_TASK = new Map(TASK_BLOCKERS.map((entry) => [entry.task, entry]));

/** The recorded blocker for a task, or an `unattempted` default. */
export function blockerFor(task: string): TaskBlocker {
  return (
    BY_TASK.get(task) ?? {
      task,
      kind: "unattempted",
      reason:
        "No BankTS implementation has been written and none has been attempted, so nothing is known about whether the language can express it.",
    }
  );
}
