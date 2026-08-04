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
];

/** Packages allowed to touch the file system and process. */
const NODE_PACKAGES = ["bankc-cli"];

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

  it("covers every package except the CLI and playground", () => {
    const packages = readdirSync("packages", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== "playground");

    expect([...BROWSER_SAFE_PACKAGES, ...NODE_PACKAGES].sort()).toEqual(
      packages.sort(),
    );
  });
});
