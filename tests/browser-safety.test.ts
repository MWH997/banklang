import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Packages that must stay free of Node built-ins so the compiler can run in a
 * browser. The playground depends on this being true; if it ever stops being
 * true, the playground build breaks in a confusing way rather than here.
 */
const BROWSER_SAFE_PACKAGES = [
  "ast",
  "parser",
  "typechecker",
  "ir",
  "cobol-ir",
  "cobol-backend",
  "copybook",
  "semantic-analyzer",
  "verifier",
  "diagnostics",
  "compiler",
  "formatter",
  "precompiler",
  // The conformance linter reads artifacts as text and knows nothing about
  // where they came from, so it runs wherever the compiler does.
  "conformance-lint",
  // And the z/OS semantics pass, for the same reason and from the same text.
  "zos-lint",
  // And the migration reader is the same shape from the other direction: it
  // takes COBOL as a string and reports what is in it. Nothing about reading a
  // program needs a file system, and keeping it out of one means the
  // playground could show an inventory of a program somebody pastes in.
  "migration-analysis",
  // The zUnit generator writes three artifacts as strings and leaves putting
  // them anywhere to its caller, so it runs wherever the compiler does.
  "zunit",
  // The COBOL interpreter, which is the reason this rule matters most: it is
  // what lets the playground run what it compiled. A file system read anywhere
  // in it would not fail here — it would fail as a blank Run tab in somebody
  // else's browser.
  "cobol-runtime",
];

/** Packages allowed to touch the file system and process. */
const NODE_PACKAGES = ["bankc-cli", "config", "language-server"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

describe("compiler core is browser safe", () => {
  for (const pkg of BROWSER_SAFE_PACKAGES) {
    it(`${pkg} imports no Node built-in`, () => {
      const offenders: string[] = [];

      for (const file of sourceFiles(join("packages", pkg, "src"))) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(
          /from\s+["'](node:[^"']+|fs|path|os|child_process|crypto)["']/g,
        )) {
          offenders.push(`${file} imports ${match[1]}`);
        }
        if (/\bprocess\.(env|cwd|argv|exit)\b/.test(source)) {
          offenders.push(`${file} uses process`);
        }
      }

      expect(
        offenders,
        `${pkg} must stay browser safe:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }

  /**
   * Three directories under `packages/` hold no compiler.
   *
   * `playground` and `vscode-extension` are applications that consume it.
   * `site` is the landing page's template, stylesheet and Open Graph card —
   * HTML, CSS and a PNG, with no TypeScript to be browser safe or otherwise.
   * Everything else is a package the compiler is made of, and every one of
   * those has to be classified here.
   */
  it("covers every package that holds compiler code", () => {
    const notCompiler = new Set(["playground", "vscode-extension", "site"]);
    const packages = readdirSync("packages", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !notCompiler.has(name));

    expect([...BROWSER_SAFE_PACKAGES, ...NODE_PACKAGES].sort()).toEqual(
      packages.sort(),
    );
  });
});
