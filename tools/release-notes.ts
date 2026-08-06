/**
 * The release body, taken from the changelog.
 *
 * R2 asks for a tag "matching the changelog, with generated release notes".
 * GitHub's own `--generate-notes` writes a list of merged pull requests, which
 * is a different document: it records what happened to the repository, not what
 * changed for somebody using it. This repository already writes the second one
 * by hand, in Common Changelog form, and the release should be that.
 *
 * The check that matters is the refusal. A release cut before the changelog's
 * `## [Unreleased]` heading has been turned into a version is a release whose
 * notes are somebody else's — the previous version's, or empty — and nobody
 * reads their own release page carefully enough to notice.
 *
 * Usage: pnpm release:notes 0.9.0
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The body of one version's section, without its heading.
 *
 * Throws rather than returning empty: every caller here is writing a release
 * page, and a blank one is worse than a failed job.
 */
export function notesFor(version: string, changelog?: string): string {
  const text = changelog ?? readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

  const headings = [...text.matchAll(/^## +(.+)$/gm)];
  const bodyOf = (at: number): string => {
    const heading = headings[at];
    const next = headings[at + 1];
    const start = (heading?.index ?? 0) + (heading?.[0].length ?? 0);
    return text.slice(start, next?.index ?? text.length).trim();
  };

  const index = headings.findIndex((heading) =>
    (heading[1] ?? "").includes(version),
  );
  if (index === -1) {
    throw new Error(
      `CHANGELOG.md has no section for ${version}. Rename \`## [Unreleased]\` to \`## [${version}] - <date>\` before tagging.`,
    );
  }
  if (/unreleased/i.test(headings[index]?.[1] ?? "")) {
    throw new Error(
      `${version} is still filed under Unreleased in CHANGELOG.md.`,
    );
  }

  const body = bodyOf(index);
  if (body === "") {
    throw new Error(`CHANGELOG.md's section for ${version} is empty.`);
  }

  /*
   * Entries still sitting under Unreleased when the newest version is being
   * released.
   *
   * This is the failure the whole file exists for, and it is not a crash: the
   * notes extract cleanly, they are simply the wrong ones. Everything written
   * since the last release stays in Unreleased and never appears on any release
   * page — it is not in the one being cut, and by the next one it is old news
   * nobody re-reads. Keep a Changelog's answer is to fold Unreleased into the
   * version at release time, so refusing is the same instruction.
   *
   * Only for the newest version. Asking for an old one's notes is a lookup, not
   * a release, and nothing about Unreleased bears on it.
   */
  const newest = headings.findIndex(
    (heading) => !/unreleased/i.test(heading[1] ?? ""),
  );
  const unreleased = headings.findIndex((heading) =>
    /unreleased/i.test(heading[1] ?? ""),
  );
  if (index === newest && unreleased !== -1 && bodyOf(unreleased) !== "") {
    throw new Error(
      `CHANGELOG.md still has entries under Unreleased. Releasing ${version} now publishes notes that leave every one of them out — fold them into ${version}, or release the next version instead.`,
    );
  }

  return body;
}

function main(): void {
  const version = process.argv[2];
  if (version === undefined) {
    console.error("Usage: pnpm release:notes <version>");
    process.exit(1);
  }
  try {
    console.log(notesFor(version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("release-notes.ts")) {
  main();
}
