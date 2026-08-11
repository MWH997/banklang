/**
 * Bringing external corpora onto this machine, once, at a pinned revision.
 *
 *   pnpm horizontal:fetch              every corpus in the registry
 *   pnpm horizontal:fetch coboleval    one of them
 *   pnpm horizontal:fetch --update     re-pin the lock to what upstream is now
 *
 * Separate from the harness on purpose. Fetching touches the network and writes
 * to an ignored cache; measuring must do neither, because a validation lane
 * whose answer depends on somebody else's server being up is a lane that
 * reports a compiler defect when the network is slow. So this runs by hand or
 * in its own workflow, and everything downstream reads what is already on disk.
 *
 * Without `--update` the lock is authority: a file whose bytes do not match
 * what `validation/corpus-lock.json` records is an error, not a new
 * measurement. Re-pinning is a commit somebody makes and reviews.
 *
 * **Nothing shipped by a corpus is executed here.** Not a setup script, not a
 * makefile, not a `pip install`. The archives are unpacked and read. The only
 * external programs this repository ever runs are `cobc` and the COBOL the
 * benchmark itself supplies as a test driver, and those run through the harness
 * in a scratch directory with a built environment — see
 * `packages/horizontal-validation/src/safety.ts`.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CORPORA,
  detectLicence,
  hashBytes,
  parseLock,
  stableLockJson,
  type CorpusDefinition,
  type CorpusLock,
  type LockedCorpus,
  type LockedFile,
} from "../packages/horizontal-validation/src/index";

export const CACHE_ROOT = "validation/cache";
export const LOCK_PATH = "validation/corpus-lock.json";

/** Where a corpus's files live once fetched. */
export function corpusDir(id: string, cwd = process.cwd()): string {
  return resolve(cwd, CACHE_ROOT, id);
}

/**
 * The lock as committed, or an empty one.
 *
 * An absent lock is the first-run case rather than an error: `--update` writes
 * it. A *present* lock that does not parse is an error, because that is a
 * corrupted pin rather than a missing one.
 */
export function readLock(cwd = process.cwd()): CorpusLock {
  const path = resolve(cwd, LOCK_PATH);
  if (!existsSync(path)) {
    return { version: 1, corpora: [] };
  }
  return parseLock(readFileSync(path, "utf8"), LOCK_PATH);
}

export function writeLock(lock: CorpusLock, cwd = process.cwd()): void {
  const path = resolve(cwd, LOCK_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stableLockJson(lock), "utf8");
}

/** Every file under a directory, as cache-relative forward-slashed paths. */
export function cachedFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  return walk(root)
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
}

/** The lock entry describing what is on disk for a corpus right now. */
export function describeCache(
  definition: CorpusDefinition,
  cwd = process.cwd(),
): LockedCorpus {
  const root = corpusDir(definition.id, cwd);
  const files: LockedFile[] = cachedFiles(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, sha256: hashBytes(bytes), bytes: bytes.byteLength };
  });
  return {
    id: definition.id,
    revision: revisionOf(definition),
    retrieved: new Date().toISOString().slice(0, 10),
    licence: determineLicence(definition, root),
    files,
  };
}

/**
 * The licence for the corpus as fetched.
 *
 * The registry states what upstream declares; this checks it against a LICENSE
 * file where the corpus ships one, so a repository that relicensed since the
 * registry was written is caught rather than assumed. Where there is no file,
 * the declared value stands and the basis says so.
 */
function determineLicence(definition: CorpusDefinition, root: string): string {
  for (const name of ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"]) {
    const path = join(root, name);
    if (existsSync(path)) {
      const found = detectLicence(readFileSync(path, "utf8"));
      if (found.spdx) {
        return found.spdx;
      }
    }
  }
  return definition.licence;
}

function revisionOf(definition: CorpusDefinition): string {
  switch (definition.fetch.kind) {
    case "github":
      return definition.fetch.ref;
    case "huggingface":
      return definition.fetch.revision;
    case "zenodo":
      return `zenodo:${definition.fetch.record}`;
    case "local":
      return `local:${definition.fetch.envVar}`;
  }
}

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

async function download(url: string, into: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "user-agent": "banklang-horizontal-validation" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${String(response.status)}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(into), { recursive: true });
  writeFileSync(into, bytes);
}

