/**
 * Deciding whether a run matched the benchmark, on behaviour rather than text.
 *
 * The rule this file exists to enforce: generated COBOL is never scored against
 * reference COBOL by similarity. Two programs can differ in every line and
 * compute the same thing, and BankLang's output differs from a hand-written
 * solution by construction — it names paragraphs differently, orders working
 * storage differently, and writes out banker's rounding as an EVALUATE where a
 * person would write ROUNDED. A text score would measure style.
 *
 * So what is compared is what a user would see: the bytes in the output files,
 * what was displayed, and the return code.
 *
 * The normalisations below are the delicate part, and each is limited to a
 * difference that is genuinely about the environment rather than the program.
 * Trailing whitespace on a line is one: a COBOL `WRITE` from a fixed-length
 * record pads to the record length, and whether the benchmark's expected file
 * kept that padding is a property of how the benchmark's author saved the file.
 * Line endings are another. Nothing else is normalised — a differing digit, a
 * differing field width, a missing record and a differently-rounded penny all
 * fail, which is the entire point.
 */

export interface Difference {
  where: string;
  expected: string;
  actual: string;
}

/**
 * Whether the benchmark's expected output could be produced from its own spec.
 *
 * The anti-contamination protocol says an implementation is written from the
 * prose and the inputs and nothing else. That makes a benchmark unmatchable
 * whenever its expected output contains words found in neither — a column
 * heading nobody described, or, in CobolCodeBench's weather task, the label
 * `MAXIMAM TEMP:` with the misspelling that only the reference solution knows.
 *
 * Words of four letters or more, because shorter runs are too often fragments
 * of formatting; compared case-insensitively against the specification *and*
 * the input data together, since a program that copies a field through is
 * reproducing its input rather than inventing anything.
 *
 * This is a statement about the benchmark, and it is measured rather than
 * asserted so that a reader can re-run it and disagree with the threshold.
 */
export function isOracleDerivable(
  specification: string,
  inputs: Record<string, string>,
  expectedOutputs: Record<string, string>,
): { derivable: boolean; invented: string[] } {
  const known = folded(`${specification} ${Object.values(inputs).join(" ")}`);
  const words = new Set<string>();
  for (const output of Object.values(expectedOutputs)) {
    for (const word of folded(output).match(/[A-Z]{4,}/g) ?? []) {
      words.add(word);
    }
  }
  const invented = [...words].filter((word) => !known.includes(word)).sort();
  return { derivable: invented.length === 0, invented };
}

/**
 * Upper-cased with the accents taken off, on both sides of the comparison.
 *
 * The defect this exists for. `[A-Z]{4,}` matches no accented letter, so an
 * input of `Váquéz` contributed no word at all while an output of `Vaquez`
 * contributed one — and the function reported a correctly transliterated name
 * as a literal the benchmark had invented. CobolCodeBench's task_func_47 spent
 * a phase misfiled as an oracle problem on the strength of it; its actual
 * obstacle is that a BankTS `string<n>` is n single-byte characters and `é` is
 * two bytes of UTF-8.
 *
 * Folding both sides is the fix rather than widening the pattern to accept
 * accents: the question is whether a word in the output came from somewhere,
 * and `Vaquez` plainly came from `Váquéz`. A benchmark whose expected output
 * differs from its input only by an accent is reproducing its input.
 */
function folded(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * Line endings unified and trailing blanks removed, per line.
 *
 * Deliberately not `trim()` over the whole text: leading spaces are data in a
 * fixed-format record, and a program that indents its output differently is a
 * program that produced different output.
 */
export function normalizeOutput(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "\n");
}

/** The first place two texts differ, described so it can be acted on. */
export function firstDifference(
  where: string,
  expected: string,
  actual: string,
): Difference | null {
  const left = normalizeOutput(expected).split("\n");
  const right = normalizeOutput(actual).split("\n");
  const lines = Math.max(left.length, right.length);
  for (let index = 0; index < lines; index += 1) {
    const a = left[index] ?? "<no such line>";
    const b = right[index] ?? "<no such line>";
    if (a !== b) {
      return {
        where: `${where}, line ${String(index + 1)}`,
        expected: a,
        actual: b,
      };
    }
  }
  return null;
}

export interface ObservedRun {
  exitCode: number | null;
  stdout: string;
  /** Output files, keyed by the name the program wrote them under. */
  outputs: Map<string, string>;
}

export interface Expectation {
  expectedOutputs: Record<string, string>;
  expectedStdout: string | null;
  expectedExitCode: number | null;
}

/**
 * Every way a run failed to meet the benchmark's expectation.
 *
 * All of them, not the first: a task whose output file is right and whose
 * return code is wrong is a different defect from one where both are wrong, and
 * stopping at the first difference hides which.
 */
export function compareRun(
  observed: ObservedRun,
  expected: Expectation,
): Difference[] {
  const differences: Difference[] = [];

  for (const [name, content] of Object.entries(expected.expectedOutputs)) {
    const actual = observed.outputs.get(name);
    if (actual === undefined) {
      differences.push({
        where: `output file ${name}`,
        expected: `${String(normalizeOutput(content).split("\n").length)} lines`,
        actual: "the program did not write it",
      });
      continue;
    }
    const difference = firstDifference(`output file ${name}`, content, actual);
    if (difference) {
      differences.push(difference);
    }
  }

  if (expected.expectedStdout !== null) {
    const difference = firstDifference(
      "stdout",
      expected.expectedStdout,
      observed.stdout,
    );
    if (difference) {
      differences.push(difference);
    }
  }

  if (
    expected.expectedExitCode !== null &&
    observed.exitCode !== expected.expectedExitCode
  ) {
    differences.push({
      where: "return code",
      expected: String(expected.expectedExitCode),
      actual: String(observed.exitCode),
    });
  }

  return differences;
}

/**
 * Where the two execution engines disagree with each other.
 *
 * Separate from the oracle comparison and more important than it. A benchmark
 * mismatch says this compiler produced the wrong answer; a divergence between
 * `cobc` and `packages/cobol-runtime` says the two implementations of this
 * project's semantics disagree, and until it is explained one of them is wrong
 * about something the whole playground is built on.
 */
export function compareEngines(
  compiled: ObservedRun,
  interpreted: ObservedRun,
): Difference[] {
  const differences: Difference[] = [];
  if (compiled.exitCode !== interpreted.exitCode) {
    differences.push({
      where: "return code",
      expected: `cobc: ${String(compiled.exitCode)}`,
      actual: `interpreter: ${String(interpreted.exitCode)}`,
    });
  }
  const stdout = firstDifference("stdout", compiled.stdout, interpreted.stdout);
  if (stdout) {
    differences.push({
      where: `${stdout.where} (cobc vs interpreter)`,
      expected: stdout.expected,
      actual: stdout.actual,
    });
  }
  const names = new Set([
    ...compiled.outputs.keys(),
    ...interpreted.outputs.keys(),
  ]);
  for (const name of [...names].sort()) {
    const difference = firstDifference(
      `output file ${name} (cobc vs interpreter)`,
      compiled.outputs.get(name) ?? "",
      interpreted.outputs.get(name) ?? "",
    );
    if (difference) {
      differences.push(difference);
    }
  }
  return differences;
}
