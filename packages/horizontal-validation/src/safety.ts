/**
 * Treating external corpora as what they are: untrusted input.
 *
 * Everything downstream of `tools/horizontal.ts` reads file names, program text
 * and expected output out of an archive somebody else published. A benchmark
 * that names its output file `../../packages/parser/src/index.ts` is not a
 * far-fetched attack — it is one careless `os.path.join` in an upstream
 * generator away, and this harness writes files where a manifest tells it to.
 *
 * So paths from a corpus are resolved through `safeJoin` and nothing else, and
 * a run happens in a directory made for it with an environment built from
 * scratch rather than inherited. None of this makes it safe to execute
 * arbitrary code from a corpus, which is why the harness never does: it
 * executes the COBOL *this compiler generated* and the benchmark's own test
 * driver, and it does not run upstream build scripts.
 */

import { isAbsolute, normalize, resolve, sep } from "node:path";

export class UnsafePathError extends Error {}

/**
 * Joins a corpus-supplied relative path onto a root, or refuses.
 *
 * Three things are refused: an absolute path, a path that climbs out of the
 * root, and a path with a NUL in it. The climb check compares resolved paths
 * rather than looking for `..`, because `a/../../b` contains no leading `..`
 * and still leaves, and because a symlink-free textual check is exactly the
 * kind that passes review and fails in use.
 *
 * The trailing separator on `root` matters: without it, a sibling directory
 * whose name merely starts with the root's — `/tmp/run` and `/tmp/run-evil` —
 * passes a `startsWith` test.
 */
export function safeJoin(root: string, candidate: string): string {
  if (candidate.includes("\0")) {
    throw new UnsafePathError(
      `The corpus supplied a path containing a NUL byte: ${JSON.stringify(candidate)}`,
    );
  }
  if (isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate)) {
    throw new UnsafePathError(
      `The corpus supplied an absolute path, which is never written: ${candidate}`,
    );
  }
  const base = resolve(root);
  const target = resolve(base, normalize(candidate));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new UnsafePathError(
      `The corpus supplied a path that leaves its working directory: ${candidate}`,
    );
  }
  return target;
}

/**
 * The environment an external run gets, built rather than inherited.
 *
 * `process.env` in CI carries the tokens the job was given. A benchmark program
 * has no business seeing `GITHUB_TOKEN`, and the way to be sure of that is to
 * start from nothing and add the four variables a COBOL program actually needs
 * to find its runtime. `PATH` is included because `cobc` has to be findable;
 * it is the caller's PATH, not a corpus's.
 */
export function sanitizedEnv(
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    LANG: "C",
    LC_ALL: "C",
    // GnuCOBOL reads these to find its own configuration and copybooks, and a
    // build that was installed to a prefix cannot run without them.
    ...(process.env.COB_CONFIG_DIR
      ? { COB_CONFIG_DIR: process.env.COB_CONFIG_DIR }
      : {}),
    ...(process.env.COB_COPY_DIR
      ? { COB_COPY_DIR: process.env.COB_COPY_DIR }
      : {}),
    ...(process.env.LD_LIBRARY_PATH
      ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }
      : {}),
    ...extra,
  };
}

/**
 * How long an external program may run, and how much it may say.
 *
 * A benchmark task that loops forever is a benchmark task, not an incident: the
 * harness records `timeout` against it and moves on. The output cap is the same
 * idea for a program that prints in a loop — without it the first such task
 * fills memory and takes the whole run with it.
 */
export const EXTERNAL_TIMEOUT_MS = 30_000;
export const EXTERNAL_OUTPUT_CAP = 1_000_000;

/** Output truncated to the cap, with the truncation stated rather than silent. */
export function capOutput(text: string): string {
  if (text.length <= EXTERNAL_OUTPUT_CAP) {
    return text;
  }
  return `${text.slice(0, EXTERNAL_OUTPUT_CAP)}\n[truncated at ${String(EXTERNAL_OUTPUT_CAP)} bytes by the horizontal validation harness]`;
}
