import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

import {
  APPLICABILITY_RULES,
  CORPORA,
  SUPPORT_RULES,
  checkTallyIsComplete,
  classifyLicence,
  classifyProgram,
  classifyTask,
  compareEngines,
  compareRun,
  corpus,
  detectLicence,
  formatRate,
  hashBytes,
  isOracleDerivable,
  lockHash,
  needsLineSequential,
  normalizeOutput,
  parseSpecOnlyTask,
  safeJoin,
  sanitizedEnv,
  stableLockJson,
  supportFor,
  tally,
  verifyLock,
  MalformedTaskError,
  UnsafePathError,
  type CorpusLock,
  type TaskResult,
} from "../packages/horizontal-validation/src/index";
import {
  FEATURES,
  detectFeatures,
} from "../packages/migration-analysis/src/features";

/**
 * The horizontal validation framework, checked without any corpus present.
 *
 * None of these tests reads `validation/cache/`. That is the whole design: the
 * corpora are fetched by hand into an ignored directory, and a suite that
 * needed them would be a suite that fails on a fresh clone and on every CI
 * runner. What is checked here is the machinery — the rules that decide what
 * BankTS can express, the arithmetic that reports it, and the guards that stop
 * an untrusted corpus writing where it likes.
 *
 * The rules themselves are the part most worth pinning. A support rule quietly
 * flipping to `supported` would raise every representability figure this
 * project publishes, and the one that did exactly that — line-sequential files,
 * marked supported on the strength of COBOL that the emitter never produced —
 * is what these tests exist to catch next time.
 */

describe("the corpus registry", () => {
  it("gives every corpus a unique id", () => {
    const ids = CORPORA.map((entry) => entry.id);
    expect([...new Set(ids)].sort()).toEqual([...ids].sort());
  });

  it("states what each corpus establishes and what it does not", () => {
    for (const entry of CORPORA) {
      expect(
        entry.establishes.length,
        `${entry.id} establishes`,
      ).toBeGreaterThan(40);
      expect(entry.limits.length, `${entry.id} limits`).toBeGreaterThan(40);
      expect(entry.citation, `${entry.id} citation`).not.toBe("");
    }
  });

  it("never marks a coverage corpus as semantic", () => {
    // A corpus with no expected output cannot establish correctness, and the
    // category is what stops a report claiming it did.
    expect(corpus("xcobol-v2").category).toBe("coverage");
    expect(corpus("cobolcodebench").category).toBe("semantic");
  });

  it("keeps NIST's suite local-only and never redistributable", () => {
    const ccvs = corpus("ccvs85-local");
    expect(ccvs.fetch.kind).toBe("local");
    expect(ccvs.redistribution).toBe("none");
  });

  it("does not vendor a corpus whose licence covers only the compilation", () => {
    // X-COBOL gathers 168 repositories under one CC-BY record. The record
    // licenses the gathering, not the files, so nothing may be copied out.
    expect(corpus("xcobol-v2").redistribution).toBe("derived-only");
  });
});

describe("the licensing gate", () => {
  it("permits the permissive licences and no others", () => {
    expect(classifyLicence("MIT", "test").verdict).toBe("redistributable");
    expect(classifyLicence("Apache-2.0", "test").verdict).toBe(
      "redistributable",
    );
    expect(classifyLicence("GPL-3.0", "test").verdict).toBe(
      "excluded-license-copyleft",
    );
    expect(classifyLicence("CC-BY-4.0", "test").verdict).toBe(
      "excluded-license-copyleft",
    );
  });

  it("treats an absent or unrecognised licence as unknown rather than guessing", () => {
    expect(classifyLicence(null, "test").verdict).toBe(
      "excluded-license-unknown",
    );
    expect(classifyLicence("NOASSERTION", "test").verdict).toBe(
      "excluded-license-unknown",
    );
    expect(classifyLicence("WTFPL-9.9", "test").verdict).toBe(
      "excluded-license-unknown",
    );
  });

  it("identifies a licence from its text, narrowest name first", () => {
    // `GNU LESSER GENERAL PUBLIC LICENSE` contains `GENERAL PUBLIC LICENSE`, so
    // an order that tests GPL first calls every LGPL file GPL.
    expect(
      detectLicence(
        "GNU LESSER GENERAL PUBLIC LICENSE\n Version 3, 29 June 2007",
      ).spdx,
    ).toBe("LGPL-3.0");
    expect(
      detectLicence("GNU GENERAL PUBLIC LICENSE\n Version 3, 29 June 2007")
        .spdx,
    ).toBe("GPL-3.0");
    expect(
      detectLicence(
        "Permission is hereby granted, free of charge, to any person",
      ).spdx,
    ).toBe("MIT");
    expect(detectLicence("all rights reserved").spdx).toBeNull();
  });
});

