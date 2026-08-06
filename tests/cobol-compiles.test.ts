import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";

import { compileExample, loadExampleSource, localCobol } from "./helpers";
import { exampleProjects } from "../tools/example-projects";

/**
 * Every checked-in example must produce COBOL that a real compiler accepts.
 *
 * This lane exists because a `GOBACK.` emitted inside an `IF` branch made the
 * batch-interest-accrual output uncompilable for several releases: the local
 * GnuCOBOL check only ever compiled the account-transfer example, so nothing
 * covered the others.
 */
const EXAMPLES = exampleProjects();

function cobcAvailable(): boolean {
  return spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
}

describe("generated COBOL compiles", () => {
  it("discovers every checked-in example", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
  });

  for (const example of EXAMPLES) {
    it.skipIf(!cobcAvailable())(`compiles ${example} with cobc`, () => {
      // Embedded SQL and CICS need a precompiler that is not on this machine,
      // so plain cobc cannot check them; the local `precompile` step covers
      // what it can and those two are skipped here. MQ and Report Writer are
      // not skipped: `precompile` substitutes local declarations for the queue
      // manager's copybooks, and GnuCOBOL implements Report Writer, so both
      // compile locally and a program that stops compiling should say so.
      const requirements = compile(
        loadExampleSource(example),
      ).backendRequirements;
      const needsPrecompiler = requirements.some(
        (requirement) =>
          requirement === "db2-precompiler" ||
          requirement === "cics-translator",
      );
      if (needsPrecompiler) {
        return;
      }

      const { emit } = compileExample(example);
      const dir = mkdtempSync(join(tmpdir(), "bankc-cobc-"));
      const file = join(dir, "program.cbl");
      writeFileSync(file, localCobol(emit.cobol), "utf8");

      const result = spawnSync("cobc", ["-fsyntax-only", "-fixed", file], {
        encoding: "utf8",
      });

      expect(result.status, `cobc rejected ${example}:\n${result.stderr}`).toBe(
        0,
      );
      expect(result.stderr).not.toContain("error:");
    });
  }
});
