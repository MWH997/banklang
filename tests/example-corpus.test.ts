import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { exampleJobs, exampleProjects } from "../tools/example-projects";
import { verificationPlan } from "../tools/verify-examples";

/**
 * Who enumerates the examples, and whether they all agree.
 *
 * `tools/example-projects.ts` was written because five tools had each walked
 * `examples/` by hand and each had assumed every entry is one directory holding
 * one program. `end-of-day-settlement` is not — a night is four programs and a
 * sort in one stream — so all five broke on the day it was added.
 *
 * CI was the sixth, and nobody noticed for a month because the branch that
 * added the job has not been pushed. Its `Verify every example` step ran
 * `bankc test` over every directory under `examples`, which on that one found
 * no `src/main.bank.ts` and ended the job with a stack trace. The step would
 * have failed on the first push.
 *
 * So the enumeration is checked here rather than trusted: what CI runs comes
 * from the same function every other tool uses, and the workflow is held to
 * calling it.
 */

const WORKFLOW = readFileSync(".github/workflows/ci.yml", "utf8");

describe("the examples CI verifies", () => {
  it("is every project and every job, from the one enumeration", () => {
    const plan = verificationPlan();
    expect(plan.filter((entry) => entry.command === "test").length).toBe(
      exampleProjects().length,
    );
    expect(plan.filter((entry) => entry.command === "job").length).toBe(
      exampleJobs().length,
    );
    expect(plan.length).toBeGreaterThan(20);
  });

  it("runs `bankc job` on a job directory and `bankc test` on nothing else", () => {
    const plan = verificationPlan();
    const job = plan.find((entry) => entry.command === "job");

    expect(job?.path).toBe("examples/end-of-day-settlement");
    // The failure this replaces: `bankc test` on that path reads
    // `examples/end-of-day-settlement/src/main.bank.ts`, which is not there.
    expect(
      plan.some(
        (entry) =>
          entry.command === "test" &&
          entry.path === "examples/end-of-day-settlement",
      ),
    ).toBe(false);
  });

  it("names a path that exists, and a program where it says there is one", () => {
    for (const { command, path } of verificationPlan()) {
      expect(existsSync(path), `${path} does not exist`).toBe(true);
      const marker = command === "job" ? "job.json" : "src/main.bank.ts";
      expect(existsSync(join(path, marker)), `${path} has no ${marker}`).toBe(
        true,
      );
    }
  });
});

describe("the workflow that runs them", () => {
  it("calls the enumeration rather than writing a seventh", () => {
    expect(WORKFLOW).toContain("pnpm examples:verify");
  });

  /**
   * The specific shape that broke. A shell glob over `examples` cannot know
   * that one of those directories holds four programs instead of one, and it
   * fails in the way that is hardest to read: a Node stack trace inside a
   * folded log group.
   */
  it("does not walk the directory itself", () => {
    expect(WORKFLOW).not.toMatch(/for\s+\w+\s+in\s+examples\//);
    expect(WORKFLOW).not.toContain("pnpm bankc test");
  });

  it("has a script for every command it runs", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    // Command lines only. A comment that says "pnpm needs to be on PATH" is
    // prose, and reading it as an invocation of a script called `on` is how
    // this check first failed.
    const invoked = WORKFLOW.split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .flatMap((line) => [
        ...line.matchAll(/(?:run:\s*|[|&;]\s*|^\s*)pnpm ([a-z][\w:]*)/g),
      ])
      .map((match) => match[1] ?? "");

    expect(invoked.length).toBeGreaterThan(5);
    for (const script of invoked) {
      if (script === "install") {
        continue;
      }
      expect(
        manifest.scripts[script],
        `ci.yml runs \`pnpm ${script}\`, which package.json does not define`,
      ).toBeDefined();
    }
  });
});
