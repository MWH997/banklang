/**
 * Every artifact this repository ships or would ship, as text.
 *
 * Two linters read the same set for two different questions — will the
 * toolchain accept this (`tools/conformance-lint.ts`), and will z/OS do what
 * the program says (`tools/zos-lint.ts`) — and the set is collected once here
 * so that a lane cannot pass by reading fewer artifacts than the other.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

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
import { emitZunit } from "../packages/zunit/src/index";
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
    // A generated zUnit case is COBOL and JCL that ships to the same machine,
    // so it is held to the same rules. It reaches z/OS as a member of the same
    // library as the program it tests.
    if (ir.program.tests.length > 0) {
      const zunit = emitZunit(ir.program);
      artifacts.push({
        file: `${project}/(generated)/${zunit.moduleName}.cbl`,
        text: zunit.driver,
      });
      artifacts.push({
        file: `${project}/(generated)/${zunit.moduleName}.jcl`,
        text: zunit.jcl,
      });
    }
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
