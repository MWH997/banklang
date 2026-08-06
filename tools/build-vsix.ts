/**
 * Package the VS Code extension.
 *
 * R4 in `docs/launch-tickets.md`. The extension has been built and typechecked
 * in CI since it was written and has never been packaged, which means the thing
 * a user would actually install has never existed. This produces it.
 *
 * Two things it does that a `vsce package` in the extension's own manifest
 * cannot. It creates the output directory, which vsce does not and fails on.
 * And it reads the archive back, because everything that decides what ends up
 * inside a VSIX — `.vscodeignore`, `--no-dependencies`, `files` — fails open: a
 * pattern that has stopped matching packages successfully and ships the source
 * tree, and the log says `DONE`.
 *
 * The listing itself is `packages/vscode-extension/README.md`, which is the
 * marketplace page verbatim.
 *
 * Usage: pnpm build:vsix
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/vsix");

/**
 * What must be in the archive, and what must not.
 *
 * The second list is the one worth having. `src/**` shipping is not a failure
 * anybody notices — the extension still works — but it doubles the download and
 * publishes the TypeScript alongside a bundle built from it, which then rots.
 */
export const REQUIRED = [
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/server/bin.js",
  "extension/syntaxes/bankts.tmLanguage.json",
  "extension/language-configuration.json",
  "extension/icon.png",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
];

export const FORBIDDEN = [
  /^extension\/src\//,
  /node_modules/,
  /\.tsbuildinfo$/,
];

/** Every path inside a `.vsix`, which is a zip. */
export function contents(vsix: string): string[] {
  // `unzip -Z1` lists names and nothing else. Reading the archive is the point:
  // vsce's own log is what it intended to write, not what it wrote.
  return execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** What is wrong with a packaged extension, if anything. */
export function problems(paths: string[]): string[] {
  const found: string[] = [];
  for (const required of REQUIRED) {
    if (!paths.includes(required)) {
      found.push(`missing: ${required}`);
    }
  }
  for (const path of paths) {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(path)) {
        found.push(`should not be packaged: ${path}`);
      }
    }
  }
  return found;
}

/** Build the extension and package it. Returns the path to the `.vsix`. */
export function buildVsix(): string {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const run = (args: string[]): void => {
    execFileSync("pnpm", args, { cwd: ROOT, stdio: "inherit" });
  };
  run(["--filter", "banklang-vscode", "build"]);
  run(["--filter", "banklang-vscode", "package"]);

  const written = readdirSync(OUT).filter((name) => name.endsWith(".vsix"));
  if (written.length !== 1) {
    throw new Error(
      `expected one .vsix in dist/vsix, found ${String(written.length)}`,
    );
  }
  return join(OUT, written[0] ?? "");
}

function main(): void {
  const vsix = buildVsix();
  const found = problems(contents(vsix));

  if (found.length > 0) {
    console.error(
      `\n${vsix.slice(ROOT.length + 1)} is not what should be published:\n${found
        .map((problem) => `  ${problem}`)
        .join("\n")}`,
    );
    process.exit(1);
  }

  console.log(`\n${vsix.slice(ROOT.length + 1)} is ready to publish.`);
}

if (process.argv[1]?.endsWith("build-vsix.ts")) {
  main();
}
