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
    task: "task_func_11",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output lays the filename out in a fixed column the specification never states, and the column is too narrow for one of the inputs — `anthertest.docx` runs straight into the next field, so the file literally contains `docxis`. No implementation written from the contract produces that.",
    evidence:
      "Expected output contains `docxis`, present in neither the specification nor the input data.",
  },
  {
    task: "task_func_15",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output pairs each animal with a list of foods — meat, fish, grass, seeds, sugarcane and eleven more — that exists only inside the reference solution. The specification does not give the table and the input does not contain it.",
    evidence:
      "Seventeen literals in the expected output appear in neither the specification nor the inputs.",
  },
  {
    task: "task_func_26",
    kind: "benchmark-ambiguous",
    reason:
      "A printed report whose headings, column positions and page furniture are in the expected output and not in the specification.",
    evidence: "`STATUS` heading text present in the oracle only.",
  },
  {
    task: "task_func_27",
    kind: "benchmark-ambiguous",
    reason:
      "As task_func_26: the report layout, including the `ACCT NO` caption, is specified only by the expected output.",
    evidence: "`ACCT` caption present in the oracle only.",
  },
  {
    task: "task_func_31",
    kind: "benchmark-ambiguous",
    reason:
      'The specification asks for the values written "with an appropriate label" and the oracle requires three specific labels, two of them misspelled — `MAXIMAM`, `MINIMAM`, `AVERGE`. A correct program cannot guess a typo.',
    evidence:
      "`MAXIMAM`, `MINIMAM` and `AVERGE` appear in the expected output and nowhere in the contract.",
  },
  {
    task: "task_func_39",
    kind: "benchmark-ambiguous",
    reason:
      "The report's column headings — `ERROR DESCRIPTION`, `ERR VALUE`, and the rule beneath them — are in the oracle and not in the specification.",
    evidence: "`DESCRIPTION` and `RANGE` present in the oracle only.",
  },
  {
    task: "task_func_44",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output counts words the input file does not contain, so the fixture's input and output do not describe the same run.",
    evidence:
      "`INITIALIZATION`, `CLEANUP` and `COUNTING` are counted in the expected output and absent from the input.",
  },
  {
    task: "task_func_47",
    kind: "language-gap",
    reason:
      "Transliterating accented names — `Téa` to `Tea` — is exactly what `replaceChars` does, character for character. The obstacle is encoding rather than the operation: the input is UTF-8, where `é` is two bytes, and a BankTS `string<n>` is n single-byte characters, so a character-for-character conversion cannot line up.",
    evidence:
      "Input `Téa\\nVáquéz\\n…` against expected `Tea\\nVaquez\\n…`. Note this task was previously classified as an oracle problem, which was a defect in `isOracleDerivable`: it compares ASCII-folded words and so reported the correctly-transliterated output as inventing literals. The specification is complete.",
  },
  {
    task: "task_func_09",
    kind: "language-gap",
    reason:
      'Each line holds a different number of comma-separated numbers — four on one, five on the next — and `split x by "," into a, b, c` writes into a fixed list of receivers named at compile time. A line whose field count is not known until it is read has no BankTS form.',
    evidence:
      "Input lines carry 3 and 4 commas respectively. This is the only task in the corpus that genuinely needs it: an earlier classifier counted any variation in comma count as variable arity and so also flagged task_func_01 and task_func_24, whose variation is a header line rather than a variable record.",
  },
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
