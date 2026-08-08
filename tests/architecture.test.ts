import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

/**
 * The architecture page against the repository it describes.
 *
 * `docs/architecture.md` is where somebody goes to learn what the compiler is
 * made of, and it had drifted badly: it documented `packages/db2`,
 * `packages/cics`, `packages/vsam` and `packages/lsp`, none of which have ever
 * existed, while omitting twelve packages that do — including `cobol-runtime`,
 * the interpreter every example is executed against. A reader following it
 * would have gone looking for a layout nobody built.
 *
 * Prose can drift and a reviewer will not notice. A list can be checked, so
 * the two lists on that page are checked here in both directions, the way
 * `tests/grammar.test.ts` checks the published grammar against the lexer.
 */

const ARCHITECTURE = readFileSync("docs/architecture.md", "utf8");

/** Every `### `packages/x`` heading on the page, in order. */
function documentedPackages(): string[] {
  return [...ARCHITECTURE.matchAll(/^### `packages\/([a-z0-9-]+)`$/gm)].map(
    (match) => match[1] as string,
  );
}

/** Every directory in `packages/`, which is what the workspace globs. */
function workspacePackages(): string[] {
  return readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The bulleted `bankc ...` commands under the CLI section. */
function documentedCommands(): string[] {
  const section = /### `packages\/bankc-cli`([\s\S]*?)^### /m.exec(
    ARCHITECTURE,
  );
  if (!section?.[1]) {
    throw new Error(
      "architecture.md has no `packages/bankc-cli` section; the heading has moved.",
    );
  }
  return [...section[1].matchAll(/^- `bankc ([a-z-]+(?: [a-z-]+)?)/gm)].map(
    (match) => match[1] as string,
  );
}

/**
 * The commands `bankc` itself prints, as `<command>` or `<command> <sub>`.
 *
 * The help text lists arguments too — `check <project>`, `fmt <project|
 * file.cbl> [--check]` — and those are not commands. Every argument is written
 * in angle or square brackets and no command is, so the bare lowercase words
 * are the command and the rest is its usage.
 */
function helpCommands(): string[] {
  const help = runBankc([]).stdout;
  const commands = /^Commands:\n([\s\S]*?)\n\n/m.exec(help);
  if (!commands?.[1]) {
    throw new Error(
      "bankc's help has no `Commands:` block; renderHelp's shape has changed.",
    );
  }
  return commands[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      line
        .split(/\s+/)
        .filter((word) => /^[a-z-]+$/.test(word))
        .join(" "),
    );
}

describe("the architecture page's package list", () => {
  it("documents every package in the workspace", () => {
    const documented = new Set(documentedPackages());
    const missing = workspacePackages()
      .filter((name) => !documented.has(name))
      .sort();
    expect(
      missing,
      "these packages exist and docs/architecture.md does not describe them",
    ).toEqual([]);
  });

  it("documents no package that does not exist", () => {
    const workspace = new Set(workspacePackages());
    const invented = documentedPackages()
      .filter((name) => !workspace.has(name))
      .sort();
    expect(
      invented,
      "docs/architecture.md describes these and `packages/` has no such directory",
    ).toEqual([]);
  });

  it("describes each package once", () => {
    const seen = new Map<string, number>();
    for (const name of documentedPackages()) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const repeated = [...seen]
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
      .sort();
    expect(
      repeated,
      "docs/architecture.md has two sections for these packages",
    ).toEqual([]);
  });
});

describe("the architecture page's command list", () => {
  it("lists every command the CLI offers", () => {
    const documented = new Set(documentedCommands());
    const missing = helpCommands()
      .filter((command) => !documented.has(command))
      .sort();
    expect(
      missing,
      "`bankc` offers these and docs/architecture.md does not list them",
    ).toEqual([]);
  });

  it("lists no command the CLI does not offer", () => {
    const offered = new Set(helpCommands());
    const invented = documentedCommands()
      .filter((command) => !offered.has(command))
      .sort();
    expect(
      invented,
      "docs/architecture.md lists these and `bankc` has no such command",
    ).toEqual([]);
  });
});
