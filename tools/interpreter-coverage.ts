/**
 * What the backend emits, against what the interpreter can execute.
 *
 *   pnpm interpreter:coverage
 *
 * `packages/cobol-runtime` is the second implementation of this project's
 * semantics, and every differential result depends on it understanding the
 * program it is handed. When it does not, the comparison silently does not
 * happen — which is how `task_func_02` came to pass under `cobc` with no
 * differential result at all: the interpreter had no `UNSTRING`, refused the
 * statement, and the harness recorded `differentialAgreement: null`.
 *
 * A null is easy to miss in a run that says four passed. So this measures the
 * gap directly: every COBOL verb this compiler emits, against every verb the
 * interpreter's parser dispatches, over the artifacts the repository actually
 * ships. A verb in the first list and not the second is a differential blind
 * spot, and the largest one is the next thing worth building.
 *
 * Measured rather than listed. The emitted side is every example compiled
 * fresh, so a verb the backend stops emitting drops out on its own; the
 * interpreter side is read from the parser's own dispatch, so a verb it gains
 * appears without anybody updating a table.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compile } from "../packages/compiler/src/index";
import { sourceLines } from "../packages/migration-analysis/src/features";
import { freshArtifacts } from "./generated-artifacts";

/**
 * COBOL verbs, as they appear at the start of a statement.
 *
 * Deliberately a list rather than a parse: this counts what a reader would call
 * a statement, and a full parse of the emitted COBOL would be a third
 * implementation of the language to maintain.
 */
const VERBS = [
  "ACCEPT",
  "ADD",
  "ALTER",
  "CALL",
  "CANCEL",
  "CLOSE",
  "COMPUTE",
  "CONTINUE",
  "DELETE",
  "DISPLAY",
  "DIVIDE",
  "ENTRY",
  "EVALUATE",
  "EXIT",
  "GENERATE",
  "GOBACK",
  "IF",
  "INITIALIZE",
  "INITIATE",
  "INSPECT",
  "MERGE",
  "MOVE",
  "MULTIPLY",
  "OPEN",
  "PERFORM",
  "READ",
  "RELEASE",
  "RETURN",
  "REWRITE",
  "SEARCH",
  "SET",
  "SORT",
  "START",
  "STOP",
  "STRING",
  "SUBTRACT",
  "TERMINATE",
  "UNSTRING",
  "WRITE",
] as const;

/**
 * Constructs that are not executable here whatever the interpreter does.
 *
 * `EXEC SQL` needs Db2, `EXEC CICS` needs a region. The reference modules under
 * `runtime/` stand in for them well enough to run a program, and pretending
 * that amounts to executing SQL would overstate what the differential lane
 * establishes. They are reported as their own category rather than as gaps.
 */
const EXTERNAL = new Set(["EXEC SQL", "EXEC CICS", "EXEC DLI"]);

/**
 * Verbs no local execution would reach, whatever the interpreter implements.
 *
 * The distinction this file exists to draw is between a verb the interpreter is
 * *missing* and a verb that has nowhere local to run. Eight blind spots read as
 * eight things to build; four of them were `SORT`, `MERGE`, `RELEASE` and
 * `RETURN`, and the other four are these — one driven by a runner that is not
 * on this machine, three expanded by a precompiler this repository does not
 * ship. Counting them together made the real gap look half the size it was.
 *
 * A reason rather than a bare list, because an exemption nobody re-reads
 * becomes a permanent hole. `tests/interpreter-coverage.test.ts` holds each one
 * to a program the repository already records as not locally runnable, so an
 * exemption cannot outlive the thing it excuses.
 */
const EXEMPT: Record<string, string> = {
  ENTRY:
    "an alternate entry point in a generated zUnit test case. It is called by IBM's zUnit runner, which is not on this machine, and never by a job step.",
  INITIATE:
    "Report Writer, expanded by IBM's Report Writer precompiler. `packages/cobol-runtime` refuses a REPORT SECTION by name rather than implementing page fitting, control breaks and sum counters a second time.",
  GENERATE: "Report Writer, as INITIATE.",
  TERMINATE: "Report Writer, as INITIATE.",
};

export interface VerbCoverage {
  verb: string;
  /** How many emitted statements start with it, across every generated program. */
  emitted: number;
  interpreted: boolean;
  /** Why no local run reaches it, or null when one could. */
  exempt: string | null;
  /** Which generated programs contain it, so a gap can be attributed. */
  artifacts: string[];
}

export interface CoverageReport {
  artifacts: number;
  verbs: VerbCoverage[];
  /** Emitted and reachable by a local run: the denominator that matters. */
  local: VerbCoverage[];
  /** Emitted, not interpreted, not exempt — ordered by how much COBOL uses them. */
  gaps: VerbCoverage[];
  /** Emitted, and outside local execution for a recorded reason. */
  exempt: VerbCoverage[];
  external: string[];
}

