import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compile } from "../packages/compiler/src/index";
import { exampleProjects } from "./example-projects";
import { differentialProjects, NOT_INTERPRETED } from "./interpret";

/**
 * What each example's evidence actually establishes, counted.
 *
 * The three grades are not new — the repository has always had them — but
 * nothing named them, so a feature could slide from "executed" to "compiles
 * only" without anything showing. The 2026-08-05 audit's §5.9 asks for the
 * counts in CI, where a drop becomes a diff in a file somebody reviews rather
 * than an absence nobody notices.
 *
 * The grades are ordered by what they rule out:
 *
 * - **executed** — the generated program is linked against the reference
 *   runtime in `runtime/` and run, and a test asserts on the ledger it wrote,
 *   the balances it left, and the branches it took. This is the only grade that
 *   catches a defect that compiles.
 *
 *   Two kinds of test earn it, and the note column says which. A *hand-written*
 *   one states the expected balances itself, which is the stronger evidence
 *   because the expectation came from arithmetic somebody did on paper. A
 *   *differential* one runs the same program under `cobc` and under
 *   `packages/cobol-runtime` and requires the two to agree, which catches a
 *   defect that compiles without anybody having to predict the answer — but
 *   would not catch a program that is wrong in the same way twice.
 * - **compiled** — `cobc` accepts it under `tools/banklang-ibm.conf`, a
 *   GnuCOBOL dialect shaped to Enterprise COBOL 6.4. It rules out a program the
 *   target would reject; it says nothing about what the program computes.
 * - **emitted** — artifacts are produced and pass the conformance linter, and
 *   nothing local compiles them. A CICS program needs the translator and a Db2
 *   program needs the precompiler, neither of which exists off z/OS.
 *
 * None of the three is IBM Enterprise COBOL. See `docs/status-and-limits.md`.
 */
export type EvidenceGrade = "executed" | "compiled" | "emitted";

export interface ExampleGrade {
  example: string;
  grade: EvidenceGrade;
  /** Why it is not higher, when it is not the top grade. */
  reason: string;
}

/**
 * Examples a test executes.
 *
 * Read from the test sources rather than listed here, because a list here is a
 * second place to keep in step and the failure mode is a grade that claims more
 * than the suite does. A test that stops executing an example stops naming it.
 */
export function handAssertedExamples(cwd = process.cwd()): Set<string> {
  const executed = new Set<string>();
  const root = resolve(cwd, "tests");

  for (const entry of readdirSync(root)) {
    if (!entry.endsWith(".test.ts")) {
      continue;
    }
    const text = readFileSync(join(root, entry), "utf8");
    // Only suites that actually run a program. A suite that compiles an
    // example and reads the emitted text is inspection, whatever it is called,
    // and `runConformance` is the one helper that links against `runtime/` and
    // executes what it built.
    if (!/\brunConformance\b/.test(text)) {
      continue;
    }
    for (const match of text.matchAll(
      /"(examples\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)\/src\/main\.bank\.ts"/g,
    )) {
      executed.add(match[1]!);
    }
  }

  return executed;
}

export function gradeExamples(cwd = process.cwd()): ExampleGrade[] {
  const asserted = handAssertedExamples(cwd);
  const differential = new Set(differentialProjects(cwd));

  return exampleProjects(cwd).map((example) => {
    if (asserted.has(example)) {
      return {
        example,
        grade: "executed" as const,
        reason: "",
      };
    }
    if (differential.has(example)) {
      return {
        example,
        grade: "executed" as const,
        reason: "differential: agrees with cobc, no hand-written expectation",
      };
    }

    const source = readFileSync(
      resolve(cwd, example, "src", "main.bank.ts"),
      "utf8",
    );
    const requirements = compile(source).backendRequirements;
    const blocking = requirements.filter(
      (requirement) =>
        requirement === "cics-translator" || requirement === "db2-precompiler",
    );

    if (blocking.length > 0) {
      return {
        example,
        grade: "emitted" as const,
        reason: `needs ${blocking.join(" and ")}, which ${blocking.length > 1 ? "exist" : "exists"} only on z/OS`,
      };
    }

    return {
      example,
      grade: "compiled" as const,
      reason:
        NOT_INTERPRETED[example] ??
        "no test runs it against the reference runtime",
    };
  });
}

const ORDER: EvidenceGrade[] = ["executed", "compiled", "emitted"];

/** The table CI prints, and the one a reviewer diffs. */
export function renderGrades(grades: ExampleGrade[]): string {
  const counts = new Map<EvidenceGrade, number>(
    ORDER.map((grade) => [grade, 0]),
  );
  for (const entry of grades) {
    counts.set(entry.grade, (counts.get(entry.grade) ?? 0) + 1);
  }

  return [
    "# Evidence grades",
    "",
    "What each example's evidence establishes. Generated by `pnpm evidence:grades`.",
    "",
    "| Grade | Count | What it rules out |",
    "| --- | --- | --- |",
    `| executed | ${counts.get("executed")} | A defect that compiles: the program is run and its ledger, balances and branches are asserted on. |`,
    `| compiled | ${counts.get("compiled")} | A program the target would reject. Says nothing about what it computes. |`,
    `| emitted | ${counts.get("emitted")} | Nothing local compiles it; the conformance linter is what checks it. |`,
    "",
    "None of the three is IBM Enterprise COBOL.",
    "See [docs/status-and-limits.md](../docs/status-and-limits.md).",
    "",
    "| Example | Grade | Note |",
    "| --- | --- | --- |",
    ...[...grades]
      .sort(
        (left, right) =>
          ORDER.indexOf(left.grade) - ORDER.indexOf(right.grade) ||
          left.example.localeCompare(right.example),
      )
      .map(
        (entry) =>
          `| \`${entry.example.replace("examples/", "")}\` | ${entry.grade} | ${entry.reason} |`,
      ),
    "",
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const page = renderGrades(gradeExamples());
  // Written as well as printed, so the counts are a file a reviewer diffs
  // rather than a line in a log nobody scrolls back to.
  writeFileSync(resolve("evidence", "GRADES.md"), page, "utf8");
  process.stdout.write(page);
}
