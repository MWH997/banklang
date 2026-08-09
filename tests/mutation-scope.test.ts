import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Each mutation lane names its test files. They have to be real files.
 *
 * A lane runs an allowlist, for a stated and good reason: "does this test read
 * generated COBOL?" has a short, stable answer, and a blocklist grows a hole
 * every time a suite is added. The allowlist's own failure is quieter — an
 * entry that stops matching costs nothing visible. A renamed or deleted suite
 * drops out of the lane, the run still finishes, the score falls a little, and
 * nothing says why.
 *
 * **What this deliberately does not check.** The first version of this file
 * asserted that any suite importing a mutated package must be in that package's
 * lane. It flagged nineteen — `transactions`, `type-system`, `numeric`,
 * `jcl` — which import the emitter to compile a program and then assert about
 * semantics. Running them in the formatting lane would cost a full run each and
 * kill nothing, which is what `vitest.mutation-emitter.config.ts` says in its
 * own header. "Imports the package" is not a proxy for "can kill a mutant
 * there", and no static rule is: the honest check is whether the score moves,
 * and `tools/mutation-floor.ts` is that check.
 *
 * The reason this file exists at all: `tests/cobol-ir-names.test.ts` was written
 * to kill mutants in `packages/cobol-ir/src/index.ts`, passed 21 assertions in
 * CI, and moved that file's score by **-0.10** — because the lane never loaded
 * it. Adding it took the file from 44.12% to 80.38%. Nothing failed in between.
 */

const LANES = [
  "vitest.mutation-emitter.config.ts",
  "vitest.mutation.config.ts",
  "vitest.mutation-lint.config.ts",
  // The backend, runtime and tools lanes share this one.
  "vitest.mutation-broad.config.ts",
] as const;

/** Every Stryker lane, so a new one cannot arrive without its runner wiring. */
const STRYKER = [
  "stryker.config.json",
  "stryker.emitter.config.json",
  "stryker.lint.config.json",
  "stryker.backend.config.json",
  "stryker.runtime.config.json",
  "stryker.tools.config.json",
  "stryker.safety.config.json",
] as const;

/**
 * Every test file a lane's config names, whether it names them to run or to
 * skip.
 *
 * The lanes are two shapes: the emitter and lint lanes use `include`, the rules
 * lane uses `exclude`. Both go stale the same way — a renamed suite silently
 * drops out of an allowlist, and silently rejoins a blocklist — so both lists
 * are checked, and neither shape is assumed.
 */
function namedTests(config: string): string[] {
  const source = readFileSync(config, "utf8");
  return [...source.matchAll(/"(tests\/[^"]+\.test\.ts)"/g)].map(
    (match) => match[1]!,
  );
}

describe("every mutation lane", () => {
  for (const config of LANES) {
    it(`exists: ${config}`, () => {
      expect(existsSync(config), `${config} is missing`).toBe(true);
    });

    it(`names only test files that are there: ${config}`, () => {
      const named = namedTests(config);
      expect(named.filter((path) => !existsSync(path))).toEqual([]);
    });

    it(`names each suite once: ${config}`, () => {
      const named = namedTests(config);
      const duplicated = named.filter(
        (path, index) => named.indexOf(path) !== index,
      );
      expect(duplicated).toEqual([]);
    });
  }

  /**
   * The suite written for `cobol-ir` is in the lane that mutates it.
   *
   * Named rather than derived, because deriving it is the check that does not
   * work. This one is a fact about a specific file and the reason it was
   * written, and it is the fact that was wrong.
   */
  it("runs the suite written to cover cobol-ir's names and pictures", () => {
    expect(namedTests("vitest.mutation-emitter.config.ts")).toContain(
      "tests/cobol-ir-names.test.ts",
    );
  });
});

/**
 * A lane that cannot start is a lane that reports nothing.
 *
 * The three lanes added on 2026-08-08 were written from the shape of an
 * existing config and left out `plugins`. Stryker exited with "Cannot find
 * TestRunner plugin vitest" — before running a single mutant, and with no
 * score to be below any threshold. In the scheduled workflow that is a red
 * step among five green ones, which is the kind of thing that gets muted.
 */
describe("every Stryker config", () => {
  for (const config of STRYKER) {
    it(`can load its test runner: ${config}`, () => {
      expect(existsSync(config), `${config} is missing`).toBe(true);
      const lane = JSON.parse(readFileSync(config, "utf8")) as {
        plugins?: string[];
        testRunner?: string;
        vitest?: { configFile?: string };
        mutate?: string[];
      };
      expect(lane.testRunner).toBe("vitest");
      expect(lane.plugins ?? []).toContain("@stryker-mutator/vitest-runner");
      expect(lane.mutate?.length ?? 0).toBeGreaterThan(0);
      expect(existsSync(lane.vitest?.configFile ?? "")).toBe(true);
    });
  }
});
