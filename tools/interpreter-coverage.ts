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

export interface VerbCoverage {
  verb: string;
  /** How many emitted statements start with it, across every generated program. */
  emitted: number;
  interpreted: boolean;
  /** Which generated programs contain it, so a gap can be attributed. */
  artifacts: string[];
}

export interface CoverageReport {
  artifacts: number;
  verbs: VerbCoverage[];
  /** Emitted, not interpreted, ordered by how much COBOL depends on them. */
  gaps: VerbCoverage[];
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
        where.get(verb)?.add(artifact.file.split("/").pop() ?? artifact.file);
      }
    }
  }

  const verbs: VerbCoverage[] = [...counts]
    .map(([verb, emitted]) => ({
      verb,
      emitted,
      interpreted: interpreted.has(verb),
      artifacts: [...(where.get(verb) ?? [])].sort(),
    }))
    .sort((a, b) => b.emitted - a.emitted || a.verb.localeCompare(b.verb));

  return {
    artifacts: artifacts.length,
    verbs,
    gaps: verbs.filter((entry) => entry.emitted > 0 && !entry.interpreted),
    external: [...external].sort(),
  };
}

export function renderCoverage(report: CoverageReport): string {
  const emitted = report.verbs.filter((entry) => entry.emitted > 0);
  const covered = emitted.filter((entry) => entry.interpreted);
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
    "| | |",
    "| --- | --- |",
    `| verbs emitted | ${String(emitted.length)} |`,
    `| of those, interpreted | ${String(covered.length)} |`,
    `| differential blind spots | ${String(report.gaps.length)} |`,
    "",
    ...(report.gaps.length === 0
      ? ["Every verb the backend emits can be executed by both engines.", ""]
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
    "| Verb | Emitted | Interpreted |",
    "| --- | --- | --- |",
    ...emitted.map(
      (entry) =>
        `| \`${entry.verb}\` | ${String(entry.emitted)} | ${entry.interpreted ? "yes" : "**no**"} |`,
    ),
    "",
    "## Not executable locally",
    "",
    report.external.length === 0
      ? "_None emitted._"
      : `${report.external.map((name) => `\`${name}\``).join(", ")} — these need Db2, a CICS region or IMS. The reference modules under \`runtime/\` stand in well enough to run a program, and that is not the same as executing SQL. They are not counted as gaps because no interpreter change would close them.`,
    "",
  ].join("\n")}\n`;
}

function main(): number {
  const cwd = process.cwd();
  const report = measureCoverage(cwd);
  const out = resolve(cwd, "docs", "validation", "interpreter-coverage.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderCoverage(report), "utf8");
  process.stdout.write(
    `${String(report.artifacts)} artifacts | ${String(report.verbs.filter((entry) => entry.emitted > 0).length)} verbs emitted | ${String(report.gaps.length)} blind spots\n`,
  );
  for (const gap of report.gaps) {
    process.stdout.write(`  ${gap.verb.padEnd(12)} ${String(gap.emitted)}\n`);
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