/**
 * Unpack an archive with the system tool, reading only what is asked for.
 *
 * `tar` and `unzip` rather than a dependency, because both are present
 * everywhere this repository runs and neither adds a package that would then be
 * in the supply chain of a compiler. Archive members are extracted into a
 * scratch directory and copied across by name, so a member whose path climbs
 * out of the archive lands in the scratch directory and is never selected.
 */
function extract(archive: string, into: string): void {
  mkdirSync(into, { recursive: true });
  const isZip = archive.endsWith(".zip");
  const result = isZip
    ? spawnSync("unzip", ["-qo", archive, "-d", into], { encoding: "utf8" })
    : spawnSync("tar", ["xf", archive, "-C", into], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `Unpacking ${archive} failed: ${result.stderr || result.stdout || "no output"}`,
    );
  }
}

async function fetchGithub(
  definition: CorpusDefinition & { fetch: { kind: "github" } },
  cwd: string,
): Promise<void> {
  const { owner, repo, ref, paths } = definition.fetch;
  const root = corpusDir(definition.id, cwd);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const scratch = join(root, ".unpack");
  const tarball = join(scratch, "source.tar.gz");
  await download(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`,
    tarball,
  );
  extract(tarball, scratch);

  // GitHub's tarball wraps everything in `<repo>-<ref>/`.
  const wrapper = readdirSync(scratch, { withFileTypes: true }).find((entry) =>
    entry.isDirectory(),
  );
  if (!wrapper) {
    throw new Error(`${definition.id}: the tarball held no directory.`);
  }
  const base = join(scratch, wrapper.name);

  for (const wanted of paths) {
    const from = join(base, wanted);
    if (!existsSync(from)) {
      throw new Error(
        `${definition.id}: '${wanted}' is not in ${owner}/${repo} at ${ref.slice(0, 12)}.`,
      );
    }
    copyInto(from, join(root, wanted));
  }
  rmSync(scratch, { recursive: true, force: true });
}

function copyInto(from: string, to: string): void {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      copyInto(join(from, entry.name), join(to, entry.name));
    }
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from));
}

/**
 * Decode the `#Uhhhh` filename escapes used by some ZIP producers.
 *
 * The X-COBOL Zenodo archive contains the same bytes under this spelling on
 * unzip implementations that do not honour its Unicode extra field, while
 * the lock records the human-readable Unicode path. Normalising names after
 * extraction keeps path identity independent of the extractor without
 * changing any corpus bytes.
 */
function normaliseArchiveNames(root: string): void {
  const decode = (name: string): string =>
    name.replace(/#U([0-9A-Fa-f]{4,6})/g, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : _match;
    });

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(source);
      }
      const decoded = decode(entry.name);
      if (decoded === entry.name) {
        continue;
      }
      const target = join(directory, decoded);
      if (existsSync(target)) {
        throw new Error(
          `Archive filename collision after Unicode decoding: ${source}`,
        );
      }
      renameSync(source, target);
    }
  };

  walk(root);
}

async function fetchHuggingface(
  definition: CorpusDefinition & { fetch: { kind: "huggingface" } },
  cwd: string,
): Promise<void> {
  const { dataset, revision, files } = definition.fetch;
  const root = corpusDir(definition.id, cwd);
  rmSync(root, { recursive: true, force: true });
  for (const file of files) {
    await download(
      `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${file}`,
      join(root, file),
    );
  }
}

async function fetchZenodo(
  definition: CorpusDefinition & { fetch: { kind: "zenodo" } },
  cwd: string,
): Promise<void> {
  const { record, files } = definition.fetch;
  const root = corpusDir(definition.id, cwd);
  rmSync(root, { recursive: true, force: true });
  for (const file of files) {
    const target = join(root, file);
    await download(
      `https://zenodo.org/records/${record}/files/${file}?download=1`,
      target,
    );
    if (file.endsWith(".zip")) {
      const extracted = join(root, file.replace(/\.zip$/, ""));
      extract(target, extracted);
      normaliseArchiveNames(extracted);
      // The archive itself is not kept: it is 50MB of the same bytes, and the
      // lock records the unpacked files, which are what gets measured.
      rmSync(target, { force: true });
    }
  }
}

/**
 * A locally supplied corpus, checked for rather than downloaded.
 *
 * NIST's COBOL-85 validation suite is the case this exists for. It is not
 * ours to redistribute and this repository will not fetch it: the operator
 * points an environment variable at their own copy, or the lane reports
 * unavailable and says why.
 */
