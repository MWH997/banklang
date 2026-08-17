/**
 * Puts a playground link in every example's README, and checks the ones in the
 * documentation.
 *
 * The obvious target is "every fenced BankTS block in `docs/`", and measuring
 * shows it is the wrong one: of the 94 `ts` blocks under `docs/`, exactly
 * **one** parses on its own. The rest are fragments, a record or a clause or
 * three lines of a transaction, written to show a construct rather than to be
 * run. A link on each of the other 93 opens the
 * documentation's own example onto a wall of syntax errors, which is worse
 * than no link at all.
 *
 * So the rule is: a block gets a link when it compiles as a program. What that
 * catches is the whole-module examples, and it stays correct by construction,
 * a block that stops parsing loses its link rather than keeping a broken one.
 *
 * The examples are the other half, and they are linked by **name** rather than
 * by encoded source: `#example=account-transfer` names something the playground
 * loads from the same file the test suite compiles, so editing the example
 * updates the link's destination instead of stranding it on a copy.
 *
 * Usage:
 *   pnpm playground:links          rewrite the example READMEs
 *   pnpm playground:links --check  fail if any is missing or wrong
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../packages/compiler/src/index";
import { SITE_ORIGIN } from "./build-site";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(ROOT, "examples");

/** Marks the generated line, so rewriting replaces rather than duplicates. */
const MARKER = "<!-- playground-link -->";

/** Every example id the playground offers, derived the same way it derives them. */
export function exampleIds(): string[] {
  const ids: string[] = [];
  for (const entry of readdirSync(EXAMPLES, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const single = join(EXAMPLES, entry.name, "src/main.bank.ts");
    if (readable(single)) {
      ids.push(entry.name);
      continue;
    }
    // A job of several programs: one per subdirectory.
    for (const nested of readdirSync(join(EXAMPLES, entry.name), {
      withFileTypes: true,
    })) {
      if (
        nested.isDirectory() &&
        readable(join(EXAMPLES, entry.name, nested.name, "src/main.bank.ts"))
      ) {
        ids.push(`${entry.name}/${nested.name}`);
      }
    }
  }
  return ids.sort();
}

function readable(path: string): boolean {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** The link line an example's README carries. */
export function linkLine(id: string): string {
  return `${MARKER}\n\n[Open this program in the playground](${SITE_ORIGIN}/playground/#example=${id}). It compiles in your browser, with the generated COBOL beside it.`;
}

/**
 * The README that documents an example, and the ids it should link to.
 *
 * A job of several programs has one README and several programs, so it links
 * to each of them rather than to a directory the playground cannot open.
 */
export function readmeTargets(): { readme: string; ids: string[] }[] {
  const byDirectory = new Map<string, string[]>();
  for (const id of exampleIds()) {
    const directory = id.split("/")[0] ?? id;
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), id]);
  }
  return [...byDirectory].map(([directory, ids]) => ({
    readme: join(EXAMPLES, directory, "README.md"),
    ids,
  }));
}

function block(ids: string[]): string {
  if (ids.length === 1) {
    return linkLine(ids[0] ?? "");
  }
  return `${MARKER}\n\nOpen each program in the playground:\n\n${ids
    .map(
      (id) =>
        `- [${id.split("/").pop() ?? id}](${SITE_ORIGIN}/playground/#example=${id})`,
    )
    .join("\n")}`;
}

/** Writes the link into every example README. Returns how many changed. */
export function writeLinks(check: boolean): { changed: string[] } {
  const changed: string[] = [];

  for (const { readme, ids } of readmeTargets()) {
    let text: string;
    try {
      text = readFileSync(readme, "utf8");
    } catch {
      // An example with no README is a gap in the examples, not in this tool.
      continue;
    }

    const wanted = block(ids);
    const existing = text.indexOf(MARKER);
    const next =
      existing >= 0
        ? `${text.slice(0, existing).trimEnd()}\n\n${wanted}\n`
        : `${text.trimEnd()}\n\n${wanted}\n`;

    if (next !== text) {
      changed.push(readme);
      if (!check) {
        writeFileSync(readme, next, "utf8");
      }
    }
  }

  return { changed };
}

/**
 * Documentation blocks that are whole programs.
 *
 * Returned rather than written: `build-docs.ts` adds the link when it renders
 * the page, so the rendered site carries it and the Markdown stays untouched.
 */
export function isRunnable(source: string): boolean {
  if (!/^\s*module\s+\w+\s*;/.test(source)) {
    return false;
  }
  // A syntax error means the block is a fragment. A *semantic* diagnostic does
  // not: a program that violates a banking rule is exactly what the playground
  // is worth opening for.
  const result = compile(source, { sourceFile: "doc.bank.ts" });
  return !result.diagnostics.some((entry) => entry.id.startsWith("BANK-SYN"));
}

/** The permalink for a block of source, in the playground's own hash format. */
export function playgroundUrl(source: string): string {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return `${SITE_ORIGIN}/playground/#v1=${encodeURIComponent(encoded)}`;
}

function main(): void {
  const check = process.argv.includes("--check");
  const { changed } = writeLinks(check);

  if (check && changed.length > 0) {
    console.error(
      `These example READMEs do not carry the playground link they should:\n${changed
        .map((path) => `  ${path.slice(ROOT.length + 1)}`)
        .join("\n")}\n\nRun \`pnpm playground:links\`.`,
    );
    process.exit(1);
  }

  console.log(
    check
      ? `Every example README carries its playground link.`
      : `Updated ${String(changed.length)} example README(s).`,
  );
}

if (process.argv[1]?.endsWith("playground-links.ts")) {
  main();
}
