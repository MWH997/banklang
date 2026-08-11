import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What CI runs, and what it deliberately does not.
 *
 * Both findings below are the same shape: a workflow file is the only record of
 * a decision, nothing reads it, and it drifts. `ci.yml`'s comments are the best
 * account in this repository of what has gone wrong before — which is worth
 * having, and is not a check.
 */

const ROOT = resolve(import.meta.dirname, "..");
const workflow = (name: string): string =>
  readFileSync(resolve(ROOT, ".github/workflows", name), "utf8");
const action = (name: string): string =>
  readFileSync(resolve(ROOT, ".github/actions", name, "action.yml"), "utf8");

/** One top-level job, ending before the next top-level job. */
function job(source: string, name: string): string {
  const start = source.indexOf(`\n  ${name}:\n`);
  expect(start, `no job named "${name}"`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * G4. The audit's claim was that "the tool exists and nothing runs it". At the
 * commit it was written against, `scheduled.yml` already had a `citations` job,
 * so the finding was wrong — but the failure mode it names is real and cheap to
 * make impossible, and a script nobody invokes is exactly how
 * `tools/check-citations.ts` would have looked a week after it was written.
 *
 * Both directions, because the placement is a decision rather than an accident.
 */
describe("the citation check", () => {
  it("is run by the scheduled workflow", () => {
    expect(workflow("scheduled.yml")).toContain("pnpm docs:citations");
  });

  it("is not run by the per-push workflow", () => {
    expect(
      workflow("ci.yml"),
      "a network check must not fail a pull request because IBM's CDN blipped",
    ).not.toContain("docs:citations");
  });
});

/**
 * G5. `if: always()` on the SARIF steps meant a red run re-invoked the compiler
 * after the step that had just proved it was broken, and published the result
 * to the Security tab as this commit's verdict.
 *
 * Asserted on the step rather than on the whole file, because `always()` is
 * right elsewhere — the mutation lanes upload their report whatever the score
 * was, which is the point of running them.
 */
describe("the SARIF report", () => {
  const ci = workflow("ci.yml");

  /** One step, from its `- name:` to the next one at the same indent. */
  function step(name: string): string {
    const start = ci.indexOf(`- name: ${name}\n`);
    expect(start, `no step named "${name}"`).toBeGreaterThan(-1);
    const rest = ci.slice(start + 1);
    const next = rest.indexOf("\n      - name:");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("is not produced by a build that has already failed", () => {
    expect(step("Produce SARIF report")).not.toContain("if: always()");
  });

  it("is uploaded only when it was produced", () => {
    // Conditioned on the step rather than on the job: an upload with no file is
    // a red step on a green run, which reads as a fault and is not one.
    expect(step("Upload SARIF")).toContain("if: steps.sarif.outcome");
  });
});

describe("the scheduled validation toolchain", () => {
  const ci = workflow("ci.yml");
  const scheduled = workflow("scheduled.yml");
  const setup = action("setup-gnucobol");

  it("uses one pinned GnuCOBOL setup in CI and horizontal validation", () => {
    const invocation = "uses: ./.github/actions/setup-gnucobol";
    expect(job(ci, "verify")).toContain(invocation);
    expect(job(scheduled, "horizontal")).toContain(invocation);
    expect(job(scheduled, "mutation")).not.toContain(invocation);
    expect(ci).toContain('GNUCOBOL_VERSION: "3.2"');
    expect(scheduled).toContain('GNUCOBOL_VERSION: "3.2"');
  });

  it("keeps cache-hit dependencies and the version assertion in the setup", () => {
    expect(setup).toContain("uses: actions/cache@v6");
    expect(setup).toContain("libcjson-dev");
    expect(setup).toContain("if: steps.gnucobol.outputs.cache-hit != 'true'");
    expect(setup).toContain('"(GnuCOBOL) ${GNUCOBOL_VERSION}"');
  });
});

describe("scheduled mutation reporting", () => {
  const mutation = job(workflow("scheduled.yml"), "mutation");

  it("runs bounded interpreter and precompiler matrix jobs", () => {
    expect(mutation).toContain("script: test:mutation:runtime");
    expect(mutation).toContain("report: dist/mutation-runtime");
    expect(mutation).toContain("script: test:mutation:runtime:machine");
    expect(mutation).toContain("report: dist/mutation-runtime-machine");
    expect(mutation).toContain("script: test:mutation:runtime:statements");
    expect(mutation).toContain("report: dist/mutation-runtime-statements");
    expect(mutation).toContain("script: test:mutation:precompiler");
    expect(mutation).toContain("report: dist/mutation-precompiler");
    expect(mutation).toContain("timeout-minutes: 180");
  });

  it("does not mistake a missing report for a per-file-floor failure", () => {
    expect(mutation).toContain("id: report");
    expect(mutation).toContain("timeout-minutes: 165");
    expect(mutation).toContain(
      "if: always() && steps.report.outputs.present == 'true'",
    );
    expect(mutation).toContain("**Run failure:**");
    expect(mutation).toContain("**Missing report:**");
    expect(mutation).toContain("**Per-file floor failure:**");
    expect(mutation).toContain("open.title !== title");
  });

  it("restores a captured mutation failure as the job conclusion", () => {
    expect(mutation).toContain("- name: Fail an unsuccessful mutation lane");
    expect(mutation).toContain(
      "steps.report.outcome == 'failure' || steps.floor.outcome == 'failure'",
    );
  });
});