export function locateLocal(
  definition: CorpusDefinition & { fetch: { kind: "local" } },
): string | null {
  const configured = process.env[definition.fetch.envVar]?.trim();
  if (!configured || !existsSync(configured)) {
    return null;
  }
  return configured;
}

export async function fetchCorpus(
  definition: CorpusDefinition,
  cwd = process.cwd(),
): Promise<void> {
  switch (definition.fetch.kind) {
    case "github":
      await fetchGithub(
        definition as CorpusDefinition & { fetch: { kind: "github" } },
        cwd,
      );
      return;
    case "huggingface":
      await fetchHuggingface(
        definition as CorpusDefinition & { fetch: { kind: "huggingface" } },
        cwd,
      );
      return;
    case "zenodo":
      await fetchZenodo(
        definition as CorpusDefinition & { fetch: { kind: "zenodo" } },
        cwd,
      );
      return;
    case "local":
      // Nothing to fetch by design. `status` reports whether it is present.
      return;
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

async function main(argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const update = argv.includes("--update");
  const wanted = argv.filter((argument) => !argument.startsWith("--"));
  const selected =
    wanted.length > 0
      ? CORPORA.filter((entry) => wanted.includes(entry.id))
      : CORPORA;

  if (selected.length === 0) {
    process.stderr.write(
      `No corpus matched. Registered: ${CORPORA.map((entry) => entry.id).join(", ")}\n`,
    );
    return 1;
  }

  const lock = readLock(cwd);
  let failed = false;

  for (const definition of selected) {
    if (definition.fetch.kind === "local") {
      const found = locateLocal(
        definition as CorpusDefinition & { fetch: { kind: "local" } },
      );
      process.stdout.write(
        `${definition.id.padEnd(16)} ${found ? `local at ${found}` : `not supplied (set ${definition.fetch.envVar})`}\n`,
      );
      continue;
    }

    process.stdout.write(`${definition.id.padEnd(16)} fetching…\n`);
    try {
      await fetchCorpus(definition, cwd);
    } catch (error) {
      process.stderr.write(
        `${definition.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      failed = true;
      continue;
    }

    const described = describeCache(definition, cwd);
    const existing = lock.corpora.find((entry) => entry.id === definition.id);

    if (!existing || update) {
      lock.corpora = [
        ...lock.corpora.filter((entry) => entry.id !== definition.id),
        described,
      ];
      process.stdout.write(
        `${definition.id.padEnd(16)} pinned ${String(described.files.length)} files at ${described.revision.slice(0, 16)} (${described.licence})\n`,
      );
      continue;
    }

    // Not `--update`: the lock is authority and this is a verification.
    const differences = compareLocked(existing, described);
    if (differences.length > 0) {
      process.stderr.write(
        `${definition.id}: what was fetched does not match the lock.\n${differences
          .map((line) => `  ${line}`)
          .join(
            "\n",
          )}\nRe-run with --update to re-pin, which is a change worth reviewing.\n`,
      );
      failed = true;
      continue;
    }
    process.stdout.write(
      `${definition.id.padEnd(16)} matches the lock: ${String(described.files.length)} files\n`,
    );
  }

  writeLock(lock, cwd);
  return failed ? 1 : 0;
}

/** Where two descriptions of the same corpus disagree, as readable lines. */
export function compareLocked(
  locked: LockedCorpus,
  actual: LockedCorpus,
): string[] {
  const differences: string[] = [];
  if (locked.revision !== actual.revision) {
    differences.push(
      `revision ${locked.revision} locked, ${actual.revision} fetched`,
    );
  }
  const lockedFiles = new Map(locked.files.map((file) => [file.path, file]));
  const actualFiles = new Map(actual.files.map((file) => [file.path, file]));
  for (const [path, file] of lockedFiles) {
    const found = actualFiles.get(path);
    if (!found) {
      differences.push(`${path} is locked and was not fetched`);
    } else if (found.sha256 !== file.sha256) {
      differences.push(
        `${path} hashes to ${found.sha256.slice(0, 12)}, lock says ${file.sha256.slice(0, 12)}`,
      );
    }
  }
  for (const path of actualFiles.keys()) {
    if (!lockedFiles.has(path)) {
      differences.push(`${path} was fetched and is not in the lock`);
    }
  }
  return differences;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
