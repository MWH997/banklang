import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every example project in the repository, as a path from the root.
 *
 * Most examples are one directory holding one program. `end-of-day-settlement`
 * is not: a night is several programs and a sort in one job, so that directory
 * holds a `job.json` and a subdirectory per program, each of which is an
 * ordinary project.
 *
 * Five tools enumerated `examples/*` themselves and each assumed the first
 * shape: the formatter, the conformance linter, the GnuCOBOL lane, the z/OS
 * kit, and the compile test. Adding a job directory made all five of them try
 * to read a source file that is one level further down, so the enumeration is
 * written once here and a project is defined by what it holds rather than by
 * where it sits.
 */
export function exampleProjects(cwd = process.cwd()): string[] {
  const root = resolve(cwd, "examples");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const path = `examples/${entry.name}`;
      if (isProject(join(root, entry.name))) {
        return [path];
      }
      return readdirSync(join(root, entry.name), { withFileTypes: true })
        .filter(
          (nested) =>
            nested.isDirectory() &&
            isProject(join(root, entry.name, nested.name)),
        )
        .map((nested) => `${path}/${nested.name}`);
    })
    .sort();
}

/** Every job directory: one `job.json`, several programs, one stream. */
export function exampleJobs(cwd = process.cwd()): string[] {
  const root = resolve(cwd, "examples");
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, entry.name, "job.json")),
    )
    .map((entry) => `examples/${entry.name}`)
    .sort();
}

function isProject(path: string): boolean {
  return existsSync(join(path, "src", "main.bank.ts"));
}
