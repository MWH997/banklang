import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LanguageServer,
  SERVER_VERSION,
  type JsonRpcMessage,
} from "../packages/language-server/src/index";
import {
  ICON_PATH,
  PALETTE,
  SIZE,
  faviconColours,
  renderIcon,
} from "../tools/build-icon";
import { FORBIDDEN, REQUIRED, problems } from "../tools/build-vsix";

/**
 * The extension as a published thing, rather than as source that compiles.
 *
 * It has been built and typechecked in CI since it was written, and for a long
 * time was never packaged, so every field a marketplace listing is made of was
 * either absent or unexamined. What follows holds the manifest, the icon and
 * the listing copy to the repository they describe.
 *
 * Packaging itself is a CI step (`pnpm build:vsix`), not a test: it needs vsce
 * and a zip reader, and it takes seconds rather than milliseconds. What is here
 * is everything that can be decided by reading files.
 */

const MANIFEST = JSON.parse(
  readFileSync("packages/vscode-extension/package.json", "utf8"),
) as Record<string, unknown> & {
  version: string;
  publisher: string;
  license: string;
  icon: string;
  engines: { vscode: string };
  repository: { url: string; directory: string };
  homepage: string;
};

const ROOT_MANIFEST = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
  license: string;
  homepage: string;
  repository: { url: string };
};

const README = readFileSync("packages/vscode-extension/README.md", "utf8");

describe("the extension manifest, as a marketplace listing", () => {
  it("names a publisher, without which nothing can be published", () => {
    // The one field here that is an account rather than a fact about the code:
    // it has to match a publisher registered on the marketplace before the
    // first publish, and cannot be changed afterwards.
    expect(MANIFEST.publisher).toBe("mwhassan");
  });

  /**
   * The extension bundles the compiler, so its version is the compiler's.
   *
   * Two numbers moving independently is not a cosmetic problem: it lets a user
   * read a diagnostic in the editor that `bankc` at the same version does not
   * produce, and gives them no way to tell which one is behind.
   */
  it("carries the compiler's version, because it carries the compiler", () => {
    expect(MANIFEST.version).toBe(ROOT_MANIFEST.version);
    expect(SERVER_VERSION).toBe(ROOT_MANIFEST.version);
  });

  it("reports that version to the editor on initialize", () => {
    const server = new LanguageServer();
    const reply = server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    })[0] as JsonRpcMessage;
    const result = reply.result as {
      serverInfo: { name: string; version: string };
    };
    expect(result.serverInfo.version).toBe(ROOT_MANIFEST.version);
  });

  it("names the changelog's version too", () => {
    const changelog = readFileSync(
      "packages/vscode-extension/CHANGELOG.md",
      "utf8",
    );
    expect(changelog).toContain(MANIFEST.version);
  });

  it("is under the licence the repository is under, and ships the text", () => {
    expect(MANIFEST.license).toBe(ROOT_MANIFEST.license);
    // vsce warns rather than fails without it, and the marketplace shows a
    // License tab that is empty. A copy, held to the original.
    expect(readFileSync("packages/vscode-extension/LICENSE", "utf8")).toBe(
      readFileSync("LICENSE", "utf8"),
    );
  });

  it("points at this repository, this subdirectory and this site", () => {
    expect(MANIFEST.repository.url).toBe(ROOT_MANIFEST.repository.url);
    expect(MANIFEST.repository.directory).toBe("packages/vscode-extension");
    expect(MANIFEST.homepage).toBe(ROOT_MANIFEST.homepage);
  });
});

/**
 * The listing copy.
 *
 * A marketplace page is read by people who have not seen the repository, which
 * makes it the surface where an overclaim does the most damage, and the one
 * furthest from anything that would catch it.
 */
