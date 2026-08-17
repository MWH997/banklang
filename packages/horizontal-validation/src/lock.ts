/**
 * What was actually measured, pinned so it can be measured again.
 *
 * A validation number without a corpus version is a rumour. Upstream moves:
 * a dataset gains twelve tasks, a repository rewrites a file, and the same
 * command produces a different answer with nothing in the repository to say
 * why. Worse, it produces a *better* answer sometimes, which nobody
 * investigates.
 *
 * So a corpus is fetched at a pinned revision and every file it produced is
 * recorded here by sha256. `verifyLock` is what the harness runs before a
 * measurement: a cache whose bytes do not match the lock is refused rather than
 * measured, so the failure is "your cache is stale" rather than a silently
 * different score.
 *
 * Updating a corpus is `tools/horizontal.ts fetch --update`, which rewrites the
 * lock and shows the diff. It is a commit somebody has to make and review.
 */

import { createHash } from "node:crypto";

export interface LockedFile {
  /** Path inside the corpus cache, always relative and always forward-slashed. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface LockedCorpus {
  id: string;
  /** Commit SHA, dataset revision, or DOI: whatever pins this upstream. */
  revision: string;
  /** ISO date the bytes were retrieved. */
  retrieved: string;
  /** SPDX identifier determined at fetch time. */
  licence: string;
  files: LockedFile[];
}

export interface CorpusLock {
  /** Bumped when the lock's own shape changes. */
  version: 1;
  corpora: LockedCorpus[];
}

export function hashBytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The lock's own hash, which travels with every result row.
 *
 * Serialised through `stableLockJson` rather than hashing the file on disk, so
 * that a reformat (a different indent, a trailing newline) does not change
 * the identity of a measurement that used the same corpora.
 */
export function lockHash(lock: CorpusLock): string {
  return hashBytes(stableLockJson(lock));
}

/** The lock as bytes, with every collection ordered so the hash is stable. */
export function stableLockJson(lock: CorpusLock): string {
  const ordered: CorpusLock = {
    version: lock.version,
    corpora: [...lock.corpora]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => ({
        ...entry,
        files: [...entry.files].sort((a, b) => a.path.localeCompare(b.path)),
      })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export class LockMismatchError extends Error {}

/**
 * Every locked file is present with the bytes the lock recorded.
 *
 * Returns the problems rather than throwing, so a caller can report all of them
 * at once: "these four files differ" is one investigation and four sequential
 * failures are four.
 */
export function verifyLock(
  locked: LockedCorpus,
  actual: Map<string, Uint8Array>,
): string[] {
  const problems: string[] = [];
  for (const file of locked.files) {
    const bytes = actual.get(file.path);
    if (!bytes) {
      problems.push(
        `${locked.id}: ${file.path} is locked and missing from the cache.`,
      );
      continue;
    }
    if (bytes.byteLength !== file.bytes) {
      problems.push(
        `${locked.id}: ${file.path} is ${String(bytes.byteLength)} bytes and the lock records ${String(file.bytes)}.`,
      );
      continue;
    }
    const sha = hashBytes(bytes);
    if (sha !== file.sha256) {
      problems.push(
        `${locked.id}: ${file.path} hashes to ${sha.slice(0, 12)} and the lock records ${file.sha256.slice(0, 12)}.`,
      );
    }
  }
  return problems;
}

export function parseLock(text: string, source: string): CorpusLock {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) {
    throw new LockMismatchError(`${source}: not a JSON object.`);
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new LockMismatchError(
      `${source}: lock version ${String(value.version)} is not one this build understands.`,
    );
  }
  if (!Array.isArray(value.corpora)) {
    throw new LockMismatchError(`${source}: 'corpora' must be an array.`);
  }
  return { version: 1, corpora: value.corpora as LockedCorpus[] };
}