/** Verbs the interpreter's parser dispatches on, read from its own source. */
export function interpretedVerbs(cwd = process.cwd()): Set<string> {
  const source = readFileSync(
    resolve(cwd, "packages/cobol-runtime/src/statements.ts"),
    "utf8",
  );
  const dispatch =
    /private statement\(\)[\s\S]*?\n {2}\}/.exec(source)?.[0] ?? "";
  return new Set(
    [...dispatch.matchAll(/case "([A-Z-]+)"/g)].map(
      (match) => match[1] as string,
    ),
  );
}

/**
 * Every generated program, compiled fresh from the examples and the benchmarks.
 *
 * `freshArtifacts` rather than reading `evidence/`, which holds a bundle for
 * only some examples: measuring there reported zero blind spots while the
 * report-writer and sort programs — the ones emitting `INITIATE`, `GENERATE`,
 * `RELEASE` and `RETURN` — were not in the sample at all. This is the same
 * enumeration `pnpm lint:conformance` uses, so the two cannot disagree about
 * what the compiler produces.
 *
 * The benchmark implementations are in the sample too, and adding them was a
 * finding rather than a tidy-up. `SORT` and `MERGE` appear in no example, so
 * the matrix reported four blind spots while two CobolCodeBench tasks passed
 * under `cobc` with no differential result at all — the thing this file was
 * built to make impossible. Coverage measured over a body of code that happens
 * to avoid the gap is not coverage.
 */
function emittedArtifacts(cwd: string): { file: string; text: string }[] {
  const artifacts = freshArtifacts(cwd).map((artifact) => ({
    file: artifact.file,
    text: artifact.text,
  }));

  const root = resolve(cwd, "validation", "tasks");
  if (!existsSync(root)) {
    return artifacts;
  }
  for (const corpus of readdirSync(root).sort()) {
    const corpusRoot = join(root, corpus);
    if (!statSync(corpusRoot).isDirectory()) {
      continue;
    }
    for (const slug of readdirSync(corpusRoot).sort()) {
      const source = join(corpusRoot, slug, "main.bank.ts");
      if (!existsSync(source)) {
        continue;
      }
      const cobol = compile(readFileSync(source, "utf8"), {
        sourceFile: `${slug}.bank.ts`,
      }).cobol;
      if (cobol) {
        artifacts.push({ file: `${corpus}/${slug}.cbl`, text: cobol });
      }
    }
  }
  return artifacts;
}

/**
 * What to call an artifact when attributing a verb to it.
 *
 * The basename alone is not enough: every example's main program is
 * `(generated).cbl`, so a blind spot in one of them was reported as being in
 * `(generated).cbl` and could not be traced to a project. The project directory
 * is what a reader needs, and it is what the exemption check compares against.
 */
