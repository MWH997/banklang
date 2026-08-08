/**
 * Running the semantic corpora: BankTS in, external oracle out.
 *
 *   pnpm horizontal:run                 every semantic corpus
 *   pnpm horizontal:run cobolcodebench  one of them
 *
 * The pipeline per task, and every stage is a place it can be recorded as
 * failing rather than as passing quietly:
 *
 *     spec.json  ->  the BankTS written from it
 *                ->  bankc check      (typecheck and banking safety)
 *                ->  bankc build      (artifacts)
 *                ->  determinism      (compiled twice, bytes compared)
 *                ->  conformance lint (the target's rules, not a style)
 *                ->  cobc             (a real COBOL compiler)
 *                ->  execute          (both engines)
 *                ->  compare          (against the benchmark's own outputs)
 *
 * Both engines, always, when both can run it. `tools/conformance.ts` compiles
 * with `cobc` and runs the binary; `tools/interpret.ts` reads the same
 * generated COBOL and interprets it. A disagreement between them is recorded as
 * `execution-divergence` and is a higher-priority defect than a benchmark
 * mismatch: it means the two implementations of this project's semantics do not
 * agree, and until that is explained one of them is wrong.
 *
 * A task with no BankTS implementation is `not-yet-authored` and counts in the
 * denominator. It is never dropped, and it is never counted as unsupported.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import {
  checkTallyIsComplete,
  classifyTask,
  needsLineSequential,
  LINE_SEQUENTIAL_EXCLUSION,
  compareEngines,
  compareRun,
  isOracleDerivable,
  parseSpecOnlyTask,
  tally,
  type Outcome,
  type SpecOnlyTask,
  type TaskResult,
} from "../packages/horizontal-validation/src/index";
import { lintCobol } from "../packages/conformance-lint/src/index";
import { compile } from "../packages/compiler/src/index";
import { hasCobc, runConformance, ConformanceError } from "./conformance";
import { runInterpreted } from "./interpret";
import { describeEnvironment } from "./horizontal-environment";
import { TASKS_ROOT } from "./horizontal-materialise";

export const SEMANTIC_CORPORA = ["cobolcodebench", "coboleval"];

/** Where a task's BankTS implementation lives when one has been written. */
export function implementationPath(
  corpus: string,
  slug: string,
  cwd = process.cwd(),
): string {
  return resolve(cwd, TASKS_ROOT, corpus, slug, "main.bank.ts");
}

interface LoadedTask {
  slug: string;
  spec: SpecOnlyTask;
  implementation: string | null;
}

export function loadTasks(corpus: string, cwd = process.cwd()): LoadedTask[] {
  const root = resolve(cwd, TASKS_ROOT, corpus);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((slug) => {
      const specPath = join(root, slug, "spec.json");
      const spec = parseSpecOnlyTask(
        JSON.parse(readFileSync(specPath, "utf8")),
        relative(cwd, specPath),
      );
      const implementation = implementationPath(corpus, slug, cwd);
      return {
        slug,
        spec,
        implementation: existsSync(implementation) ? implementation : null,
      };
    });
}

/**
 * One task, taken as far as it gets.
 *
 * Every early return records the stage that stopped it. The order matters: a
 * task that fails `bankc check` is never reported as a semantic mismatch, and a
 * task whose oracle cannot be derived is still compiled and run — the run is
 * what proves the BankTS was real — before the comparison is recorded as
 * unmatchable.
 */