describe("path safety against an untrusted corpus", () => {
  const root = "/tmp/horizontal-root";

  it("refuses a path that climbs out of the working directory", () => {
    expect(() => safeJoin(root, "../../packages/parser/src/index.ts")).toThrow(
      UnsafePathError,
    );
    // No leading `..`, and it still leaves.
    expect(() => safeJoin(root, "a/../../../etc/passwd")).toThrow(
      UnsafePathError,
    );
  });

  it("refuses an absolute path", () => {
    expect(() => safeJoin(root, "/etc/passwd")).toThrow(UnsafePathError);
    expect(() => safeJoin(root, "C:\\Windows\\system32")).toThrow(
      UnsafePathError,
    );
  });

  it("refuses a NUL byte", () => {
    expect(() => safeJoin(root, "ok.txt\0.cbl")).toThrow(UnsafePathError);
  });

  it("does not mistake a sibling directory for the root", () => {
    // `/tmp/horizontal-root-evil` starts with the root's path as a string and
    // is not inside it, which a `startsWith` without the separator allows.
    expect(() => safeJoin(root, "../horizontal-root-evil/x")).toThrow(
      UnsafePathError,
    );
  });

  it("allows an ordinary nested name", () => {
    expect(safeJoin(root, "sub/dir/file.cbl")).toBe(
      "/tmp/horizontal-root/sub/dir/file.cbl",
    );
  });

  it("builds an environment rather than inheriting one", () => {
    process.env.BANKLANG_TEST_SECRET = "must-not-leak";
    try {
      const env = sanitizedEnv();
      expect(env.BANKLANG_TEST_SECRET).toBeUndefined();
      expect(env.PATH).toBeDefined();
      expect(env.LC_ALL).toBe("C");
    } finally {
      delete process.env.BANKLANG_TEST_SECRET;
    }
  });
});

describe("the task manifest, read strictly", () => {
  const valid = {
    id: "cobolcodebench/task_func_01",
    corpus: "cobolcodebench",
    upstreamId: "task_func_01",
    upstreamVersion: "abc123",
    licence: "Apache-2.0",
    specification: "Do a thing.",
    inputs: { "in.txt": "a" },
    expectedOutputs: { "out.txt": "b" },
    expectedStdout: null,
    expectedExitCode: null,
    timeoutMs: 30_000,
  };

  it("accepts a well-formed manifest", () => {
    expect(parseSpecOnlyTask(valid, "spec.json").upstreamId).toBe(
      "task_func_01",
    );
  });

  it("refuses a file name that is a path", () => {
    // The file name becomes a path in the working directory, so a manifest that
    // names `../../src/index.ts` must fail at the boundary and say which file
    // carried it.
    expect(() =>
      parseSpecOnlyTask(
        { ...valid, expectedOutputs: { "../../escape.ts": "x" } },
        "spec.json",
      ),
    ).toThrow(MalformedTaskError);
    expect(() =>
      parseSpecOnlyTask({ ...valid, inputs: { "a\0b": "x" } }, "spec.json"),
    ).toThrow(MalformedTaskError);
  });

  it("refuses a missing or mistyped field rather than defaulting it", () => {
    expect(() =>
      parseSpecOnlyTask({ ...valid, specification: "" }, "s"),
    ).toThrow(MalformedTaskError);
    expect(() => parseSpecOnlyTask({ ...valid, timeoutMs: 0 }, "s")).toThrow(
      MalformedTaskError,
    );
    expect(() => parseSpecOnlyTask({ ...valid, inputs: [] }, "s")).toThrow(
      MalformedTaskError,
    );
    expect(() => parseSpecOnlyTask("not an object", "s")).toThrow(
      MalformedTaskError,
    );
  });
});

