import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildSnapshot,
  snapshotPath,
  type ReleaseSnapshot,
} from "../tools/release-snapshot";

/**
 * Numbers written in prose, held to the release snapshot.
 *
 * The generated pages under `docs/validation/` cannot drift: they are rendered
 * from `evidence/horizontal/` and regenerating them is the only way to change
 * them. Prose is the other half. The README, the release notes and a launch
 * article each state figures, each was written at a different moment by
 * somebody reading a different file, and the failure mode is not dishonesty —
 * it is a measurement that moved after the sentence quoting it was written, and
 * nobody re-reads a sentence.
 *
 * So every published figure is compared against `evidence/release/<version>.json`,
 * and that file is compared against the evidence it came from by
 * `pnpm release:snapshot --check`. Two links, both mechanical.
 */

const ROOT = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

const SNAPSHOT_FILE = snapshotPath(ROOT.version);

describe("the release snapshot", () => {
  it("exists for the version the manifests name", () => {
    expect(
      existsSync(SNAPSHOT_FILE),
      `${SNAPSHOT_FILE} is missing. Run \`pnpm release:snapshot\`.`,
    ).toBe(true);
  });

  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;

  /**
   * The snapshot against the evidence, which is what `--check` does.
   *
   * Repeated here so a stale snapshot fails `pnpm test` rather than waiting for
   * somebody to run the release tool. The test count is carried across rather
   * than recomputed: this assertion is running inside the suite it would have
   * to count.
   */
  it("still agrees with the evidence it was taken from", () => {
    const fresh = buildSnapshot(process.cwd(), {
      files: snapshot.tests.files,
      tests: snapshot.tests.tests,
    });
    expect(fresh).toEqual(snapshot);
  });

  it("names the version the manifests name", () => {
    expect(snapshot.banklangVersion).toBe(ROOT.version);
  });

  /**
   * The one sentence that must never become derived from anything.
   *
   * Everywhere else this is computed from whether an IBM result has been
   * imported. In the snapshot it is a constant, because a snapshot is what
   * somebody quotes when they are not reading the code.
   */
  it("records that native IBM validation has not been performed", () => {
    expect(snapshot.nativeIbmValidation).toBe("NOT YET PERFORMED");
    expect(snapshot.target).toContain("IBM Enterprise COBOL 6.4");
    expect(snapshot.executedWith).toMatch(/GnuCOBOL/);
  });

  /** Said out loud, because a release that quietly implied otherwise would. */
  it("records that the full mutation suite was not run for this release", () => {
    expect(snapshot.mutation.fullSuiteRunThisRelease).toBe(false);
    expect(snapshot.mutation.survivorsClassified).toBe(true);
  });
});

describe("what the README claims", () => {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;
  const readme = readFileSync("README.md", "utf8").replace(/\s+/g, " ");

  /**
   * "27 of the 31 it emits" — the differential denominator, in prose.
   *
   * This is the number most worth getting wrong: it is the one a sceptical
   * reader checks first, and the temptation is to quote the flattering
   * denominator. The claim is about *locally executable* verbs, and the four
   * that are not are named in the same sentence.
   */
  it("states the differential coverage the snapshot records", () => {
    const { locallyExecutable, verbsEmitted, interpreted, blindSpots } =
      snapshot.differential;
    expect(interpreted).toBe(locallyExecutable);
    expect(blindSpots).toBe(0);
    expect(readme).toContain(
      `${String(locallyExecutable)} of the ${String(verbsEmitted)} it emits`,
    );
  });

  it("says how many verbs are exempt, and the snapshot agrees", () => {
    expect(snapshot.differential.exempt).toHaveLength(
      snapshot.differential.verbsEmitted -
        snapshot.differential.locallyExecutable,
    );
  });
});

describe("what the generated validation pages report", () => {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;
  const results = readFileSync(
    "docs/validation/horizontal-validation-results.md",
    "utf8",
  );
  const defects = readFileSync(
    "docs/validation/horizontal-defect-coverage.md",
    "utf8",
  );

  it("reports the CobolCodeBench whole-corpus rate the snapshot records", () => {
    expect(results).toContain(String(snapshot.cobolCodeBench.passOfDiscovered));
  });

  it("reports the X-COBOL file count the snapshot records", () => {
    expect(results).toContain(
      `| COBOL files discovered | ${String(snapshot.xcobol.discovered)} |`,
    );
  });

  it("reports the OpenCBS rate the snapshot records", () => {
    const { preventedAtCompileTime, total } = snapshot.openCbs;
    expect(defects).toContain(
      `| prevented at compile time | ${String(preventedAtCompileTime)} / ${String(total)} `,
    );
  });

  /** The page and the snapshot must name the same compiler. */
  it("names the compiler the evidence was executed with", () => {
    expect(results).toContain(snapshot.executedWith);
    expect(results).toContain(
      "Native IBM Enterprise COBOL validation: NOT YET PERFORMED.",
    );
  });
});

describe("what the release notes claim", () => {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;
  const path = `docs/releases/${ROOT.version}.md`;

  it("exist for this version", () => {
    expect(existsSync(path), `${path} is missing`).toBe(true);
  });

  const notes = readFileSync(path, "utf8").replace(/\s+/g, " ");

  /**
   * Every figure the notes state, against the snapshot.
   *
   * Written as a list rather than as separate assertions so that adding a
   * number to the notes means adding it here — which is the only way this test
   * keeps meaning something as the notes grow.
   */
  const quoted: [string, string][] = [
    ["tests", String(snapshot.tests.tests)],
    ["test files", String(snapshot.tests.files)],
    ["example projects", String(snapshot.examples.projects)],
    [
      "locally executable verbs",
      `${String(snapshot.differential.locallyExecutable)} of ${String(snapshot.differential.verbsEmitted)}`,
    ],
    ["CobolCodeBench", String(snapshot.cobolCodeBench.passOfDiscovered)],
    ["X-COBOL files", String(snapshot.xcobol.discovered)],
    [
      "OpenCBS",
      `${String(snapshot.openCbs.preventedAtCompileTime)} of ${String(snapshot.openCbs.total)}`,
    ],
  ];

  for (const [what, value] of quoted) {
    it(`states the ${what} the snapshot records`, () => {
      expect(notes, `the notes do not state ${what} as "${value}"`).toContain(
        value,
      );
    });
  }

  it("says what has not been validated", () => {
    expect(notes).toContain("NOT YET PERFORMED");
    expect(notes.toLowerCase()).toContain("known limitations");
  });

  /** The phrases the repository forbids itself, checked on the release page. */
  it("makes none of the claims this repository disallows", () => {
    for (const forbidden of [
      "Validated with IBM Enterprise COBOL",
      "IBM-compatible",
      "Production-ready",
      "production ready",
    ]) {
      expect(notes, `the release notes say "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });
});
