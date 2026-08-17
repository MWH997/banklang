/**
 * The machine a measurement happened on, recorded with the measurement.
 *
 * A validation number is only reproducible if the reader can tell what produced
 * it. Which compiler version, which commit of this repository, which corpus
 * revisions, and, in this project's case, which COBOL compiler, because the
 * whole point of `docs/divergences.md` is that GnuCOBOL 3.1.2 and 3.2.0 do not
 * agree about the target.
 *
 * `gnucobolVersion` is null rather than "unknown" when `cobc` is absent, and
 * every execution lane records `skipped` in that case. A run with no compiler
 * is not a run with no failures.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  hashBytes,
  type RunEnvironment,
} from "../packages/horizontal-validation/src/index";
import { LOCK_PATH } from "./horizontal-fetch";

/** The compiler's own version string, as `bankc version` reports it. */
function banklangVersion(cwd: string): string {
  const manifest = JSON.parse(
    readFileSync(resolve(cwd, "package.json"), "utf8"),
  ) as { version?: string };
  return manifest.version ?? "unknown";
}

function gitCommit(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

export function gnucobolVersion(): string | null {
  const result = spawnSync("cobc", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.split("\n")[0]?.trim() ?? null;
}

export function describeEnvironment(cwd = process.cwd()): RunEnvironment {
  const lockPath = resolve(cwd, LOCK_PATH);
  return {
    banklangVersion: banklangVersion(cwd),
    gitCommit: gitCommit(cwd),
    nodeVersion: process.version,
    gnucobolVersion: gnucobolVersion(),
    platform: process.platform,
    arch: process.arch,
    corpusLockHash: existsSync(lockPath)
      ? hashBytes(readFileSync(lockPath))
      : "no lock",
  };
}
