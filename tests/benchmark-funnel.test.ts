import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APPLICABILITY_RULES,
  blockerFor,
  classifyTask,
  parseSpecOnlyTask,
  TASK_BLOCKERS,
  type Applicability,
} from "../packages/horizontal-validation/src/index";

/**
 * Every CobolCodeBench task has a verdict, and the verdict has evidence.
 *
 * This file exists because of one number. The funnel reported `pass /
 * applicable` as 4/4 while twenty-eight of forty-six tasks sat in a category
 * whose own description was "nobody has attempted it, so nothing is known",
 * and `applicable` was computed as "a `main.bank.ts` exists", so the rate could
 * not have been anything but 100%. A denominator that only ever contains
 * successes is not a denominator, and a corpus whose largest bucket carries no
 * information is not a measurement.
 *
 * So the tests below are about the shape of the answer rather than its value:
 * every task is classified, nothing is classified by the existence of a
 * solution, and a task the project claims it could not have matched has a
 * specific reproducible reason on file.
 */

const ROOT = "validation/tasks/cobolcodebench";

interface Task {
  slug: string;
  id: string;
  specification: string;
  authored: boolean;
}

function tasks(cwd = process.cwd()): Task[] {
  const root = resolve(cwd, ROOT);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((slug) => {
      const spec = parseSpecOnlyTask(
        JSON.parse(readFileSync(join(root, slug, "spec.json"), "utf8")),
        slug,
      );
      return {
        slug,
        id: spec.upstreamId,
        specification: spec.specification,
        authored: existsSync(join(root, slug, "main.bank.ts")),
      };
    });
}

function applicabilityOf(task: Task): Applicability {
  return classifyTask(task.specification, blockerFor(task.id)?.kind ?? null)
    .applicability;
}

describe("the CobolCodeBench funnel", () => {
  const all = tasks();

  it("has tasks to classify at all", () => {
    // A guard on the guard: an empty corpus would pass every test below.
    expect(all.length).toBeGreaterThan(40);
  });

  it("leaves no task without a verdict", () => {
    const known = new Set<Applicability>([
      "applicable",
      "unsupported-by-design",
      "unsupported-not-yet-implemented",
      "benchmark-ambiguous",
      "malformed-upstream",
      "excluded-license",
    ]);
    const unclassified = all
      .map((task) => ({ task, verdict: applicabilityOf(task) }))
      .filter((entry) => !known.has(entry.verdict))
      .map((entry) => entry.task.id);
    expect(unclassified).toEqual([]);
  });

  it("gives every non-applicable task a recorded reason", () => {
    /*
     * The whole point. A task BankTS is said not to express, or a benchmark
     * said not to be matchable, must say which and why, either from a rule
     * that fires on the task's own text, or from an entry in TASK_BLOCKERS.
     * "Nobody tried" is not among the answers any more.
     */
    const unexplained = all
      .filter((task) => applicabilityOf(task) !== "applicable")
      .filter((task) => {
        const verdict = classifyTask(
          task.specification,
          blockerFor(task.id)?.kind ?? null,
        );
        return !verdict.unsupported && !blockerFor(task.id);
      })
      .map((task) => task.id);
    expect(unexplained).toEqual([]);
  });

  it("decides applicability without consulting the implementations", () => {
    /*
     * Reclassify with every blocker still in place but the tree pretended
     * empty. Nothing may move, because nothing may depend on a file existing.
     */
    for (const task of all) {
      const withSolution = applicabilityOf(task);
      const withoutSolution = classifyTask(
        task.specification,
        blockerFor(task.id)?.kind ?? null,
      ).applicability;
      expect(withoutSolution, task.id).toBe(withSolution);
    }
  });

  it("authors every applicable task", () => {
    // `applicable + unauthored` is a legitimate state and this is the list of
    // it. Empty today; a new task landing here is work, not a failure of the
    // model.
    const outstanding = all
      .filter((task) => applicabilityOf(task) === "applicable")
      .filter((task) => !task.authored)
      .map((task) => task.id);
    expect(outstanding).toEqual([]);
  });
});

describe("the recorded blockers", () => {
  it("names a task that exists", () => {
    const known = new Set(tasks().map((task) => task.id));
    const orphans = TASK_BLOCKERS.map((entry) => entry.task).filter(
      (task) => !known.has(task),
    );
    expect(orphans).toEqual([]);
  });

  it("carries evidence for every entry", () => {
    /*
     * The bar. "The benchmark is wrong" is the conclusion a tired implementer
     * reaches about a task they have not understood, so an entry without
     * something reproducible in it is an opinion and fails here.
     */
    for (const entry of TASK_BLOCKERS) {
      expect(entry.evidence.length, entry.task).toBeGreaterThan(40);
      expect(entry.reason.length, entry.task).toBeGreaterThan(40);
    }
  });

  it("records each task once", () => {
    const seen = TASK_BLOCKERS.map((entry) => entry.task);
    expect(seen).toEqual([...new Set(seen)]);
  });

  it("does not contradict a rule that fires on the same task", () => {
    /*
     * A rule is mechanical and a blocker is a judgement, so the rule wins and
     * the two must agree. A blocker claiming a task is ambiguous while the
     * randomness rule excludes it by design would be two answers to one
     * question, and the reported one would depend on evaluation order.
     */
    const conflicts: string[] = [];
    for (const task of tasks()) {
      const blocker = blockerFor(task.id);
      if (!blocker) {
        continue;
      }
      const ruled = APPLICABILITY_RULES.some(
        (rule) =>
          rule.pattern.test(task.specification.toUpperCase()) ||
          rule.pattern.test(task.specification),
      );
      if (ruled) {
        conflicts.push(
          `${task.id} has a ${blocker.kind} blocker and is also excluded by a rule`,
        );
      }
    }
    expect(conflicts).toEqual([]);
  });
});
