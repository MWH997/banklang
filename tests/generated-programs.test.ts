import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  formatFindings,
  lintCobol,
  lintJcl,
} from "../packages/conformance-lint/src/index";
import { generatePrograms } from "../tools/generate-programs";
import { runtimePrograms } from "../tools/generated-artifacts";
import { localCobol } from "./helpers";

/**
 * Random valid programs, held to the target's rules.
 *
 * Every hand-written fixture is a shape somebody thought of, and the finding
 * that mattered most, a COBOL word one character over the limit, lived in a
 * shape nobody had: every fixture used short names.
 * A generator does not know what anyone had in mind, so it reaches corners a
 * curated suite does not.
 *
 * Three properties, in the order they would fail:
 *
 * 1. The program compiles with no errors. It is generated to, so a failure here
 *    is the generator's or the compiler's, and either is worth knowing.
 * 2. The emitted COBOL and JCL pass the conformance linter, which reads them
 *    as text and knows nothing about how they were produced. That independence
 *    is the point: a checker written from the same belief as the emitter agrees
 *    with the emitter, including where the emitter is wrong.
 * 3. `cobc` accepts the COBOL under `tools/banklang-ibm.conf`.
 *
 * Deterministic: the seed is the program, and a failure names it.
 */

const SEEDS = 60;
const PROGRAMS = generatePrograms(SEEDS);

const RUNTIME = runtimePrograms(process.cwd());

const cobcAvailable =
  spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

describe("generated programs", () => {
  it("generates the batch it says it does", () => {
    expect(PROGRAMS).toHaveLength(SEEDS);
    expect(new Set(PROGRAMS.map((entry) => entry.source)).size).toBe(SEEDS);
  });

  for (const { seed, source } of PROGRAMS) {
    describe(`seed ${seed}`, () => {
      const result = compile(source);

      it("compiles with no errors", () => {
        const errors = result.diagnostics.filter(
          (entry) => entry.severity === "error",
        );
        expect(
          errors.map((entry) => `${entry.id}: ${entry.message}`),
          source,
        ).toEqual([]);
      });

      it("emits COBOL the target's rules accept", () => {
        // `BANKLEDG` and `BANKAUDT` are supplied to the binder, which the
        // linter has to be told: it reads one artifact and cannot know what
        // the link-edit step's SYSLIB holds.
        const findings = lintCobol(`seed-${seed}.cbl`, result.cobol ?? "", {
          knownPrograms: RUNTIME,
        });
        expect(formatFindings(findings), source).toBe(
          "No conformance findings.\n",
        );
      });

      it("emits JCL the target's rules accept", () => {
        const findings = lintJcl(`seed-${seed}.jcl`, result.jcl ?? "");
        expect(formatFindings(findings), source).toBe(
          "No conformance findings.\n",
        );
      });

      it.skipIf(!cobcAvailable)("compiles under cobc", () => {
        const directory = mkdtempSync(join(tmpdir(), "bankc-generated-"));
        const file = join(directory, "program.cbl");
        writeFileSync(file, localCobol(result.cobol), "utf8");

        const run = spawnSync(
          "cobc",
          ["-fsyntax-only", "-fixed", "-conf=tools/banklang-ibm.conf", file],
          { encoding: "utf8" },
        );

        expect(run.stderr, `seed ${seed}:\n${source}`).not.toContain("error:");
        expect(run.status, `seed ${seed}:\n${source}`).toBe(0);
      });
    });
  }
});