function artifactName(file: string): string {
  const parts = file.split("/");
  const base = parts[parts.length - 1] ?? file;
  if (!base.startsWith("(generated)")) {
    return `${parts[parts.length - 2] ?? ""}/${base}`.replace(/^\//, "");
  }
  return parts.slice(0, -1).join("/");
}

export function measureCoverage(cwd = process.cwd()): CoverageReport {
  const interpreted = interpretedVerbs(cwd);
  const counts = new Map<string, number>(VERBS.map((verb) => [verb, 0]));
  const where = new Map<string, Set<string>>(
    VERBS.map((verb) => [verb, new Set<string>()]),
  );
  const external = new Set<string>();
  const artifacts = emittedArtifacts(cwd);

  for (const artifact of artifacts) {
    for (const line of sourceLines(artifact.text)) {
      const trimmed = line.trim();
      for (const marker of EXTERNAL) {
        if (trimmed.startsWith(marker)) {
          external.add(marker);
        }
      }
      const verb = /^([A-Z-]+)\b/.exec(trimmed)?.[1];
      if (verb && counts.has(verb)) {
        counts.set(verb, (counts.get(verb) ?? 0) + 1);
        where.get(verb)?.add(artifactName(artifact.file));
      }
    }
  }

  const verbs: VerbCoverage[] = [...counts]
    .map(([verb, emitted]) => ({
      verb,
      emitted,
      interpreted: interpreted.has(verb),
      exempt: EXEMPT[verb] ?? null,
      artifacts: [...(where.get(verb) ?? [])].sort(),
    }))
    .sort((a, b) => b.emitted - a.emitted || a.verb.localeCompare(b.verb));

  const emitted = verbs.filter((entry) => entry.emitted > 0);
  const local = emitted.filter((entry) => entry.exempt === null);
  return {
    artifacts: artifacts.length,
    verbs,
    local,
    gaps: local.filter((entry) => !entry.interpreted),
    exempt: emitted.filter((entry) => entry.exempt !== null),
    external: [...external].sort(),
  };
}

export function renderCoverage(report: CoverageReport): string {
  const emitted = report.verbs.filter((entry) => entry.emitted > 0);
  const covered = report.local.filter((entry) => entry.interpreted);
  return `${[
    "# Interpreter coverage",
    "",
    "<!-- Generated by `pnpm interpreter:coverage`. Do not edit. -->",
    "",
    "What `packages/cobol-backend` emits, against what",
    "`packages/cobol-runtime` can execute. A verb in the first and not the",
    "second is a differential blind spot: the compiled side runs, the",
    "interpreted side refuses, and the comparison that gives this project's",
    "green its meaning does not happen.",
    "",
    `Measured over the ${String(report.artifacts)} programs the compiler produces from the examples and the benchmark tasks.`,
    "",
    "The denominator is **locally executable** emitted verbs, not all of them.",
    "A verb whose only home is a zUnit test case or a Report Writer section has",
    "nowhere local to run whatever the interpreter implements, and counting it",
    "as a gap made the real one look half its size: of eight blind spots",
    "reported before `SORT` and `MERGE` were built, four were those two and",
    "their `RELEASE` and `RETURN`, and four were exempt. Each exemption carries",
    "its reason below and is held to a named program by",
    "`tests/interpreter-coverage.test.ts`.",
    "",
    "| | |",
    "| --- | --- |",
    `| verbs emitted | ${String(emitted.length)} |`,
    `| of those, locally executable | ${String(report.local.length)} |`,
    `| of those, interpreted | ${String(covered.length)} |`,
    `| differential blind spots | ${String(report.gaps.length)} |`,
    `| exempt, with a recorded reason | ${String(report.exempt.length)} |`,
    "",
    ...(report.gaps.length === 0
      ? [
          "Every locally executable verb the backend emits can be executed by both engines.",
          "",
        ]
      : [
          "## Blind spots, by how much emitted COBOL uses them",
          "",
          "| Verb | Emitted statements | In |",
          "| --- | --- | --- |",
          ...report.gaps.map(
            (gap) =>
              `| \`${gap.verb}\` | ${String(gap.emitted)} | ${gap.artifacts.join(", ")} |`,
          ),
          "",
        ]),
    "## Every emitted verb",
    "",
    "| Verb | Emitted | Locally executable | Interpreted |",
    "| --- | --- | --- | --- |",
    ...emitted.map(
      (entry) =>
        `| \`${entry.verb}\` | ${String(entry.emitted)} | ${entry.exempt ? "no" : "yes"} | ${entry.interpreted ? "yes" : entry.exempt ? "n/a" : "**no**"} |`,
    ),
    "",
    "## Emitted, and outside local execution",
    "",
    ...(report.exempt.length === 0
      ? ["_None._", ""]
      : [
          "| Verb | In | Why no local run reaches it |",
          "| --- | --- | --- |",
          ...report.exempt.map(
            (entry) =>
              `| \`${entry.verb}\` | ${entry.artifacts.join(", ")} | ${entry.exempt ?? ""} |`,
          ),
          "",
        ]),
    "## Not executable locally, as whole statements",
    "",
    report.external.length === 0
      ? "_None emitted._"
      : `${report.external.map((name) => `\`${name}\``).join(", ")} — these need Db2, a CICS region or IMS. The reference modules under \`runtime/\` stand in well enough to run a program, and that is not the same as executing SQL. They are not counted as gaps because no interpreter change would close them.`,
    "",
  ].join("\n")}\n`;
}

/**
 * The gate's verdict, apart from the run that produces it.
 *
 * Exported so a test can hold it: `main` writes a file and prints, which a
 * test must not do, and the one line that decides whether a build goes red is
 * the line most worth pinning. Mutating `=== 0` to `!== 0` here turns the gate
 * into its own opposite — green on every blind spot, red on none — and nothing
 * in this repository noticed.
 */
export function exitCodeFor(report: CoverageReport): number {
  return report.gaps.length === 0 ? 0 : 1;
}

function main(): number {
  const cwd = process.cwd();
  const report = measureCoverage(cwd);
  const out = resolve(cwd, "docs", "validation", "interpreter-coverage.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderCoverage(report), "utf8");
  process.stdout.write(
    `${String(report.artifacts)} artifacts | ${String(report.verbs.filter((entry) => entry.emitted > 0).length)} verbs emitted | ${String(report.local.length)} locally executable | ${String(report.gaps.length)} blind spots | ${String(report.exempt.length)} exempt\n`,
  );
  for (const gap of report.gaps) {
    process.stdout.write(`  ${gap.verb.padEnd(12)} ${String(gap.emitted)}\n`);
  }
  // Non-zero on a blind spot, so this is a gate and not a readout. A backend
  // that starts emitting a locally executable verb the runtime cannot execute
  // has reopened the hole this file was built to keep shut.
  return exitCodeFor(report);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
