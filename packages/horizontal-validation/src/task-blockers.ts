/**
 * Why a benchmark task is not `applicable`, recorded rather than told.
 *
 * This table used to have a fourth kind, `unattempted`, and twenty-eight of the
 * forty-six tasks sat in it: "nobody has written one, so nothing is known about
 * whether the language can express it." That is an honest sentence and a
 * useless one. It counted against the pass rate without saying whether anybody
 * could close it, and it made the corpus's largest bucket the one carrying no
 * information at all.
 *
 * So the kind is gone, and every task that is not `applicable` has an entry
 * here with the observation that put it there. Where the answer is a property
 * of BankTS, the evidence is a diagnostic or a measured limit reached by
 * writing the BankTS and compiling it. Where the answer is a property of the
 * benchmark, the bar is deliberately high, because "the benchmark is wrong" is
 * the conclusion a tired implementer reaches about a task they have not
 * understood:
 *
 *   - a literal, a constant, a field width or an ordering in the expected
 *     output that appears in neither the specification nor the input data;
 *   - an expectation that contradicts the specification's own words;
 *   - an arithmetic the supplied input cannot produce.
 *
 * Difficulty is not ambiguity. Several of the entries below were reached by
 * authoring the task, running it, and reading the one byte that differed —
 * task_func_55 is still authored and still executed for exactly that reason,
 * and its fixture stays in the tree so the evidence can be re-run.
 */

export type BlockerKind =
  /** BankTS cannot express it, and the reason is recorded. */
  | "language-gap"
  /** The benchmark's expected output is not derivable from its own contract. */
  | "benchmark-ambiguous"
  /** The task asks for something BankTS refuses on purpose. */
  | "by-design";

export interface TaskBlocker {
  /** Upstream id, e.g. `task_func_37`. */
  task: string;
  kind: BlockerKind;
  /** One sentence a reader can act on. */
  reason: string;
  /**
   * What was actually observed, and where.
   *
   * A diagnostic id, a measured property of the fixture, a byte that differs —
   * something a person can reproduce and disagree with. Required: an entry
   * without it is an opinion.
   */
  evidence: string;
}

