import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `.env.example` against a working `.env`.
 *
 * The two had drifted apart and nothing noticed. `.env` still held ten
 * variables for a model-delegation setup that was removed from the repository
 * on 2026-08-06, including a live API key, and it had since gained five
 * Cloudflare credentials that `.env.example` documented nowhere. So the tracked
 * file described a setup nobody had, and the untracked one held a setup nobody
 * could reproduce.
 *
 * That is the failure worth catching. Not a missing value, since `.env` is private
 * and must stay that way, but a **key** that exists locally and is documented
 * nowhere, which is a setup step the next person has to guess at.
 *
 * Skips when there is no `.env`, which is CI and a fresh clone. A skipped run
 * here means unchecked, not passing.
 */

const KEY = /^([A-Za-z_][A-Za-z0-9_]*)=/gm;

function keysOf(text: string): string[] {
  return [...text.matchAll(KEY)].map((match) => match[1] ?? "");
}

const example = readFileSync(".env.example", "utf8");

describe("the example environment file", () => {
  it("documents at least the toolchain variables", () => {
    expect(keysOf(example)).toContain("GNUCOBOL_COBC_PATH");
    expect(keysOf(example).length).toBeGreaterThan(2);
  });

  /**
   * Every value empty, except the one that is a documented default rather than
   * a secret. A tracked file is the wrong place for a credential, and an
   * example that ships one is how a credential reaches a public repository.
   */
  it("carries no value that could be a credential", () => {
    for (const line of example.split("\n")) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const [, key, value] = match;
      if (key === "IBM_ENTERPRISE_COBOL_VALIDATION_ENABLED") {
        expect(value).toBe("false");
        continue;
      }
      expect(value, `${key ?? ""} has a value in .env.example`).toBe("");
    }
  });

  it("names no model or vendor, which is what it used to configure", () => {
    expect(example).not.toMatch(/gemini|gemma|ollama|codex|openai|anthropic/i);
  });
});

describe("a working .env, where one exists", () => {
  const path = ".env";

  it.skipIf(!existsSync(path))(
    "declares no key the example does not document",
    () => {
      const documented = new Set(keysOf(example));
      const undocumented = keysOf(readFileSync(path, "utf8")).filter(
        (key) => !documented.has(key),
      );

      expect(
        undocumented,
        "these are set locally and documented in no tracked file; add them to .env.example, with empty values",
      ).toEqual([]);
    },
  );

  it.skipIf(!existsSync(path))(
    "still has somewhere to put every documented key",
    () => {
      // The other direction, and a warning rather than a rule: a documented key
      // absent from `.env` is usually just a facility this machine does not
      // use. What must hold is that the example is not describing a variable
      // the project abandoned, which is how the drift started.
      const local = new Set(keysOf(readFileSync(path, "utf8")));
      const abandoned = keysOf(example).filter((key) => !local.has(key));
      expect(abandoned.length).toBeLessThan(keysOf(example).length);
    },
  );
});
