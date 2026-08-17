import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SERVER_VERSION } from "../packages/language-server/src/index";

/**
 * Every place this repository states its own version, in one list.
 *
 * The individual comparisons already existed and each was correct:
 * `tests/vscode-extension.test.ts` holds the extension manifest and the
 * language server to the root manifest, and `tests/documentation.test.ts`
 * holds `CITATION.cff` and the changelog. What none of them held was the
 * *list*. A sixth version-bearing file could be added tomorrow and every
 * assertion in this repository would still pass while a published surface
 * quietly named the wrong release.
 *
 * So this is the enumeration, and it is deliberately written as data. Adding a
 * file that states the version means adding it here; the cost of that is one
 * line, and the cost of not having it is a marketplace listing or a citation
 * naming a version nobody released.
 *
 * The version itself is never written down here. Every entry is compared
 * against `package.json`, so cutting a release changes one number and this
 * file has nothing to update.
 */
const ROOT = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

/** Read one version out of a file with a pattern, or fail saying which. */
function stated(path: string, pattern: RegExp): string {
  const found = pattern.exec(readFileSync(path, "utf8"))?.[1];
  expect(
    found,
    `${path} no longer states a version matching ${String(pattern)}`,
  ).toBeDefined();
  return found as string;
}

describe("every surface that states BankLang's version", () => {
  const surfaces: [string, () => string][] = [
    [
      "packages/vscode-extension/package.json",
      () =>
        (
          JSON.parse(
            readFileSync("packages/vscode-extension/package.json", "utf8"),
          ) as { version: string }
        ).version,
    ],
    ["the language server's initialize reply", () => SERVER_VERSION],
    ["CITATION.cff", () => stated("CITATION.cff", /^version:\s*(\S+)$/m)],
    [
      "the extension's own changelog",
      () =>
        stated(
          "packages/vscode-extension/CHANGELOG.md",
          /^## \[(\d+\.\d+\.\d+)\]/m,
        ),
    ],
    [
      "the changelog's newest version section",
      () => stated("CHANGELOG.md", /^## \[(\d+\.\d+\.\d+)\] —/m),
    ],
    [
      "the doctor output printed in docs/toolchain.md",
      () => stated("docs/toolchain.md", /^bankc: (\d+\.\d+\.\d+)$/m),
    ],
  ];

  for (const [name, read] of surfaces) {
    it(`${name} names the version package.json names`, () => {
      expect(read()).toBe(ROOT.version);
    });
  }

  /**
   * A workspace package that declares a version at all must declare this one.
   *
   * Every package here is `private: true` and all but the extension omit
   * `version` entirely, which is the right shape: the repository is the unit of
   * release. This catches the case where one of them grows a version field,
   * at which point it either tracks the release or it is a second number
   * nobody reconciles.
   */
  it("finds no workspace package naming a different version", () => {
    const wrong: string[] = [];
    for (const entry of readdirSync("packages", { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = `packages/${entry.name}/package.json`;
      let manifest: { version?: string };
      try {
        manifest = JSON.parse(readFileSync(path, "utf8")) as {
          version?: string;
        };
      } catch {
        continue;
      }
      if (manifest.version !== undefined && manifest.version !== ROOT.version) {
        wrong.push(`${path} says ${manifest.version}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The tag a release would be cut at, against the version being released.
   *
   * `release.yml` derives the version from the tag by stripping `v`, so a tag
   * that does not match the manifests builds a release whose artifacts disagree
   * with its own name. Nothing can check the future tag, but the shape it must
   * take is worth stating where somebody cutting a release will read it.
   */
  it("is a version a `vX.Y.Z` tag can name", () => {
    expect(ROOT.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