export const TASK_BLOCKERS: TaskBlocker[] = [
  /* ---------------------------------------------------------------- *
   * The benchmark's expected output is not derivable from its own
   * contract. Eleven of these, each with the specific bytes.
   * ---------------------------------------------------------------- */
  {
    task: "task_func_01",
    kind: "benchmark-ambiguous",
    reason:
      "The additional goals and penalties are 'data stored in the program', which the specification leaves to the implementer and the oracle fixes exactly; and the output carries a header line the specification never mentions.",
    evidence:
      "Expected output opens `team,goals,penalties`, which is in neither the specification nor `match_data.ps`. Team A must gain 3 goals and 1 penalty and three further teams must appear with amounts (B 2/0, D 0/3, E 2/1) that are stated nowhere.",
  },
  {
    task: "task_func_03",
    kind: "benchmark-ambiguous",
    reason:
      "The specification requires the three numbers to be validated as positive and an error displayed otherwise; the supplied input is `0,2,3` and the oracle instead computes 0! and prints six permutations in an order the specification does not state.",
    evidence:
      "Input contains 0, which the specification calls invalid. Expected `task_func03_out1` is `0000000009`, which is 0!+2!+3!. Expected `task_func03_out2` orders the permutations by position (1,2,3) (1,3,2) (2,3,1) (2,1,3) (3,2,1) (3,1,2) — one of six possible orders, none of them named.",
  },
  {
    task: "task_func_08",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output truncates a base filename to eight characters, and no width appears anywhere in the specification.",
    evidence:
      "Input `test2file.txt` against expected `test2fil.csv`. `test2fil` is in neither the specification nor the input; converting the extension of the supplied name gives `test2file.csv`.",
  },
  {
    task: "task_func_10",
    kind: "benchmark-ambiguous",
    reason:
      "The specification says each detail line shows the country and population 'separated by a colon and space' and the expected output has no colon; the list of valid countries is left to the implementer and the oracle requires a specific one; and every population loses its leading digit.",
    evidence:
      "Expected `India                 31002651` against input `India               331002651` — no colon, and 331002651 truncated to 31002651. Afghanistan and Japan are dropped, which requires the reference's own country table.",
  },
  {
    task: "task_func_11",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output lays the filename out in a fixed column the specification never states, and the column is too narrow for one of the inputs — `anthertest@file.docx` runs straight into the next field, so the file literally contains `docxis`.",
    evidence:
      "Expected output contains `docxis`, present in neither the specification nor the input data.",
  },
  {
    task: "task_func_12",
    kind: "benchmark-ambiguous",
    reason:
      "The specification says to sort the records by patient name and to use a sort file for it; the expected output is in the input's own order.",
    evidence:
      "Expected order is Palekit, Nikhil, Somesh, Panit — the order of the input file. Sorted ascending by name it would be Nikhil, Palekit, Panit, Somesh. The per-patient totals are right either way, so the ordering is the whole of the difference.",
  },
  {
    task: "task_func_15",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output pairs each animal with a list of foods — meat, fish, grass, seeds, sugarcane and eleven more — that exists only inside the reference solution. The specification does not give the table and the input files are empty.",
    evidence:
      "Seventeen literals in the expected output appear in neither the specification nor the inputs.",
  },
  {
    task: "task_func_19",
    kind: "benchmark-ambiguous",
    reason:
      "None of the three statistics in the expected output is the statistic the specification names for the supplied data.",
    evidence:
      "The six salaries are 5000000, 6000000, 5800000, 6500000, 5400000 and 6100000. Their mean is 5800000; the oracle's `MEAN 497142857` is that sum divided by seven rather than six. The median is 5900000; the oracle gives 5400000, the second smallest. The standard deviation is about 519000; the oracle gives 1968.47.",
  },
  {
    task: "task_func_24",
    kind: "benchmark-ambiguous",
    reason:
      "The two files have the same number of lines and the specification's rule for differing lines is to write both with `-` and `+`; the expected output writes only the `-` side for the last pair.",
    evidence:
      "`task_func24_inp1` line 5 is `Anubhav 41` and `task_func24_inp2` line 5 is empty. Expected output has `000005,-,Anubhav 41` and no matching `+` record, which requires treating a blank final line as the end of the file rather than as a line that differs.",
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
    task: "task_func_29",
    kind: "benchmark-ambiguous",
    reason:
      "The count the specification calls 'the number of duplicates found for each age' is neither the number of occurrences nor the number of extras.",
    evidence:
      "Two records share a name at age 25 and the oracle gives 002; three share one at age 29 and it gives 006. That is n(n-1), which the specification does not describe, and the header `AGE CNT` is in the oracle only.",
  },
  {
    task: "task_func_30",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output omits one of the words that meets its own criterion and orders the rest by nothing the specification states.",
    evidence:
      "`in` occurs twice in the input and is absent from the expected output, while `a`, `IT` and `Bangalore` — also twice — are present. The three present are in neither input order (`a` comes first in the text) nor alphabetical order.",
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
    task: "task_func_36",
    kind: "benchmark-ambiguous",
    reason:
      "Neither the mean nor the median in the expected output is the mean or median of the supplied numbers.",
    evidence:
      "The eleven values sum to 18667, so the mean is 1697 and the median of the sorted values is 234. The oracle gives `Mean = 07151` and `Median = 00019`.",
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
    task: "task_func_55",
    kind: "benchmark-ambiguous",
    reason:
      "The expected output's final record carries a character the input cannot produce.",
    evidence:
      "Authored, compiled and executed — the fixture is in the tree and runs. Both engines agree on all five records and every one matches except the last: expected `016730`, six characters, where the corresponding input record is `01673`. No threshold makes a five-digit value six digits long.",
  },

  /* ---------------------------------------------------------------- *
   * BankTS cannot express it, and each was established by writing the
   * BankTS and reading what the compiler said.
   * ---------------------------------------------------------------- */
  {
    task: "task_func_09",
    kind: "benchmark-ambiguous",
    reason:
      "The specification asks for the minimum, maximum and sum of the numbers on each line; the expected output holds the *first* number, the *last* number and the sum. No correct implementation of the stated contract can produce it.",
    evidence:
      "Line two of the input is `3,2,18,45,6`. Its minimum is 2 and its maximum is 45; the expected line is `0003.00     0006.00     000074.00` — first, last, and a correct sum. Line one, `1,3,4,5`, is the same rule and cannot tell the two apart because its first and last happen to be its minimum and maximum. The overall figures follow: minimum 1 is the first number of the file and maximum 6 is the last.\n\nThis task was previously recorded as the corpus\u2019s one genuine case of a variable-arity split — four numbers on one line and five on the next, against a `split` whose receivers are named at compile time. That is still true of the input and is no longer the blocker: the oracle would be unreachable with any splitting mechanism.\n\nThe splitting question is now measured separately. `evidence/horizontal/xcobol-v2/string-usage.json` records 130 of 622 `UNSTRING` statements carrying `TALLYING`, which is COBOL\u2019s way of saying how many receivers were filled — a bounded, deterministic count over a fixed set of receivers rather than an unbounded list. That is external justification for a `counting` clause on `split`, and it is the case for one; it is no longer entangled with this task.",
  },
  {
    task: "task_func_47",
    kind: "language-gap",
    reason:
      "Transliterating accented names — `Téa` to `Tea` — is exactly what `replaceChars` does, character for character. The obstacle is the character model rather than the operation: the input is UTF-8, where `é` is two bytes, and a BankTS `string<n>` is n single-byte characters, so a character-for-character conversion cannot line up.",
    evidence:
      "Input `Téa\\nVáquéz\\n…` against expected `Tea\\nVaquez\\n…`. `string<n>` emits `PIC X(n)`, one byte per position; `Váquéz` occupies eight bytes and six characters. Note the earlier classification of this task as an oracle problem was a defect in `isOracleDerivable`, now fixed: the specification is complete.",
  },
];

const BY_TASK = new Map(TASK_BLOCKERS.map((entry) => [entry.task, entry]));

/** The recorded blocker for a task, or null where BankTS should manage it. */
export function blockerFor(task: string): TaskBlocker | null {
  return BY_TASK.get(task) ?? null;
}
