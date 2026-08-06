import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import {
  DIAGNOSTICS,
  explainDiagnostic,
  namespaceOf,
} from "../packages/diagnostics/src/index";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Every `BANK-...` identifier literal in compiler source.
 *
 * Scans all source files rather than each package entry point, because
 * diagnostics are raised from helper modules and through local helper
 * functions, not only from `createDiagnostic({ id: ... })` call sites.
 */
function emittedDiagnosticIds(): Set<string> {
  const ids = new Set<string>();

  for (const pkg of readdirSync("packages")) {
    // The catalogue package lists every identifier by definition.
    if (pkg === "diagnostics") {
      continue;
    }

    let files: string[];
    try {
      files = sourceFiles(join("packages", pkg, "src"));
    } catch {
      continue;
    }

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/"(BANK-[A-Z]+-\d+)"/g)) {
        ids.add(match[1]!);
      }
    }
  }

  return ids;
}

describe("diagnostic catalogue", () => {
  it("documents every diagnostic the compiler can emit", () => {
    const undocumented = [...emittedDiagnosticIds()]
      .filter((id) => !explainDiagnostic(id))
      .sort();

    expect(
      undocumented,
      `Add these to packages/diagnostics/src/index.ts and docs/diagnostics.md: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("marks a catalogued diagnostic as implemented only if it is emitted", () => {
    const emitted = emittedDiagnosticIds();
    const wronglyMarked = DIAGNOSTICS.filter(
      (doc) => doc.implemented && !emitted.has(doc.id),
    ).map((doc) => doc.id);

    expect(
      wronglyMarked,
      `These claim to be implemented but no compiler package emits them: ${wronglyMarked.join(", ")}`,
    ).toEqual([]);
  });

  it("finds at least the diagnostics the analyzer is known to raise", () => {
    const emitted = emittedDiagnosticIds();

    for (const id of [
      "BANK-TXN-001",
      "BANK-AUD-001",
      "BANK-AUD-003",
      "BANK-LED-001",
      "BANK-FILE-001",
      "BANK-GEN-004",
    ]) {
      expect(
        emitted,
        `${id} should be emitted by a compiler package`,
      ).toContain(id);
    }
  });

  it("uses a known namespace for every catalogued id", () => {
    for (const doc of DIAGNOSTICS) {
      expect(
        namespaceOf(doc.id),
        `${doc.id} has an unknown namespace`,
      ).not.toBe(null);
    }
  });

  it("has no duplicate identifiers", () => {
    const ids = DIAGNOSTICS.map((doc) => doc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a title, explanation, and remediation", () => {
    for (const doc of DIAGNOSTICS) {
      expect(doc.title.length, `${doc.id} title`).toBeGreaterThan(0);
      expect(doc.explanation.length, `${doc.id} explanation`).toBeGreaterThan(
        20,
      );
      expect(doc.remediation.length, `${doc.id} remediation`).toBeGreaterThan(
        0,
      );
    }
  });

  it("documents every id that docs/diagnostics.md lists", () => {
    const doc = readFileSync("docs/diagnostics.md", "utf8");
    const documented = [...doc.matchAll(/`(BANK-[A-Z]+-\d+)`/g)].map(
      (match) => match[1]!,
    );
    const missing = [...new Set(documented)]
      .filter((id) => !explainDiagnostic(id))
      .sort();

    expect(
      missing,
      `docs/diagnostics.md lists these but the catalogue does not: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("bankc explain", () => {
  it("prints a single diagnostic", () => {
    const result = runBankc(["explain", "BANK-LED-001"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("BANK-LED-001  Unbalanced posting");
    expect(result.stdout).toContain("Remediation:");
  });

  it("accepts a lowercase identifier", () => {
    expect(runBankc(["explain", "bank-txn-001"]).exitCode).toBe(0);
  });

  it("lists the catalogue when given no identifier", () => {
    const result = runBankc(["explain"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("BankLang diagnostic catalogue");
    expect(result.stdout).toContain("BANK-GEN-004");
    expect(result.stdout).toContain("[reserved]");
  });

  it("fails on an unknown identifier", () => {
    const result = runBankc(["explain", "BANK-NOPE-999"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown diagnostic");
  });

  it("is listed in the help output", () => {
    expect(runBankc(["--help"]).stdout).toContain("explain");
  });
});
