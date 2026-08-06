import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { KEYWORDS } from "../packages/parser/src/index";
import { EXAMPLES } from "../packages/playground/src/examples";
import {
  PLAYGROUND_KEYWORDS,
  PLAYGROUND_TYPES,
} from "../packages/playground/src/bankts-language";

/**
 * The surfaces a reader meets before the compiler: the playground highlighter,
 * the VS Code grammar, and the playground's example picker.
 *
 * None of them is exercised by compiling anything, so each can fall behind the
 * language silently. These tests compare them against the compiler itself.
 */

/**
 * The lexer, the playground highlighter, and the VS Code grammar must agree on
 * what a keyword is.
 *
 * Highlighting that lags the lexer is how a supported keyword ends up looking
 * like an undefined name in the editor — which happened to `cursor` and
 * `sensitive`, both of which the compiler accepted while both highlighters
 * rendered them as plain identifiers. Nothing caught it, because nothing
 * compared the three lists.
 */

/** Keywords the VS Code grammar matches, read from the shipped grammar file. */
function grammarKeywords(): Set<string> {
  const grammar = readFileSync(
    "packages/vscode-extension/syntaxes/bankts.tmLanguage.json",
    "utf8",
  );
  const found = new Set<string>();

  for (const match of grammar.matchAll(/\\\\b\(([A-Za-z|]+)\)\\\\b/g)) {
    for (const word of match[1]!.split("|")) {
      found.add(word);
    }
  }

  return found;
}

describe("keyword coverage", () => {
  // Type names are reserved words the playground colours as types rather than
  // as keywords, which is a presentation choice, not a coverage gap.
  const highlighted = new Set([...PLAYGROUND_KEYWORDS, ...PLAYGROUND_TYPES]);

  it("highlights every keyword the lexer reserves, in the playground", () => {
    const missing = [...KEYWORDS].filter(
      (keyword) => !highlighted.has(keyword),
    );

    expect(missing, "playground highlighting is missing keywords").toEqual([]);
  });

  it("highlights every keyword the lexer reserves, in the extension", () => {
    const grammar = grammarKeywords();
    const missing = [...KEYWORDS].filter((keyword) => !grammar.has(keyword));

    expect(missing, "the VS Code grammar is missing keywords").toEqual([]);
  });

  /**
   * The other direction matters too: a word highlighted as a keyword the lexer
   * does not reserve tells the reader it is special when it is not.
   */
  it("highlights nothing the lexer does not reserve", () => {
    const extra = [...highlighted].filter((keyword) => !KEYWORDS.has(keyword));

    expect(extra, "playground highlighting invents keywords").toEqual([]);
  });
});

/**
 * Every checked-in example must be described in the playground.
 *
 * The playground globs `examples/` at build time, so a new example appears in
 * the picker whether or not anyone wrote a title for it — falling back to a
 * directory name and an empty description, sorted last. The examples that
 * needed explaining most were the ones that had none.
 */
describe("playground example coverage", () => {
  it("gives every example a title and a description", () => {
    const undescribed = EXAMPLES.filter(
      (example) => example.blurb.length === 0 || example.title === example.id,
    ).map((example) => example.id);

    expect(undescribed, "add these to META in examples.ts").toEqual([]);
  });

  it("orders them deterministically", () => {
    const ids = EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });
});

/**
 * The VS Code extension, held to being able to start.
 *
 * It resolves the language server to `<extensionPath>/server/bin.js` and
 * nothing built that file. The directory did not exist. So the extension could
 * only start for a user who had set `banklang.server.path` by hand, and the
 * repository's own status page said it "builds and typechecks in CI" — which
 * was true, and told nobody anything, because neither of those runs it.
 *
 * The same shape as `pnpm zos:kit`, which built cleanly and threw every time it
 * was asked to do its job. A build is not a test.
 */
describe("the VS Code extension", () => {
  const manifest = JSON.parse(
    readFileSync("packages/vscode-extension/package.json", "utf8"),
  ) as { main: string; scripts: Record<string, string> };
  const source = readFileSync(
    "packages/vscode-extension/src/extension.ts",
    "utf8",
  );

  /** Every path the extension resolves at run time, relative to itself. */
  const resolved = [
    ...source.matchAll(/join\(\s*context\.extensionPath\s*,\s*([^)]+)\)/g),
  ].map((match) =>
    match[1]!
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .join("/"),
  );

  it("resolves a server path", () => {
    expect(resolved).toEqual(["server/bin.js"]);
  });

  it("has a build script producing everything it resolves", () => {
    const scripts = Object.values(manifest.scripts).join(" ");

    for (const path of [...resolved, manifest.main.replace(/^\.\//, "")]) {
      expect(
        scripts,
        `The extension loads ${path} at run time and no build script writes it, so activation fails on a clean install.`,
      ).toContain(path);
    }
  });
});
