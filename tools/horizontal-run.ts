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
  allocateDdNames,
  blockerFor,
  type Authoring,
  type Execution,
  checkTallyIsComplete,
  classifyTask,
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
import { runtimePrograms } from "./generated-artifacts";
import { compile } from "../packages/compiler/src/index";
import { hasCobc, runConformance, ConformanceError } from "./conformance";
import {
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "./interpret";
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

/** What put a task outside the applicable set, from the recorded blockers. */
function describeBlocker(task: string): string | null {
  const blocker = blockerFor(task);
  return blocker
    ? `${blocker.kind}: ${blocker.reason} Evidence: ${blocker.evidence}`
    : null;
}

/**
 * The DD names a task's files are seeded under.
 *
 * Allocated for the whole set at once rather than name by name, because
 * uniqueness is a property of the set. See
 * `packages/horizontal-validation/src/dd-names.ts` for why that matters: the
 * per-name version collapsed every file of nineteen tasks onto `TASKFUNC`.
 *
 * A task's BankTS declares files whose own DD names, derived by the backend
 * from the BankTS file name, must match what this returns. The mapping is
 * printed by `pnpm horizontal:dd <task>` so an implementation can be written
 * against it without anybody guessing.
 */
export function taskDdNames(task: {
  spec: {
    inputs: Record<string, string>;
    expectedOutputs: Record<string, string>;
  };
}): Map<string, string> {
  return allocateDdNames([
    ...Object.keys(task.spec.inputs),
    ...Object.keys(task.spec.expectedOutputs),
  ]);
}

/**
 * One task, taken as far as it gets.
 *
 * Every early return records the stage that stopped it. The order matters: a
 * task that fails `bankc check` is never reported as a semantic mismatch, and a
 * task whose oracle cannot be derived is still compiled and run, since the run is
 * what proves the BankTS was real, before the comparison is recorded as
 * unmatchable.
 */
export function runTask(task: LoadedTask, cwd: string): TaskResult {
  const started = Date.now();
  /*
   * Applicability first, and from the task alone.
   *
   * It used to be decided by whether `main.bank.ts` existed, which made the
   * word mean "already done" and `pass / applicable` a rate that could only
   * ever be 100%. Now it is a property of the task, an implementation is a
   * separate axis, and a task in neither the applicable set nor the authored
   * set has a recorded reason rather than a shrug.
   */
  const blocker = blockerFor(task.spec.upstreamId);
  const verdict = classifyTask(task.spec.specification, blocker?.kind ?? null);
  const authoring: Authoring =
    task.implementation !== null ? "authored" : "unauthored";

  const base = {
    taskId: task.spec.id,
    corpus: task.spec.corpus,
    applicability: verdict.applicability,
    authoring,
    diagnostics: [] as string[],
    artifactHashes: {} as Record<string, string>,
    differentialAgreement: null as boolean | null,
  };
  const finish = (
    execution: Execution,
    outcome: Outcome,
    detail: string | null,
    extra: Partial<TaskResult> = {},
  ): TaskResult => ({
    ...base,
    execution,
    outcome,
    detail,
    durationMs: Date.now() - started,
    ...extra,
  });

  /*
   * An implementation is run whatever its applicability says.
   *
   * A task classified `benchmark-ambiguous` still compiles and still executes,
   * and that is the point: task_func_55's classification rests on both engines
   * agreeing on every record and the expected file's last line carrying a
   * character the input cannot produce. Skipping it would turn reproducible
   * evidence back into an assertion.
   */
  if (task.implementation === null) {
    return finish(
      "not-executed",
      "not-executed",
      verdict.unsupported
        ? `${verdict.unsupported.construct}: ${verdict.unsupported.reason}`
        : describeBlocker(task.spec.upstreamId),
    );
  }

  const source = readFileSync(task.implementation, "utf8");
  const sourceFile = relative(cwd, task.implementation);

  // ---- check ---------------------------------------------------------
  const compiled = compile(source, { sourceFile });
  base.diagnostics = compiled.diagnostics.map((diagnostic) => diagnostic.id);
  if (!compiled.ok || !compiled.cobol) {
    return finish(
      "not-executed",
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
      "not-executed",
      "determinism-failure",
      "Two compilations of identical input produced different COBOL.",
    );
  }

  // ---- conformance ---------------------------------------------------
  // With `knownPrograms`, exactly as `pnpm lint:conformance` runs it. Without
  // it every generated program fails `call-resolvable` on its own `CALL
  // "BANKAUDT"`. The audit module is part of the reference runtime and is
  // supplied to the binder, not missing.
  const findings = lintCobol(sourceFile, compiled.cobol, {
    knownPrograms: runtimePrograms(cwd),
  });
  if (findings.length > 0) {
    return finish(
      "not-executed",
      "conformance-failure",
      findings
        .slice(0, 3)
        .map((finding) => `${finding.rule}: ${finding.message}`)
        .join("; "),
    );
  }

  if (!hasCobc()) {
    return finish(
      "not-executed",
      "infrastructure-failure",
      "cobc is not on the path, so nothing was executed. A skipped run is unchecked, not passing.",
    );
  }

  // ---- execute, both ways --------------------------------------------
  const workDir = join(
    tmpdir(),
    `banklang-horizontal-${task.spec.corpus}-${task.slug}`,
  );
  const ddNames = taskDdNames(task);
  const dd = (name: string): string => ddNames.get(name) ?? name;
  const inputs = Object.fromEntries(
    Object.entries(task.spec.inputs).map(([name, content]) => [
      dd(name),
      Buffer.from(content, "utf8"),
    ]),
  );
  const outputs = Object.keys(task.spec.expectedOutputs).map(dd);

  /*
   * A program entered with a parameter list needs something to build one.
   *
   * A BankTS entry transaction takes its scalar parameters from the job's PARM,
   * so it has `PROCEDURE DIVISION USING`, and `cobc -x` refuses to make an
   * executable out of one, because a Unix process has no parameter list. On
   * z/OS the initiator builds it; here the driver does, exactly as the
   * differential lane already does for the examples.
   *
   * The key is the same for every task and every run, which is what makes the
   * output reproducible: an idempotency key that changed per run would change
   * the audit record and the evidence with it.
   */
  let interpreterRefusal: string | null = null;
  const emitted = compiled.cobol;
  const driver = takesParm(emitted)
    ? parmDriver(programNameOf(emitted), "HORIZONTAL".padEnd(36, "0"))
    : undefined;

  let compiledRun;
  try {
    compiledRun = runConformance({
      source,
      sourceFile,
      workDir,
      inputs,
      outputs,
      driver,
    });
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    return finish(
      "not-executed",
      error instanceof ConformanceError
        ? "cobol-compile-failure"
        : "runtime-failure",
      error instanceof Error ? error.message.slice(0, 600) : String(error),
    );
  }

  let interpretedRun: ReturnType<typeof runInterpreted> | null = null;

  /*
   * Which engines got as far as running, which is not the same as whether the
   * task passed. `gnucobol-only` is never reported as a differential result.
   */
  const engines = (): Execution =>
    interpretedRun ? "both-engines" : "gnucobol-only";

  try {
    interpretedRun = runInterpreted({
      source,
      sourceFile,
      workDir,
      inputs,
      outputs,
      driver,
    });
  } catch (error) {
    // The construct the interpreter refused, kept rather than swallowed: it is
    // the next thing worth building, and `pnpm interpreter:coverage` cannot see
    // it because it counts verbs and this may be a phrase or an intrinsic.
    interpretedRun = null;
    base.differentialAgreement = null;
    interpreterRefusal = error instanceof Error ? error.message : String(error);
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
        engines(),
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
    expectedOutputs: Object.fromEntries(
      Object.entries(task.spec.expectedOutputs).map(([name, content]) => [
        dd(name),
        content,
      ]),
    ),
    expectedStdout: task.spec.expectedStdout,
    expectedExitCode: task.spec.expectedExitCode,
  });
  rmSync(workDir, { recursive: true, force: true });

  if (differences.length === 0) {
    return finish(engines(), "pass", interpreterRefusal);
  }
  if (!oracle.derivable) {
    return finish(
      engines(),
      "oracle-not-derivable",
      `The expected output contains ${JSON.stringify(oracle.invented.slice(0, 5))}, which appears in neither the specification nor the input data, so no spec-only implementation could match it. First difference at ${differences[0]?.where}: expected ${JSON.stringify(differences[0]?.expected)}, got ${JSON.stringify(differences[0]?.actual)}.`,
    );
  }
  return finish(
    engines(),
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
    /*
     * Without `durationMs`, which is how long the machine took rather than
     * anything about the compiler.
     *
     * This file is committed evidence and the workflow fails on a diff in it,
     * so a field that changes on every run would report the corpus as stale
     * every time and train everybody to ignore the check. `runTask` still
     * measures it for the console; what is recorded is the result.
     */
    writeFileSync(
      join(out, "results.json"),
      `${JSON.stringify(
        results.map(({ durationMs: _durationMs, ...rest }) => rest),
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      join(out, "summary.json"),
      `${JSON.stringify(counted, null, 2)}\n`,
      "utf8",
    );

    process.stdout.write(
      `${corpus.padEnd(16)} ${String(counted.discovered)} tasks | applicable ${String(counted.applicable)}, by design ${String(counted.unsupportedByDesign)}, not yet implemented ${String(counted.unsupportedNotYetImplemented)}, ambiguous ${String(counted.benchmarkAmbiguous)}\n`,
    );
    process.stdout.write(
      `${" ".repeat(16)} authored ${counted.authoringCoverage} of applicable | passed ${counted.passOfAuthored} of authored, ${counted.passOfDiscovered} of all\n`,
    );
    process.stdout.write(
      `${" ".repeat(16)} both engines ${String(counted.bothEngines)}, agreed ${String(counted.agreements)}, diverged ${String(counted.divergences)}, interpreter unavailable ${String(counted.interpreterUnavailable)}\n`,
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
