import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildSnapshot,
  compareReleaseSnapshotEvidence,
  releaseSnapshotLifecycle,
  releaseSnapshotMetadataError,
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
 * somebody reading a different file, and the failure mode is rarely dishonesty.
 * It is a measurement that moved after the sentence quoting it was written, and
 * nobody re-reads a sentence.
 *
 * Historical release prose is always compared against
 * `evidence/release/<version>.json`. Current surfaces and current evidence are
 * compared with it only while cutting a release. Once new work is filed under
 * Unreleased, the snapshot stays frozen while those current surfaces move.
 */

const ROOT = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

const SNAPSHOT_FILE = snapshotPath(ROOT.version);
const CHANGELOG = readFileSync("CHANGELOG.md", "utf8");
const SNAPSHOT_LIFECYCLE = releaseSnapshotLifecycle(CHANGELOG);
const RELEASE_CUT = SNAPSHOT_LIFECYCLE === "release-cut";

describe("the release-snapshot lifecycle", () => {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;

  it("distinguishes ordinary development from an empty release-cut section", () => {
    expect(
      releaseSnapshotLifecycle(
        "## [Unreleased]\n\n### Added\n\n- Work.\n\n## [0.10.0] — 2026-08-09\n",
      ),
    ).toBe("development");
    expect(
      releaseSnapshotLifecycle(
        "## [Unreleased]\n\n## [0.11.0] — 2026-08-11\n\n- Work.\n",
      ),
    ).toBe("release-cut");
    expect(() =>
      releaseSnapshotLifecycle("## [0.10.0] — 2026-08-09\n"),
    ).toThrow("CHANGELOG.md has no `## [Unreleased]` section.");
  });

  it("does not derive current evidence during ordinary development", () => {
    const fresh = vi.fn(() => snapshot);
    const result = compareReleaseSnapshotEvidence(
      "## [Unreleased]\n\n- Next release work.\n\n## [0.10.0] — 2026-08-09\n",
      snapshot,
      fresh,
    );
    expect(result).toBe("deferred");
    expect(fresh).not.toHaveBeenCalled();
  });

  it("still validates frozen release identity during development", () => {
    const changelog =
      "## [Unreleased]\n\n- Next release work.\n\n## [0.10.0] — 2026-08-09\n";
    expect(releaseSnapshotMetadataError(snapshot, "0.10.0", changelog)).toBe(
      null,
    );
    expect(
      releaseSnapshotMetadataError(
        { ...snapshot, schema: 2 },
        "0.10.0",
        changelog,
      ),
    ).toContain("schema 2");
    expect(
      releaseSnapshotMetadataError(
        { ...snapshot, banklangVersion: "0.9.0" },
        "0.10.0",
        changelog,
      ),
    ).toContain("BankLang 0.9.0");
    expect(
      releaseSnapshotMetadataError(
        { ...snapshot, released: "2026-08-08" },
        "0.10.0",
        changelog,
      ),
    ).toContain("release date 2026-08-08");
  });

  it("compares at a release cut and reports drift", () => {
    const drifted = {
      ...snapshot,
      xcobol: { ...snapshot.xcobol, discovered: -1 },
    };
    const fresh = vi.fn(() => drifted);
    const result = compareReleaseSnapshotEvidence(
      "## [Unreleased]\n\n## [0.11.0] — 2026-08-11\n",
      snapshot,
      fresh,
    );
    expect(result).toBe("drift");
    expect(fresh).toHaveBeenCalledOnce();
    expect(
      compareReleaseSnapshotEvidence(
        "## [Unreleased]\n\n## [0.11.0] — 2026-08-11\n",
        snapshot,
        () => snapshot,
      ),
    ).toBe("match");
  });
});

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

  it("is frozen in development and agrees with evidence at a release cut", () => {
    const comparison = compareReleaseSnapshotEvidence(CHANGELOG, snapshot, () =>
      buildSnapshot(process.cwd(), {
        files: snapshot.tests.files,
        tests: snapshot.tests.tests,
      }),
    );
    expect(comparison).toBe(RELEASE_CUT ? "match" : "deferred");
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
   * "27 of the 31 it emits": the differential denominator, in prose.
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
    // The two numbers and the relation between them, not the noun phrase
    // around them. This asserted `… it emits` verbatim, so tightening the
    // sentence failed a test about a denominator without the denominator
    // having changed, which teaches the wrong lesson about editing prose.
    expect(readme).toContain(
      `${String(locallyExecutable)} of the ${String(verbsEmitted)} `,
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
   * number to the notes means adding it here, which is the only way this test
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
      // `toContain` on a whole document prints the whole document when it
      // fails, which for a release page is eight kilobytes of noise around the
      // one number that moved. The assertion is on a boolean so the message is
      // the message.
      expect(
        notes.includes(value),
        `docs/releases/${ROOT.version}.md does not state the ${what} as "${value}". Re-read evidence/release/${ROOT.version}.json and update the page.`,
      ).toBe(true);
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

/**
 * The launch article, which quotes eight figures and is not generated.
 *
 * The other surfaces here were already held to the snapshot. This one was not,
 * and it is the one written furthest from the evidence: a post is drafted once,
 * published, and then the numbers in it move underneath it. Two of its figures
 * had already gone stale by the time 0.10.0 was cut: the test count, and a
 * sentence that folded a defect BankTS cannot express into the
 * `not-demonstrated` pile.
 *
 * Only the figures are asserted. A blog post is prose and should stay editable;
 * what may not change silently is a number.
 */
describe("what the launch article claims", () => {
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ReleaseSnapshot;
  const path = "blog/a-banking-language-that-compiles-to-cobol.md";
  const article = readFileSync(path, "utf8").replace(/\s+/g, " ");

  const figures: [string, string][] = [
    ["test count", String(snapshot.tests.tests)],
    ["example project count", `${String(snapshot.examples.projects)} example`],
    [
      "differential denominator",
      `${String(snapshot.differential.locallyExecutable)} of the ${String(snapshot.differential.verbsEmitted)}`,
    ],
    ["X-COBOL file count", String(snapshot.xcobol.discovered)],
    [
      "CobolCodeBench whole-corpus numerator",
      `${String(snapshot.cobolCodeBench.passed)} of ${String(snapshot.cobolCodeBench.discovered)}`,
    ],
    ["OpenCBS denominator", `of ${String(snapshot.openCbs.total)} defects`],
  ];

  for (const [what, value] of figures) {
    it(`states the ${what} the snapshot records`, () => {
      expect(
        article.includes(value),
        `${path} does not state the ${what} as "${value}".`,
      ).toBe(true);
    });
  }

  it("says native IBM validation has not been performed", () => {
    expect(article).toContain(
      "Native IBM Enterprise COBOL\nvalidation has not been performed".replace(
        /\s+/g,
        " ",
      ),
    );
  });
});

/**
 * The claims no public surface may make, checked on all of them at once.
 *
 * The release notes had this check and nothing else did, so the one page most
 * likely to be read carefully was the one page that was guarded. These phrases
 * are the ones `docs/status-and-limits.md` fixes in advance as not allowed
 * while no IBM compiler has run this output, and the point of fixing them in
 * advance is that the question is settled before there is any incentive to
 * answer it loosely.
 */
describe("the claims no public surface may make", () => {
  const forbidden = [
    "IBM-compatible",
    "IBM compatible",
    "IBM-validated",
    "Enterprise COBOL validated",
    "tested on z/OS",
    "production-ready",
    "production ready",
  ];

  /** Public prose. Not `docs/status-and-limits.md`, which quotes the list. */
  const surfaces = [
    "README.md",
    "packages/site/src/index.html",
    "packages/playground/index.html",
    `docs/releases/${ROOT.version}.md`,
    "docs/validation/horizontal-validation.md",
    "blog/a-banking-language-that-compiles-to-cobol.md",
  ];

  for (const surface of surfaces) {
    it(`${surface} makes none of them`, () => {
      const text = readFileSync(surface, "utf8").toLowerCase();
      for (const phrase of forbidden) {
        expect(
          text.includes(phrase.toLowerCase()),
          `${surface} says "${phrase}"`,
        ).toBe(false);
      }
    });
  }

  /**
   * The distinction itself, on the surfaces a first-time reader lands on.
   *
   * Absence of a forbidden phrase is not the same as making the distinction.
   * A page that never mentions GnuCOBOL passes the check above and still
   * leaves a reader thinking the output has been through IBM's compiler.
   */
  for (const surface of [
    "README.md",
    "packages/site/src/index.html",
    `docs/releases/${ROOT.version}.md`,
  ]) {
    it(`${surface} names GnuCOBOL and says IBM validation has not happened`, () => {
      // Whitespace collapsed first. These files are wrapped by Prettier and by
      // hand, so a regex written against one wrapping fails the next time a
      // sentence is edited, on a page whose meaning has not moved at all.
      const text = readFileSync(surface, "utf8").replace(/\s+/g, " ");
      expect(text).toContain("GnuCOBOL");
      // An explicit negative about IBM, not merely the absence of a claim.
      expect(
        /no ibm enterprise cobol validation|not yet performed/i.test(text),
        `${surface} names GnuCOBOL but never says IBM validation has not happened`,
      ).toBe(true);
    });
  }
});
