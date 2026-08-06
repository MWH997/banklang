/**
 * Run the conformance linter over everything this repository ships.
 *
 * Three sets of artifacts, for three different reasons.
 *
 * Fresh output, because that is what the compiler produces today. The checked-in
 * fixtures, because a golden file that holds a defect freezes it — the audit
 * found `IS-ELIGIBLE-FOR-INTEREST-RESULT`, a 31-character COBOL word, sitting in
 * `tests/fixtures/batch-interest-accrual.cbl`, where every run of the test suite
 * had compared it against itself and agreed. And the `evidence/` bundles,
 * because they are the artifacts a reader is invited to check the claims
 * against, and an evidence bundle that does not meet the rules is worse than no
 * evidence at all.
 *
 *   pnpm lint:conformance
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatFindings,
  lintArtifact,
  type ConformanceFinding,
} from "../packages/conformance-lint/src/index";
import {
  emitCobol,
  emitJcl,
  renderCopybook,
} from "../packages/cobol-backend/src/index";
import { loadConfig } from "../packages/config/src/index";
import { copybookMemberName } from "../packages/cobol-ir/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { exampleProjects } from "./example-projects";

/** Every generated artifact, by where it came from. */
export interface LintableArtifact {
  /** Path used in findings, relative to the repository root. */
  file: string;
  text: string;
}

/**
 * What the compiler produces right now, for every example.
 *
 * Emitted rather than read off disk: `dist/` is whatever the last command
 * happened to write, and a lane that lints stale output reports on a compiler
 * that no longer exists.
 */
export function freshArtifacts(cwd = process.cwd()): LintableArtifact[] {
  const artifacts: LintableArtifact[] = [];

  for (const project of exampleProjects(cwd)) {
    const sourceFile = resolve(cwd, project, "src/main.bank.ts");
    const parsed = parseBankTs(readFileSync(sourceFile, "utf8"), sourceFile);
    if (!parsed.program) {
      throw new Error(`${project} did not parse.`);
    }
    const typechecked = typecheckProgram(parsed.program);
    const ir = lowerProgramToIR(typechecked);
    if (!ir.program) {
      throw new Error(`${project} did not lower.`);
    }

    const copybookMode = loadConfig(project, cwd).config.copybookMode;
    const name = project.replace("examples/", "");
    artifacts.push({
      file: `${project}/(generated).cbl`,
      text: emitCobol(ir.program, { copybookMode }).cobol,
    });
    artifacts.push({
      file: `${project}/(generated).jcl`,
      text: emitJcl(ir.program, {
        usesCopybooks: copybookMode === "copy",
      }).jcl,
    });
    // Both forms of the job, because a site that has no IGYWCL installed
    // submits the expanded one and it is held to the same rules.
    artifacts.push({
      file: `${project}/(generated-expanded).jcl`,
      text: emitJcl(ir.program, {
        usesCopybooks: copybookMode === "copy",
        mode: "expanded",
      }).jcl,
    });
    for (const record of ir.program.records) {
      artifacts.push({
        file: `${project}/(generated)/${copybookMemberName(record.name)}.cpy`,
        text: renderCopybook(record),
      });
    }
    void name;
  }

  return artifacts;
}

/** Artifacts checked into the repository: the fixtures and the evidence. */
export function checkedInArtifacts(cwd = process.cwd()): LintableArtifact[] {
  return [
    ...collectArtifacts(resolve(cwd, "tests/fixtures"), cwd),
    ...collectArtifacts(resolve(cwd, "evidence"), cwd),
  ];
}

/** The programs a generated `CALL` may name, which is what `runtime/` holds. */
export function runtimePrograms(cwd = process.cwd()): string[] {
  return readdirSync(resolve(cwd, "runtime"))
    .filter((entry) => entry.endsWith(".cbl"))
    .map((entry) => entry.replace(/\.cbl$/, ""));
}

export function lintAll(cwd = process.cwd()): ConformanceFinding[] {
  const knownPrograms = runtimePrograms(cwd);
  return [...freshArtifacts(cwd), ...checkedInArtifacts(cwd)].flatMap(
    (artifact) => lintArtifact(artifact.file, artifact.text, { knownPrograms }),
  );
}

function collectArtifacts(root: string, cwd: string): LintableArtifact[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const artifacts: LintableArtifact[] = [];
  for (const entry of entries.sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      artifacts.push(...collectArtifacts(path, cwd));
      continue;
    }
    if ([".cbl", ".cpy", ".jcl"].includes(extname(entry))) {
      artifacts.push({
        file: relative(cwd, path),
        text: readFileSync(path, "utf8"),
      });
    }
  }
  return artifacts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const findings = lintAll(process.cwd());
  process.stdout.write(formatFindings(findings));
  if (findings.length > 0) {
    const counts = new Map<string, number>();
    for (const finding of findings) {
      counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
    }
    process.stdout.write(
      `\n${findings.length} findings: ${[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([rule, count]) => `${rule} ${count}`)
        .join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}
