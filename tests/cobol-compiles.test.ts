import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compileExample } from "./helpers";

/**
 * Every checked-in example must produce COBOL that a real compiler accepts.
 *
 * This lane exists because a `GOBACK.` emitted inside an `IF` branch made the
 * batch-interest-accrual output uncompilable for several releases: the local
 * GnuCOBOL check only ever compiled the account-transfer example, so nothing
 * covered the others.
 */
const EXAMPLES = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `examples/${entry.name}`)
  .sort();

function cobcAvailable(): boolean {
  return spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
}

describe("generated COBOL compiles", () => {
  it("discovers every checked-in example", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(4);
  });

  for (const example of EXAMPLES) {
    it.skipIf(!cobcAvailable())(`compiles ${example} with cobc`, () => {
      const { emit } = compileExample(example);
      const dir = mkdtempSync(join(tmpdir(), "bankc-cobc-"));
      const file = join(dir, "program.cbl");
      writeFileSync(file, emit.cobol, "utf8");

      const result = spawnSync("cobc", ["-fsyntax-only", "-free", file], {
        encoding: "utf8",
      });

      expect(result.status, `cobc rejected ${example}:\n${result.stderr}`).toBe(
        0,
      );
      expect(result.stderr).not.toContain("error:");
    });
  }
});