describe("the arithmetic that reports a run", () => {
  const result = (
    applicability: string,
    outcome: TaskResult["outcome"],
  ): TaskResult => ({
    taskId: `t${applicability}${outcome}`,
    corpus: "c",
    applicability,
    // An outcome other than `not-executed` means something ran, so the other
    // two axes follow from it rather than being free to contradict it.
    authoring: outcome === "not-executed" ? "unauthored" : "authored",
    execution: outcome === "not-executed" ? "not-executed" : "both-engines",
    outcome,
    detail: null,
    diagnostics: [],
    artifactHashes: {},
    durationMs: 1,
    differentialAgreement: null,
  });

  it("always carries the denominator", () => {
    expect(formatRate(18, 20)).toBe("18 / 20 (90.0%)");
    expect(formatRate(0, 0)).toBe("0 / 0");
  });

  it("reports the pass rate against applicable and against everything", () => {
    const counted = tally("c", 46, [
      result("applicable", "pass"),
      result("applicable", "semantic-mismatch"),
      result("unsupported-by-design", "not-executed"),
    ]);
    // The number that flatters is 1/2; the number a reader needs is both.
    expect(counted.passOfApplicable).toBe("1 / 2 (50.0%)");
    expect(counted.passOfDiscovered).toBe("1 / 46 (2.2%)");
  });

  it("reports authoring coverage beside the rate that assumes it", () => {
    /*
     * The defect the four rates exist for. Two applicable tasks, one written
     * and passing: `pass / authored` is 1/1 and reads as everything working,
     * and it is the shape the funnel reported for months while thirty-eight
     * tasks had no verdict at all. `authored / applicable` is the number that
     * says half the work is not done, so it travels with it.
     */
    const counted = tally("c", 46, [
      result("applicable", "pass"),
      result("applicable", "not-executed"),
    ]);
    expect(counted.passOfAuthored).toBe("1 / 1 (100.0%)");
    expect(counted.authoringCoverage).toBe("1 / 2 (50.0%)");
    expect(counted.passOfApplicable).toBe("1 / 2 (50.0%)");
    expect(counted.passOfDiscovered).toBe("1 / 46 (2.2%)");
  });

  it("refuses a pass from a task classified as one BankTS cannot express", () => {
    /*
     * The guard against relabelling a task to shrink the denominator. Every
     * category other than `applicable` claims a conforming program could not
     * match this task; one that passes refutes the claim, and the run says so
     * rather than quietly banking the pass.
     */
    const counted = tally("c", 46, [
      result("benchmark-ambiguous", "pass"),
      result("applicable", "not-executed"),
    ]);
    expect(counted.passedNotApplicable).toBe(1);
    expect(checkTallyIsComplete(counted).join("\n")).toMatch(
      /classified unsupported or ambiguous/,
    );
  });

  it("notices a task that was discovered and never accounted for", () => {
    const counted = tally("c", 46, [result("applicable", "pass")]);
    // One imported of 46 discovered is legitimate; the completeness check is
    // about categories adding up, not about the corpus being finished.
    expect(checkTallyIsComplete(counted)).toEqual([]);

    const broken = { ...counted, imported: 9 };
    expect(checkTallyIsComplete(broken)[0]).toMatch(/classified exactly once/);
  });

  it("refuses a tally where more passed than were ever run", () => {
    // Both problems are reported, not the first: a tally this wrong is one
    // investigation, and stopping at the earliest message hides the rest.
    const impossible = tally("c", 10, [result("applicable", "pass")]);
    const problems = checkTallyIsComplete({ ...impossible, authored: 0 });
    expect(problems.join("\n")).toMatch(/with no implementation cannot pass/);
  });

  it("pins every counter and every rate the report publishes", () => {
    /*
     * The whole tally from a known set, because these numbers are published.
     * Mutation testing found `result.ts` the thinnest file in the package at
     * the point this phase changed what it computes — and a counter nothing
     * asserts is a counter that can be quietly wrong in the flattering
     * direction, which is the specific failure this package exists to prevent.
     */
    const counted = tally("c", 46, [
      { ...result("applicable", "pass"), differentialAgreement: true },
      { ...result("applicable", "pass"), differentialAgreement: true },
      {
        ...result("applicable", "pass"),
        execution: "gnucobol-only",
        differentialAgreement: null,
      },
      {
        ...result("applicable", "execution-divergence"),
        differentialAgreement: false,
      },
      result("applicable", "not-executed"),
      result("unsupported-by-design", "not-executed"),
      result("unsupported-not-yet-implemented", "not-executed"),
      {
        ...result("benchmark-ambiguous", "semantic-mismatch"),
        differentialAgreement: true,
      },
    ]);

    expect(counted.discovered).toBe(46);
    expect(counted.imported).toBe(8);
    expect(counted.applicable).toBe(5);
    expect(counted.unsupportedByDesign).toBe(1);
    expect(counted.unsupportedNotYetImplemented).toBe(1);
    expect(counted.benchmarkAmbiguous).toBe(1);
    expect(counted.authored).toBe(5);
    expect(counted.authoredOfApplicable).toBe(4);
    expect(counted.executed).toBe(5);
    expect(counted.bothEngines).toBe(4);
    expect(counted.agreements).toBe(3);
    expect(counted.divergences).toBe(1);
    expect(counted.interpreterUnavailable).toBe(1);
    expect(counted.passed).toBe(3);
    expect(counted.passedNotApplicable).toBe(0);

    expect(counted.authoringCoverage).toBe("4 / 5 (80.0%)");
    expect(counted.passOfAuthored).toBe("3 / 5 (60.0%)");
    expect(counted.passOfApplicable).toBe("3 / 5 (60.0%)");
    expect(counted.passOfDiscovered).toBe("3 / 46 (6.5%)");

    // A task that never ran is not a failure with a name; everything else is.
    expect(counted.failures).toEqual({
      "execution-divergence": 1,
      "semantic-mismatch": 1,
    });
    expect(checkTallyIsComplete(counted)).toEqual([]);
  });

  it("refuses more differential verdicts than engines that ran", () => {
    // A verdict needs two engines. A tally claiming otherwise is measuring
    // something else and says so rather than publishing it.
    const counted = tally("c", 46, [result("applicable", "pass")]);
    expect(
      checkTallyIsComplete({ ...counted, bothEngines: 0, agreements: 1 }).join(
        "\n",
      ),
    ).toMatch(/A verdict needs two engines/);
  });

  it("counts every non-passing outcome by name", () => {
    const counted = tally("c", 3, [
      result("applicable", "semantic-mismatch"),
      result("applicable", "execution-divergence"),
      result("applicable", "pass"),
    ]);
    expect(counted.failures).toEqual({
      "semantic-mismatch": 1,
      "execution-divergence": 1,
    });
  });
});

