import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  emptyIbmResult,
  hashManifest,
  ibmClaimSentence,
  ibmValidationStatus,
  IbmResultError,
  IBM_RESULT_VERSION,
  parseIbmResult,
} from "../packages/horizontal-validation/src/index";
import { bundleCases, buildZosKit } from "../tools/zos-kit";
import { IBM_RESULT_PATH } from "../tools/horizontal-report";

/**
 * The gate that decides whether this repository may say an IBM run happened.
 *
 * The project's standing limit — everything ends at GnuCOBOL — was a sentence
 * typed into the website, the README, the validation page and thirteen evidence
 * bundles. Every one of those was correct and every one of them was a promise
 * that somebody would keep typing it. This suite is the other arrangement: the
 * claim is computed from what is on disk, and the absence of evidence has only
 * one reachable sentence.
 */

const MANIFEST_HASH = "a".repeat(64);

const executed = (
  overrides: Record<string, unknown> = {},
  cases: unknown[] = [
    {
      id: "case-accountp",
      program: "ACCOUNTP",
      kind: "execute",
      returnCode: 0,
      matchedExpected: true,
    },
  ],
): string =>
  JSON.stringify({
    version: IBM_RESULT_VERSION,
    executed: true,
    compiler: "IBM Enterprise COBOL",
    version_compiler: "6.4",
    platform: "z/OS 2.5",
    banklangVersion: "0.9.0",
    banklangCommit: "0".repeat(40),
    bundleManifestSha256: MANIFEST_HASH,
    date: "2026-08-09",
    runBy: "somebody with access",
    cases,
    ...overrides,
  });

describe("the claim gate", () => {
  it("says NOT YET PERFORMED when nothing has been imported", () => {
    const status = ibmValidationStatus(null);
    expect(status.performed).toBe(false);
    expect(ibmClaimSentence(status)).toBe(
      "Native IBM Enterprise COBOL validation: NOT YET PERFORMED.",
    );
  });

  /**
   * The failure this exists for. A template committed by somebody being helpful
   * is a file that parses, and a generator that only checked for a file would
   * read it as a run.
   */
  it("refuses a template as evidence of a run", () => {
    const template = emptyIbmResult("0.9.0", "abc123", MANIFEST_HASH, [
      { id: "case-accountp", program: "ACCOUNTP", kind: "execute" },
    ]);
    const status = ibmValidationStatus(template);
    expect(status.performed).toBe(false);
    expect(status.performed === false && status.reason).toContain("template");
    expect(ibmClaimSentence(status)).toContain("NOT YET PERFORMED");
  });

  /** An unreadable result is an unknown one, and an unknown is not a run. */
  it("refuses a result it cannot parse rather than ignoring it", () => {
    for (const text of ["", "{", "[]", '{"version": 99}']) {
      const status = ibmValidationStatus(text);
      expect(status.performed).toBe(false);
      expect(ibmClaimSentence(status)).toContain("NOT YET PERFORMED");
    }
  });

  it("reports a real run in the terms the run supports", () => {
    const status = ibmValidationStatus(
      executed({}, [
        {
          id: "case-accountp",
          program: "ACCOUNTP",
          kind: "execute",
          returnCode: 0,
          matchedExpected: true,
        },
        {
          id: "case-onlineen",
          program: "ONLINEEN",
          kind: "compile",
          returnCode: 0,
          severity: "I",
        },
        {
          id: "case-statemen",
          program: "STATEMEN",
          kind: "execute",
          returnCode: 8,
          matchedExpected: false,
        },
      ]),
    );
    expect(status.performed).toBe(true);
    if (!status.performed) {
      return;
    }
    expect(status.compiled).toBe(1);
    expect(status.executed).toBe(2);
    expect(status.matched).toBe(1);
    expect(status.failed).toBe(1);
    const sentence = ibmClaimSentence(status);
    expect(sentence).toContain("IBM Enterprise COBOL 6.4 on z/OS 2.5");
    expect(sentence).not.toContain("NOT YET PERFORMED");
  });

  /**
   * Nothing in the repository claims an IBM run, and that is checked rather
   * than believed. If a result file is ever imported this test is what says the
   * rest of the documentation has to be revisited with it.
   */
  it("has no imported IBM result in this checkout", () => {
    expect(existsSync(IBM_RESULT_PATH)).toBe(false);
  });
});

