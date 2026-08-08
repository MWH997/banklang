/**
 * Keeping what a measurement said before the language changed.
 *
 *   pnpm horizontal:snapshot "line-sequential"   record the current evidence
 *   pnpm horizontal:snapshot --list              what has been recorded
 *
 * `evidence/horizontal/` always holds the *current* answer, because the report
 * is generated from it and a stale number is worse than a missing one. That
 * makes it useless for the question this phase exists to answer: how much did
 * implementing a feature actually change?
 *
 * So a snapshot is taken before a language change lands, under a name, and kept
 * in `evidence/horizontal-history/`. The delta table in the results page is
 * computed from those files rather than written by hand — which matters, because
 * "line-sequential moved 155 files" is exactly the kind of claim that gets
 * rounded up in the retelling.
 *
 * Only the summaries are kept, not the per-file rows. X-COBOL's `files.json` is
 * three megabytes and a copy per feature would dominate the repository; the
 * counts and the feature frequencies are what a delta is computed from.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describeEnvironment } from "./horizontal-environment";

export const HISTORY_ROOT = "evidence/horizontal-history";

/** The files worth keeping per corpus: counts, not rows. */
const KEPT = ["summary.json", "features.json", "gaps.json"];

export interface SnapshotIndexEntry {
  /** What changed *after* this snapshot was taken. */
  label: string;
  /** ISO date, so the order is readable without git. */
  taken: string;
  banklangVersion: string;
  gitCommit: string;
  corpusLockHash: string;
}

export function snapshotIndex(cwd = process.cwd()): SnapshotIndexEntry[] {
  const path = resolve(cwd, HISTORY_ROOT, "index.json");
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as SnapshotIndexEntry[])
    : [];
}

/**
 * Copy the current evidence under a label.
 *
 * The label names *the change that follows*, not the state — `line-sequential`
 * is "what the numbers were before line-sequential existed". That reads
 * correctly in the delta table, which is the only place these files are used.
 */
export function takeSnapshot(label: string, cwd = process.cwd()): string[] {
  const from = resolve(cwd, "evidence", "horizontal");
  const to = resolve(cwd, HISTORY_ROOT, label);
  if (!existsSync(from)) {
    throw new Error(
      `There is no evidence to snapshot. Run the lanes first: ${from}`,
    );
  }

  const written: string[] = [];
  for (const corpus of readdirSync(from, { withFileTypes: true })) {
    if (!corpus.isDirectory()) {
      continue;
    }
    for (const name of KEPT) {
      const source = join(from, corpus.name, name);
      if (!existsSync(source)) {
        continue;
      }
      mkdirSync(join(to, corpus.name), { recursive: true });
      const target = join(to, corpus.name, name);
      writeFileSync(target, readFileSync(source));
      written.push(target);
    }
  }

  const environment = describeEnvironment(cwd);
  const index = snapshotIndex(cwd).filter((entry) => entry.label !== label);
  index.push({
    label,
    taken: new Date().toISOString().slice(0, 10),
    banklangVersion: environment.banklangVersion,
    gitCommit: environment.gitCommit,
    corpusLockHash: environment.corpusLockHash,
  });
  index.sort((a, b) => a.label.localeCompare(b.label));
  mkdirSync(resolve(cwd, HISTORY_ROOT), { recursive: true });
  writeFileSync(
    resolve(cwd, HISTORY_ROOT, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
  return written;
}

export interface Representability {
  [verdict: string]: number;
}

/** A corpus's representability counts from a snapshot, or null. */
export function snapshotRepresentability(
  label: string,
  corpus: string,
  cwd = process.cwd(),
): Representability | null {
  const path = resolve(cwd, HISTORY_ROOT, label, corpus, "summary.json");
  if (!existsSync(path)) {
    return null;
  }
  const summary = JSON.parse(readFileSync(path, "utf8")) as {
    representability?: Representability;
  };
  return summary.representability ?? null;
}

function main(argv: string[]): number {
  const cwd = process.cwd();
  if (argv.includes("--list")) {
    const index = snapshotIndex(cwd);
    if (index.length === 0) {
      process.stdout.write("No snapshots recorded.\n");
      return 0;
    }
    for (const entry of index) {
      process.stdout.write(
        `${entry.label.padEnd(24)} ${entry.taken}  ${entry.banklangVersion}  ${entry.gitCommit.slice(0, 12)}\n`,
      );
    }
    return 0;
  }

  const label = argv.find((argument) => !argument.startsWith("--"));
  if (!label) {
    process.stderr.write(
      'Usage: pnpm horizontal:snapshot "<label>"   |   --list\n',
    );
    return 1;
  }
  const written = takeSnapshot(label, cwd);
  process.stdout.write(
    `Recorded ${String(written.length)} files under ${HISTORY_ROOT}/${label}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