describe("comparing a run against its oracle", () => {
  it("normalises line endings and trailing blanks, and nothing else", () => {
    expect(normalizeOutput("a  \r\nb\t\n")).toBe("a\nb\n");
    // Leading spaces are data in a fixed-format record.
    expect(normalizeOutput("  a\n")).toBe("  a\n");
  });

  it("fails on a differing digit", () => {
    const differences = compareRun(
      { exitCode: 0, stdout: "", outputs: new Map([["o", "100.01\n"]]) },
      {
        expectedOutputs: { o: "100.02\n" },
        expectedStdout: null,
        expectedExitCode: null,
      },
    );
    expect(differences).toHaveLength(1);
    expect(differences[0]?.where).toContain("output file o");
  });

  it("reports every difference rather than the first", () => {
    const differences = compareRun(
      { exitCode: 4, stdout: "x", outputs: new Map() },
      {
        expectedOutputs: { missing: "a\n" },
        expectedStdout: "y",
        expectedExitCode: 0,
      },
    );
    expect(differences).toHaveLength(3);
  });

  it("names a disagreement between the two execution engines", () => {
    const divergence = compareEngines(
      { exitCode: 0, stdout: "a\n", outputs: new Map() },
      { exitCode: 12, stdout: "a\n", outputs: new Map() },
    );
    expect(divergence[0]?.where).toBe("return code");
  });

  it("detects an oracle that invents text the spec and inputs never use", () => {
    const invented = isOracleDerivable(
      "Write the maximum temperature with a label.",
      { "in.txt": "225\n182\n" },
      { "out.txt": "MAXIMAM TEMP: 022.5\n" },
    );
    expect(invented.derivable).toBe(false);
    expect(invented.invented).toContain("MAXIMAM");

    const derivable = isOracleDerivable(
      "Write the TOTAL for each BRANCH.",
      { "in.txt": "LONDON 5\n" },
      { "out.txt": "TOTAL LONDON 5\n" },
    );
    expect(derivable.derivable).toBe(true);
  });

  it("does not call a transliterated word invented", () => {
    /*
     * The defect that misfiled a task for a whole phase. `[A-Z]{4,}` matches no
     * accented letter, so an input of `Váquéz` contributed no word while an
     * output of `Vaquez` contributed one — and the correct answer was reported
     * as a literal the benchmark had invented. CobolCodeBench's task_func_47 is
     * this exact shape, and its actual obstacle is the character model rather
     * than the oracle.
     */
    const folded = isOracleDerivable(
      "Convert non-English characters to their English equivalents.",
      { "in.txt": "Téa\nVáquéz\nGarciá\nZöe\nEleña\n" },
      { "out.txt": "Tea\nVaquez\nGarcia\nZoe\nElena\n" },
    );
    expect(folded.invented).toEqual([]);
    expect(folded.derivable).toBe(true);

    // And a word that really is absent is still caught, accents or not.
    const invented = isOracleDerivable(
      "Convert non-English characters to their English equivalents.",
      { "in.txt": "Téa\n" },
      { "out.txt": "Tea\nSMITH\n" },
    );
    expect(invented.invented).toEqual(["SMITH"]);
  });
});