export function runTask(task: LoadedTask, cwd: string): TaskResult {
  const started = Date.now();
  const base = {
    taskId: task.spec.id,
    corpus: task.spec.corpus,
    diagnostics: [] as string[],
    artifactHashes: {} as Record<string, string>,
    differentialAgreement: null as boolean | null,
  };
  const finish = (
    applicability: string,
    outcome: Outcome,
    detail: string | null,
    extra: Partial<TaskResult> = {},
  ): TaskResult => ({
    ...base,
    applicability,
    outcome,
    detail,
    durationMs: Date.now() - started,
    ...extra,
  });

  // The file organization is decided from the task's own data, before the
  // prose rules run: a newline in any payload means a record separator BankTS
  // cannot declare, whatever the file is called.
  const verdict = needsLineSequential([
    task.spec.inputs,
    task.spec.expectedOutputs,
  ])
    ? {
        applicability: "unsupported-not-yet-implemented" as const,
        unsupported: LINE_SEQUENTIAL_EXCLUSION,
      }
    : classifyTask(task.spec.specification, task.implementation !== null);
  if (verdict.applicability !== "applicable") {
    return finish(
      verdict.applicability,
      "skipped",
      verdict.unsupported
        ? `${verdict.unsupported.construct}: ${verdict.unsupported.reason}`
        : "No BankTS implementation has been written for this task yet.",
    );
  }

  const source = readFileSync(task.implementation as string, "utf8");
  const sourceFile = relative(cwd, task.implementation as string);

  // ---- check ---------------------------------------------------------
  const compiled = compile(source, { sourceFile });
  base.diagnostics = compiled.diagnostics.map((diagnostic) => diagnostic.id);
  if (!compiled.ok || !compiled.cobol) {
    return finish(
      "applicable",
      "bankts-check-failure",
      compiled.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.id}: ${diagnostic.message}`)
        .join("; "),
    );
  }

  // ---- determinism ---------------------------------------------------
  const again = compile(source, { sourceFile });
  if (again.cobol !== compiled.cobol) {
    return finish(
      "applicable",
      "determinism-failure",
      "Two compilations of identical input produced different COBOL.",
    );
  }

  // ---- conformance ---------------------------------------------------
  const findings = lintCobol(sourceFile, compiled.cobol);
  if (findings.length > 0) {
    return finish(
      "applicable",
      "conformance-failure",
      findings
        .slice(0, 3)
        .map((finding) => `${finding.rule}: ${finding.message}`)
        .join("; "),
    );
  }

  if (!hasCobc()) {
    return finish(
      "applicable",
      "infrastructure-failure",
      "cobc is not on the path, so nothing was executed. A skipped run is unchecked, not passing.",
    );
  }

  // ---- execute, both ways --------------------------------------------
  const workDir = join(
    tmpdir(),
    `banklang-horizontal-${task.spec.corpus}-${task.slug}`,
  );
  const inputs = Object.fromEntries(
    Object.entries(task.spec.inputs).map(([name, content]) => [
      name,
      Buffer.from(content, "utf8"),
    ]),
  );
  const outputs = Object.keys(task.spec.expectedOutputs);

  let compiledRun;
  try {
    compiledRun = runConformance({
      source,
      sourceFile,
      workDir,
      inputs,
      outputs,
    });
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    return finish(
      "applicable",
      error instanceof ConformanceError
        ? "cobol-compile-failure"
        : "runtime-failure",
      error instanceof Error ? error.message.slice(0, 600) : String(error),
    );
  }

  let interpretedRun;
  try {
    interpretedRun = runInterpreted({
      source,
      sourceFile,
      workDir,
      inputs,
      outputs,
    });
  } catch (error) {
    interpretedRun = null;
    base.differentialAgreement = null;
    void error;
  }

  const asObserved = (run: {
    exitCode: number | null;
    stdout: string;
    outputs: Map<string, Buffer>;
  }) => ({
    exitCode: run.exitCode,
    stdout: run.stdout,
    outputs: new Map(
      [...run.outputs].map(([name, bytes]) => [name, bytes.toString("utf8")]),
    ),
  });

  const observed = asObserved(compiledRun);

  // ---- the two engines against each other ----------------------------
  if (interpretedRun) {
    const divergence = compareEngines(observed, asObserved(interpretedRun));
    base.differentialAgreement = divergence.length === 0;
    if (divergence.length > 0) {
      rmSync(workDir, { recursive: true, force: true });
      return finish(
        "applicable",
        "execution-divergence",
        divergence
          .slice(0, 3)
          .map((one) => `${one.where}: ${one.expected} vs ${one.actual}`)
          .join("; "),
      );
    }
  }

  // ---- against the benchmark -----------------------------------------
  const oracle = isOracleDerivable(
    task.spec.specification,
    task.spec.inputs,
    task.spec.expectedOutputs,
  );
  const differences = compareRun(observed, {
    expectedOutputs: task.spec.expectedOutputs,
    expectedStdout: task.spec.expectedStdout,
    expectedExitCode: task.spec.expectedExitCode,
  });
  rmSync(workDir, { recursive: true, force: true });

  if (differences.length === 0) {
    return finish("applicable", "pass", null);
  }
  if (!oracle.derivable) {
    return finish(
      "applicable",
      "oracle-not-derivable",
      `The expected output contains ${JSON.stringify(oracle.invented.slice(0, 5))}, which appears in neither the specification nor the input data, so no spec-only implementation could match it. First difference — ${differences[0]?.where}: expected ${JSON.stringify(differences[0]?.expected)}, got ${JSON.stringify(differences[0]?.actual)}.`,
    );
  }
  return finish(
    "applicable",
    "semantic-mismatch",
    differences
      .slice(0, 3)
      .map(
        (one) =>
          `${one.where}: expected ${JSON.stringify(one.expected)}, got ${JSON.stringify(one.actual)}`,
      )
      .join("; "),
  );
}

function main(argv: string[]): number {
  const cwd = process.cwd();
  const wanted = argv.filter((argument) => !argument.startsWith("--"));
  const selected = wanted.length > 0 ? wanted : SEMANTIC_CORPORA;
  const root = resolve(cwd, "evidence", "horizontal");
  let problems = 0;

  for (const corpus of selected) {
    const tasks = loadTasks(corpus, cwd);
    if (tasks.length === 0) {
      process.stdout.write(
        `${corpus.padEnd(16)} no materialised tasks. Run \`pnpm horizontal:materialise\`.\n`,
      );
      continue;
    }

    const results = tasks.map((task) => runTask(task, cwd));
    const counted = tally(corpus, tasks.length, results);
    const complete = checkTallyIsComplete(counted);
    problems += complete.length;

    const out = join(root, corpus);
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "environment.json"),
      `${JSON.stringify(describeEnvironment(cwd), null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(out, "results.json"),
      `${JSON.stringify(results, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(out, "summary.json"),
      `${JSON.stringify(counted, null, 2)}\n`,
      "utf8",
    );

    process.stdout.write(
      `${corpus.padEnd(16)} ${String(counted.discovered)} tasks | applicable ${String(counted.applicable)} | passed ${counted.passOfApplicable} of applicable, ${counted.passOfDiscovered} of all\n`,
    );
    process.stdout.write(
      `${" ".repeat(16)} unsupported by design ${String(counted.unsupportedByDesign)}, not yet implemented ${String(counted.unsupportedNotYetImplemented)}, not yet authored ${String(counted.notYetAuthored)}\n`,
    );
    for (const [outcome, count] of Object.entries(counted.failures).sort(
      (a, b) => b[1] - a[1],
    )) {
      process.stdout.write(
        `${" ".repeat(16)} ${outcome.padEnd(26)} ${String(count)}\n`,
      );
    }
    for (const line of complete) {
      process.stderr.write(`  ${line}\n`);
    }
  }
  return problems > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
