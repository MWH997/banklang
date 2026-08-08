import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NOT_INTERPRETED } from "../tools/interpret";
import { measureCoverage, renderCoverage } from "../tools/interpreter-coverage";

/**
 * The runtime coverage gate.
 *
 * `pnpm interpreter:coverage` measures what the backend emits against what the
 * interpreter executes. Until this file existed it was a readout: somebody had
 * to run it and read the number. That is how `SORT` and `MERGE` stayed
 * unexecutable while three benchmark tasks passed under `cobc` alone, and it is
 * how the next one would too — a backend change that starts emitting a new
 * locally executable verb reopens the hole silently.
 *
 * So the measurement is an assertion. A verb is allowed out of the differential
 * lane only by being on the exemption list with a reason, and each exemption is
 * held here to a program this repository already records as not locally
 * runnable. An exemption whose reason has expired fails rather than persists.
 */
describe("every locally executable verb the backend emits", () => {
  const report = measureCoverage();

  it("is measured over a corpus wide enough to contain the awkward ones", () => {
    // `freshArtifacts` plus the benchmark implementations. Measured over the
    // examples alone this matrix reported zero blind spots while `SORT`,
    // `MERGE`, `RELEASE` and `RETURN` were unimplemented, because no example
    // emits them.
    expect(report.artifacts).toBeGreaterThan(100);
    expect(report.local.length).toBeGreaterThan(25);
  });

  it("can be executed by the interpreter", () => {
    expect(
      report.gaps.map((gap) => `${gap.verb} (${gap.artifacts.join(", ")})`),
    ).toEqual([]);
  });

  /**
   * The exemptions, held to their reasons.
   *
   * Both categories are already recorded elsewhere as unrunnable: Report Writer
   * by `NOT_INTERPRETED` in `tools/interpret.ts`, which
   * `tests/cobol-runtime-differential.test.ts` proves the interpreter refuses;
   * zUnit by being a test case for a runner that is not on this machine. If
   * either stops being true this fails, which is the point.
   */
  it("is exempt only for a reason that still holds", () => {
    expect(report.exempt.map((entry) => entry.verb).sort()).toEqual([
      "ENTRY",
      "GENERATE",
      "INITIATE",
      "TERMINATE",
    ]);

    for (const entry of report.exempt) {
      expect(entry.exempt, entry.verb).toBeTruthy();
      expect(entry.artifacts.length, entry.verb).toBeGreaterThan(0);
    }

    const reportWriter = report.exempt.filter((entry) =>
      ["GENERATE", "INITIATE", "TERMINATE"].includes(entry.verb),
    );
    for (const entry of reportWriter) {
      // Every program these appear in has to be one the differential lane
      // already excludes by name, or the exemption is excusing something the
      // interpreter is simply missing.
      const excluded = Object.keys(NOT_INTERPRETED);
      for (const artifact of entry.artifacts) {
        expect(
          excluded.some((project) => artifact.startsWith(project)),
          `${entry.verb} appears in ${artifact}, which is not a recorded exclusion`,
        ).toBe(true);
      }
    }

    for (const artifact of report.exempt.find((entry) => entry.verb === "ENTRY")
      ?.artifacts ?? []) {
      // A generated zUnit test case. `TZUNIT…` is the name the emitter builds
      // for one, and nothing else in the corpus emits ENTRY.
      expect(artifact).toMatch(/TZUNIT/);
    }
  });

  it("is reported in a document that is up to date", () => {
    const published = readFileSync(
      resolve(process.cwd(), "docs/validation/interpreter-coverage.md"),
      "utf8",
    );
    expect(published).toBe(renderCoverage(report));
  });
});