describe("the result schema", () => {
  it("rejects a missing or empty required field", () => {
    for (const field of [
      "compiler",
      "platform",
      "banklangVersion",
      "banklangCommit",
      "bundleManifestSha256",
      "date",
      "runBy",
    ]) {
      expect(() =>
        parseIbmResult(executed({ [field]: "" }), "result.json"),
      ).toThrow(IbmResultError);
    }
  });

  it("rejects a case whose kind is not one of the two", () => {
    expect(() =>
      parseIbmResult(
        executed({}, [
          { id: "a", program: "A", kind: "ran-it", returnCode: 0 },
        ]),
        "result.json",
      ),
    ).toThrow(/kind must be/);
  });

  /**
   * An execution that reports no comparison established that the program ran,
   * not that it ran correctly. Letting that field be absent is how a bundle run
   * turns into a stronger claim than it earned.
   */
  it("rejects an execute case that does not say whether output matched", () => {
    expect(() =>
      parseIbmResult(
        executed({}, [
          { id: "a", program: "A", kind: "execute", returnCode: 0 },
        ]),
        "result.json",
      ),
    ).toThrow(/matched/);
  });

  it("rejects a run that reports no cases", () => {
    expect(() => parseIbmResult(executed({}, []), "result.json")).toThrow(
      /no cases/,
    );
  });

  it("rejects a severity outside the compiler's own set", () => {
    expect(() =>
      parseIbmResult(
        executed({}, [
          {
            id: "a",
            program: "A",
            kind: "compile",
            returnCode: 0,
            severity: "X",
          },
        ]),
        "result.json",
      ),
    ).toThrow(/severity/);
  });

  it("accepts a well-formed result and keeps every case", () => {
    const result = parseIbmResult(executed(), "result.json");
    expect(result.executed).toBe(true);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.matchedExpected).toBe(true);
  });
});

describe("the bundle a run is performed against", () => {
  const root = join("dist", "zos-test");

  it("ships a manifest naming every member with its bytes", () => {
    buildZosKit(root);
    const manifest = JSON.parse(
      readFileSync(join(root, "manifest.json"), "utf8"),
    ) as {
      target: string;
      executedBy: string | null;
      members: { path: string; sha256: string; bytes: number }[];
      cases: { id: string; kind: string }[];
    };

    expect(manifest.target).toBe("IBM Enterprise COBOL for z/OS 6.4");
    // The machine-readable half of "nothing here has been run".
    expect(manifest.executedBy).toBeNull();
    expect(manifest.members.length).toBeGreaterThan(100);
    for (const member of manifest.members) {
      expect(member.sha256).toMatch(/^[0-9a-f]{64}$/);
      const bytes = readFileSync(join(root, member.path));
      expect(bytes.byteLength).toBe(member.bytes);
    }
  });

  /** The template must describe the bundle it was written beside. */
  it("ships a template pinned to the manifest it belongs to", () => {
    buildZosKit(root);
    const manifest = readFileSync(join(root, "manifest.json"), "utf8");
    const template = readFileSync(join(root, "result-template.json"), "utf8");
    const parsed = parseIbmResult(template, "result-template.json");

    expect(parsed.executed).toBe(false);
    expect(parsed.bundleManifestSha256).toBe(hashManifest(manifest));
    expect(ibmValidationStatus(template).performed).toBe(false);
  });

  /**
   * A program needing a CICS region, a Db2 plan or an IMS PSB cannot execute
   * from a batch bundle, and a compile reported as an execution is the easiest
   * way to overstate the run. The category is decided from the program text.
   */
  it("asks only for a compile where a subsystem would be needed", () => {
    const cases = bundleCases([
      { name: "PLAINBAT", content: "       DISPLAY 'HELLO'." },
      {
        name: "ONLINEEN",
        content: "       EXEC CICS LINK PROGRAM('X') END-EXEC.",
      },
      { name: "BRANCHAC", content: "       EXEC SQL OPEN C END-EXEC." },
      { name: "IMSTHING", content: "       EXEC DLI GU SEGMENT(A) END-EXEC." },
    ]);
    expect(cases.map((entry) => `${entry.program}:${entry.kind}`)).toEqual([
      "BRANCHAC:compile",
      "IMSTHING:compile",
      "ONLINEEN:compile",
      "PLAINBAT:execute",
    ]);
  });
});