describe("what BankTS can express", () => {
  it("has a support rule for every feature the detector can find", () => {
    // A feature with no rule makes a program `unknown`, which is correct and is
    // not a place to leave things: the detector and the policy are meant to
    // move together.
    const ruled = new Set(SUPPORT_RULES.map((rule) => rule.feature));
    const missing = FEATURES.map((feature) => feature.name).filter(
      (name) => !ruled.has(name),
    );
    expect(
      missing,
      "features the representability policy has no rule for",
    ).toEqual([]);
  });

  it("has no support rule for a feature the detector cannot find", () => {
    const detectable = new Set(FEATURES.map((feature) => feature.name));
    const orphaned = SUPPORT_RULES.map((rule) => rule.feature).filter(
      (name) => !detectable.has(name),
    );
    expect(orphaned, "rules for constructs nothing detects").toEqual([]);
  });

  it("keeps floating point and ALTER out of the language, with reasons", () => {
    expect(supportFor("comp-float")?.support).toBe("unsupported-by-design");
    expect(supportFor("alter")?.support).toBe("unsupported-by-design");
    expect(supportFor("usage-pointer")?.support).toBe("unsupported-by-design");
  });

  it("claims line-sequential only because the emitter really produces it", () => {
    /*
     * The regression this file is most for, in its second form.
     *
     * This rule said `supported` once on the strength of `LINE SEQUENTIAL`
     * appearing in the repository — in five hand-written reference modules
     * under `runtime/`, never from the emitter — and it inflated the X-COBOL
     * figure by 155 files. It is `supported` again now, and the difference is
     * that the compiler backs it.
     *
     * So the assertion is the fact rather than the string: ask the compiler for
     * a line-sequential file and check what it emits. A rule that flips to
     * `supported` without the emitter following fails here.
     */
    expect(supportFor("file-line-sequential")?.support).toBe("supported");

    const emitted = compile(
      `module Feed;

record FeedLine {
  feedAccount: string<10>;
}

file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
      { sourceFile: "feed.bank.ts" },
    );
    expect(
      emitted.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
    expect(emitted.cobol).toContain("ORGANIZATION IS LINE SEQUENTIAL");
  });

  it("takes the pessimistic verdict when a program mixes support levels", () => {
    // One `ALTER` outranks any amount of supported material: the program is not
    // expressible, and an optimistic percentage would read as a migration
    // estimate.
    expect(classifyProgram({ move: 9, alter: 1 }).verdict).toBe(
      "unsupported-by-design",
    );
    expect(classifyProgram({ move: 9, "file-relative": 1 }).verdict).toBe(
      "representable-with-adaptation",
    );
    expect(classifyProgram({ move: 9, "go-to": 1 }).verdict).toBe(
      "representable-with-adaptation",
    );
    expect(classifyProgram({ move: 9, compute: 2 }).verdict).toBe(
      "fully-representable",
    );
  });

  it("calls a program with no detected construct unknown, not representable", () => {
    // Eighty-four X-COBOL files were six-line teaching fragments. No evidence is
    // not a pass.
    expect(classifyProgram({}).verdict).toBe("unknown");
  });

  it("calls a program with an unrecognised construct unknown", () => {
    const verdict = classifyProgram({ "some-future-verb": 1 });
    expect(verdict.verdict).toBe("unknown");
    expect(verdict.unclassified).toEqual(["some-future-verb"]);
  });
});

describe("applicability of an external task", () => {
  it("excludes IEEE floating point by design", () => {
    const verdict = classifyTask("05 L-THRESHOLD COMP-2.");
    expect(verdict.applicability).toBe("unsupported-by-design");
    expect(verdict.unsupported?.fundamental).toBe(true);
  });

  it("excludes a fixed interface that leaves no room for the transaction contract", () => {
    const verdict = classifyTask(
      "LINKAGE SECTION.\n01 LINKED-ITEMS.\n  05 L-N PIC S9(10).\n  05 RESULT PIC 9.",
    );
    expect(verdict.applicability).toBe("unsupported-by-design");
  });

  it("decides applicability without looking for an implementation", () => {
    /*
     * The defect this signature exists to prevent. `classifyTask` used to take
     * a `hasImplementation` flag and answer `applicable` when it was true, so
     * "applicable" meant "somebody has done it" and `pass / applicable` could
     * only ever be 100%. There is now no way to tell it about a solution.
     */
    expect(classifyTask("Add two numbers.").applicability).toBe("applicable");
  });

  it("takes a recorded blocker as the reason a task is not applicable", () => {
    expect(
      classifyTask("Add two numbers.", "benchmark-ambiguous").applicability,
    ).toBe("benchmark-ambiguous");
    expect(classifyTask("Add two numbers.", "language-gap").applicability).toBe(
      "unsupported-not-yet-implemented",
    );
  });

  it("excludes randomness in every word form the corpus uses", () => {
    /*
     * `\brandom\b` matched `random seed` and missed `Randomly assign` and
     * `randomized`, so seven CobolCodeBench tasks with one requirement were
     * split across two categories by an accident of wording.
     */
    for (const text of [
      "Generate a random sales quantity",
      "Randomly assign each task to an employee",
      "Generate randomized stock prices",
      "Randomly generate a weather condition",
      "shuffle the deck",
    ]) {
      expect(classifyTask(text).applicability, text).toBe(
        "unsupported-by-design",
      );
    }
    // A COBOL file organization is not a random source.
    expect(
      classifyTask("The file uses random access by key.").applicability,
    ).toBe("applicable");
  });

  it("decides line-sequential from the data, not from the file name", () => {
    // Nineteen CobolCodeBench tasks name their files `task_func23_inp`, with no
    // extension to match on. The newline in the payload is the fact.
    expect(needsLineSequential([{ task_func23_inp: "0001\n0002\n" }])).toBe(
      true,
    );
    expect(needsLineSequential([{ "fixed.dat": "00010002" }])).toBe(false);
  });

  it("gives every applicability rule a reason and an honest desirability", () => {
    for (const rule of APPLICABILITY_RULES) {
      expect(rule.reason.length, rule.construct).toBeGreaterThan(60);
      expect(typeof rule.desirable).toBe("boolean");
    }
  });
});

describe("the corpus lock", () => {
  const lock: CorpusLock = {
    version: 1,
    corpora: [
      {
        id: "b",
        revision: "r2",
        retrieved: "2026-08-08",
        licence: "MIT",
        files: [{ path: "z", sha256: hashBytes("z"), bytes: 1 }],
      },
      {
        id: "a",
        revision: "r1",
        retrieved: "2026-08-08",
        licence: "MIT",
        files: [
          { path: "y", sha256: hashBytes("y"), bytes: 1 },
          { path: "x", sha256: hashBytes("x"), bytes: 1 },
        ],
      },
    ],
  };

  it("serialises in a stable order so the hash identifies the corpora", () => {
    const json = stableLockJson(lock);
    expect(json.indexOf('"a"')).toBeLessThan(json.indexOf('"b"'));
    expect(json.indexOf('"x"')).toBeLessThan(json.indexOf('"y"'));

    const shuffled: CorpusLock = {
      version: 1,
      corpora: [...lock.corpora].reverse(),
    };
    expect(lockHash(shuffled)).toBe(lockHash(lock));
  });

  it("refuses a cache whose bytes are not what was pinned", () => {
    const locked = lock.corpora[1]!;
    const good = new Map([
      ["x", new TextEncoder().encode("x")],
      ["y", new TextEncoder().encode("y")],
    ]);
    expect(verifyLock(locked, good)).toEqual([]);

    const tampered = new Map(good);
    tampered.set("x", new TextEncoder().encode("q"));
    expect(verifyLock(locked, tampered)[0]).toMatch(/hashes to/);

    const missing = new Map(good);
    missing.delete("y");
    expect(verifyLock(locked, missing)[0]).toMatch(/locked and missing/);
  });
});

describe("the COBOL feature detector", () => {
  it("does not treat a hyphen as a word boundary", () => {
    // `\bCOMP\b` matches inside `WS-COMP-CODE`, because a regular expression
    // ends a word at the hyphen and COBOL does not.
    expect(
      detectFeatures("       01 WS-COMP-CODE PIC X.")["comp-binary"],
    ).toBeUndefined();
    expect(
      detectFeatures("       01 WS-N PIC S9(4) COMP.")["comp-binary"],
    ).toBe(1);
  });

  it("keeps COMP-3 and COMP-1 out of the binary bucket", () => {
    const packed = detectFeatures("       01 A PIC S9(5) COMP-3.");
    expect(packed["comp-3"]).toBe(1);
    expect(packed["comp-binary"]).toBeUndefined();

    const float = detectFeatures("       01 A COMP-2.");
    expect(float["comp-float"]).toBe(1);
    expect(float["comp-binary"]).toBeUndefined();
  });

  it("ignores what a comment line says", () => {
    expect(
      detectFeatures("      * ALTER THE PARAGRAPH TO SOMETHING")["alter"],
    ).toBeUndefined();
    expect(detectFeatures("           ALTER A TO PROCEED TO B.")["alter"]).toBe(
      1,
    );
  });

  it("reads free-format source rather than truncating it at column 72", () => {
    // Much of what is on GitHub is free format, and reading it as fixed throws
    // away everything past column 72 — which under-reports rather than fails.
    const free = `IDENTIFICATION DIVISION.\nPROGRAM-ID. X.\nPROCEDURE DIVISION.\n    INSPECT WS-A TALLYING WS-N FOR ALL "X".\n`;
    expect(detectFeatures(free)["inspect"]).toBe(1);
  });
});
