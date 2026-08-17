import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NOT_INTERPRETED } from "../tools/interpret";
import {
  exitCodeFor,
  measureCoverage,
  renderCoverage,
  type CoverageReport,
  type VerbCoverage,
} from "../tools/interpreter-coverage";

/**
 * The runtime coverage gate.
 *
 * `pnpm interpreter:coverage` measures what the backend emits against what the
 * interpreter executes. Until this file existed it was a readout: somebody had
 * to run it and read the number. That is how `SORT` and `MERGE` stayed
 * unexecutable while three benchmark tasks passed under `cobc` alone, and it is
 * how the next one would too: a backend change that starts emitting a new
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

  it("is reported in a document that is up to date", () => {
    const published = readFileSync(
      resolve(process.cwd(), "docs/validation/interpreter-coverage.md"),
      "utf8",
    );
    expect(published).toBe(renderCoverage(report));
  });
});

/**
 * The verdict, and the report it is written from, on inputs this repository
 * does not currently produce.
 *
 * Every branch below is one the live measurement never takes. There are no
 * blind spots, there are exemptions, and there is external COBOL, so nothing
 * exercised them and mutation put twenty of this file's mutants in code no
 * test reached. The branches that matter most are exactly those: a gate is
 * only a gate on the day the answer changes.
 */
describe("the gate on a corpus it has not seen", () => {
  function verb(overrides: Partial<VerbCoverage> = {}): VerbCoverage {
    return {
      verb: "READ",
      emitted: 3,
      interpreted: true,
      exempt: null,
      artifacts: ["account-transfer"],
      ...overrides,
    };
  }

  function report(overrides: Partial<CoverageReport> = {}): CoverageReport {
    return {
      artifacts: 1,
      verbs: [verb()],
      local: [verb()],
      gaps: [],
      exempt: [],
      external: [],
      ...overrides,
    };
  }

  it("is green with no blind spot and red with one", () => {
    expect(exitCodeFor(report())).toBe(0);
    expect(
      exitCodeFor(
        report({ gaps: [verb({ verb: "SORT", interpreted: false })] }),
      ),
    ).toBe(1);
  });

  it("names each blind spot and where it is emitted", () => {
    const rendered = renderCoverage(
      report({
        gaps: [
          verb({ verb: "SORT", emitted: 7, interpreted: false }),
          verb({
            verb: "MERGE",
            emitted: 2,
            interpreted: false,
            artifacts: ["a", "b"],
          }),
        ],
      }),
    );

    expect(rendered).toContain(
      "## Blind spots, by how much emitted COBOL uses",
    );
    expect(rendered).toContain("| `SORT` | 7 | account-transfer |");
    expect(rendered).toContain("| `MERGE` | 2 | a, b |");
    expect(rendered).toContain("| differential blind spots | 2 |");
    expect(rendered).not.toContain("Every locally executable verb");
  });

  it("says so plainly when there are none", () => {
    const rendered = renderCoverage(report());

    expect(rendered).toContain(
      "Every locally executable verb the backend emits can be executed by both engines.",
    );
    expect(rendered).not.toContain("## Blind spots");
    expect(rendered).toContain("| differential blind spots | 0 |");
  });

  /** The interpreted count is the numerator the headline is read from. */
  it("counts the interpreted verbs among the locally executable ones", () => {
    const rendered = renderCoverage(
      report({
        local: [
          verb(),
          verb({ verb: "WRITE" }),
          verb({ verb: "SORT", interpreted: false }),
        ],
        gaps: [verb({ verb: "SORT", interpreted: false })],
      }),
    );

    expect(rendered).toContain("| of those, locally executable | 3 |");
    expect(rendered).toContain("| of those, interpreted | 2 |");
  });

  it("says none rather than an empty table when nothing is exempt", () => {
    expect(renderCoverage(report())).toContain("_None._");
    expect(
      renderCoverage(
        report({
          exempt: [
            verb({ verb: "ENTRY", exempt: "a generated zUnit test case" }),
          ],
        }),
      ),
    ).toContain("| `ENTRY` | account-transfer | a generated zUnit test case |");
  });

  it("says none rather than a list when nothing needs Db2 or CICS", () => {
    expect(renderCoverage(report())).toContain("_None emitted._");
    expect(renderCoverage(report({ external: ["EXEC SQL"] }))).toContain(
      "`EXEC SQL`",
    );
  });
});