describe("the listing", () => {
  it("makes the same GnuCOBOL statement every other surface makes", () => {
    expect(
      /No IBM\s+Enterprise\s+COBOL validation is claimed/i.test(
        README.replace(/\*\*/g, "").replace(/\s+/g, " "),
      ),
      "the marketplace page does not say that no IBM validation is claimed",
    ).toBe(true);
  });

  /**
   * The server advertises four capabilities. A listing that names a fifth is a
   * promise nothing keeps, so the words are checked against what `initialize`
   * actually returns rather than against a list written beside them.
   */
  it("claims no editor feature the server does not advertise", () => {
    const server = new LanguageServer();
    const reply = server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    })[0] as JsonRpcMessage;
    const advertised = (
      reply.result as { capabilities: Record<string, unknown> }
    ).capabilities;

    const claims: [string, string][] = [
      ["completion", "completionProvider"],
      ["go-to-definition", "definitionProvider"],
      ["rename", "renameProvider"],
      ["code action", "codeActionProvider"],
    ];

    for (const [word, capability] of claims) {
      if (advertised[capability] === true) {
        continue;
      }
      // Naming it in the sentence that says what is *absent* is the honest use.
      const sentences = README.split(/(?<=[.!?])\s+/).filter((sentence) =>
        sentence.toLowerCase().includes(word),
      );
      for (const sentence of sentences) {
        expect(
          /\bnot\b|\bdoes not\b|\bno\b/i.test(sentence),
          `the listing mentions ${word}, which the server does not provide: "${sentence.trim()}"`,
        ).toBe(true);
      }
    }
  });

  it("links only to absolute https, which is all the marketplace resolves", () => {
    // A relative link on a marketplace page resolves against the marketplace.
    // vsce rewrites some of them from `repository`; the ones it misses become
    // 404s on Microsoft's domain, which is a worse first impression than none.
    const links = [...README.matchAll(/\]\(([^)]+)\)/g)].map(
      (match) => match[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) {
      expect(link, `relative link on the marketplace page`).toMatch(
        /^https:\/\//,
      );
    }
  });

  it("sends a reader to the site rather than only to the repository", () => {
    expect(README).toContain("https://banklang.mwhassan.com/playground/");
    expect(README).toContain("https://banklang.mwhassan.com/docs/");
  });
});

/**
 * The icon.
 *
 * Generated rather than screenshotted, so it is held to the site's mark by a
 * comparison instead of by somebody remembering to re-export a PNG.
 */
describe("the icon", () => {
  const png = readFileSync(ICON_PATH);

  it("is what tools/build-icon.ts renders today", () => {
    expect(png.equals(renderIcon())).toBe(true);
  });

  it("is a PNG of at least the 128 square the marketplace requires", () => {
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR: width and height are the first two big-endian words of its data.
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(SIZE);
    expect(png.readUInt32BE(20)).toBe(SIZE);
    expect(SIZE).toBeGreaterThanOrEqual(128);
  });

  it("uses the site's palette and no other", () => {
    // The failure this prevents is a rebrand that moves the site and leaves the
    // extension on the old blue, in a shop window nobody on the project visits.
    expect(faviconColours()).toEqual([
      PALETTE.field,
      PALETTE.letter,
      PALETTE.rule,
    ]);
  });

  it("is the manifest's icon", () => {
    expect(MANIFEST.icon).toBe("icon.png");
    expect(
      ICON_PATH.endsWith(join("packages/vscode-extension", "icon.png")),
    ).toBe(true);
  });
});

/**
 * What goes in the archive.
 *
 * `pnpm build:vsix` reads the packaged file and applies these; these check the
 * rules themselves, which the packaging step cannot: a `problems()` that
 * returns nothing whatever it is given would let every green package through.
 */
describe("the rules the packaged extension is held to", () => {
  it("passes a correct listing of files", () => {
    expect(problems([...REQUIRED, "[Content_Types].xml"])).toEqual([]);
  });

  it("catches the bundle, the server or the icon going missing", () => {
    for (const required of REQUIRED) {
      const without = REQUIRED.filter((path) => path !== required);
      expect(problems(without)).toContainEqual(`missing: ${required}`);
    }
  });

  it("catches the source tree or node_modules being shipped", () => {
    for (const path of [
      "extension/src/extension.ts",
      "extension/node_modules/vscode-languageclient/package.json",
      "extension/tsconfig.tsbuildinfo",
    ]) {
      expect(problems([...REQUIRED, path])).toContainEqual(
        `should not be packaged: ${path}`,
      );
    }
    expect(FORBIDDEN.length).toBeGreaterThan(2);
  });

  it("keeps .vscodeignore and the rules from disagreeing", () => {
    const ignore = readFileSync(
      "packages/vscode-extension/.vscodeignore",
      "utf8",
    );
    expect(ignore).toContain("src/**");
    expect(ignore).toContain("node_modules/**");
  });
});
