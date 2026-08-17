/**
 * Rebuild every checked-in evidence bundle from the compiler as it stands.
 *
 * The bundles are what a reader is invited to check the project's claims
 * against, and they were maintained by hand. Nothing kept them in step, so by
 * the time anybody looked they held copybooks written before the
 * reference-format work, dataset names that could not be catalogued, and a
 * 31-character COBOL word: artifacts no version of this compiler would
 * produce, presented as evidence of what it produces.
 *
 * `pnpm evidence:refresh` regenerates them all, and
 * `pnpm lint:conformance` reads them afterwards. A bundle is now a build
 * output that happens to be checked in, which is the only kind that stays true.
 *
 * The prose stays: each `README.md` keeps its tester-note links and its
 * standing note that no IBM validation is claimed. Only the contents list is
 * rewritten, because that is the part that goes stale.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runBankc } from "../packages/bankc-cli/src/index";

/** Directories a bundle owns, and therefore may replace wholesale. */
const GENERATED_DIRECTORIES = [
  "audit",
  "cobol",
  "copybooks",
  "gnucobol",
  "jcl",
  "maps",
  "source",
  "zunit",
];

/**
 * A bundle with nothing written about it yet.
 *
 * The contents list is filled in below; the rest is the standing text every
 * bundle carries, and someone who knows what the example is for replaces the
 * summary line with something worth reading.
 */
function templateReadme(bundle: string): string {
  const title = bundle
    .split("-")
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");

  return [
    `# ${title} Evidence Bundle`,
    "",
    `Generated artifacts for the ${bundle} example.`,
    "",
    "## Contents",
    "",
    "## Regeneration",
    "",
    "```bash",
    "pnpm evidence:refresh",
    "```",
    "",
    "## Notes",
    "",
    "No IBM validation claim is made here. The bundle records local",
    "deterministic outputs only.",
    "",
  ].join("\n");
}

export function refreshEvidence(cwd = process.cwd()): string[] {
  const root = resolve(cwd, "evidence");
  /*
   * Only the directories that are evidence *bundles*.
   *
   * Every subdirectory of `evidence/` used to be taken for one, and the
   * horizontal-validation programme then put `horizontal/` and
   * `horizontal-history/` there: results and summaries, not a compiled
   * example. `pnpm evidence:refresh` has crashed on them ever since, reading
   * `examples/horizontal/src/main.bank.ts`, and because it crashed part-way
   * through a sorted list the five bundles after `branch-accrual-cursor` were
   * never regenerated at all.
   *
   * A bundle is a directory with an example of the same name. Anything else
   * under `evidence/` is somebody else's output and is left alone.
   */
  const bundles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(resolve(cwd, "examples", name)))
    .sort();

  for (const bundle of bundles) {
    const project = `examples/${bundle}`;
    const target = join(root, bundle);

    // Removed rather than overwritten: a member that was renamed leaves the
    // old file behind, and a bundle holding both is a bundle that says the
    // compiler emits two of everything.
    for (const directory of GENERATED_DIRECTORIES) {
      rmSync(join(target, directory), { recursive: true, force: true });
    }

    const result = runBankc(["test", project, "--out", target], cwd);
    if (result.exitCode !== 0) {
      throw new Error(
        `bankc test ${project} failed:\n${result.stderr}${result.stdout}`,
      );
    }

    // The zUnit case, for a project that declares tests. `bankc test` does not
    // write one. What `build` writes is what ships, and a test case is not
    // part of the program, so it is asked for separately here, because a
    // bundle is what a reader checks the claims against and the claim is that
    // the case is generated.
    const zunit = runBankc(["zunit", project, "--out", target], cwd);
    // Most examples declare no tests, and the generator refuses to write a
    // configuration naming none. That is the answer for those, not a failure.
    if (zunit.exitCode !== 0 && !zunit.stderr.includes("BANK-TEST-007")) {
      throw new Error(
        `bankc zunit ${project} failed:\n${zunit.stderr}${zunit.stdout}`,
      );
    }

    // The GnuCOBOL lane compiles into its own tree beside the bundle, and what
    // it leaves there is a second copy of the program and a Mach-O binary. The
    // report it wrote to `audit/` is the evidence; the working directory is
    // not, and a checked-in executable is not evidence of anything.
    rmSync(join(target, "gnucobol"), { recursive: true, force: true });

    mkdirSync(join(target, "source"), { recursive: true });
    cpSync(
      resolve(cwd, project, "src/main.bank.ts"),
      join(target, "source/main.bank.ts"),
    );

    const readme = join(target, "README.md");
    writeFileSync(
      readme,
      renderBundleReadme(
        existsSync(readme)
          ? readFileSync(readme, "utf8")
          : templateReadme(bundle),
        listArtifacts(target, target),
      ),
      "utf8",
    );
  }

  return bundles;
}

/** Every file in the bundle, as the contents list names them. */
function listArtifacts(root: string, base: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...listArtifacts(path, base));
    } else if (entry.name !== "README.md") {
      paths.push(relative(base, path));
    }
  }
  return paths;
}

/**
 * The bundle's README with its contents list replaced and its prose kept.
 *
 * Everything before `## Contents` and everything from the next heading onward
 * is the writer's, and a tool that regenerates a document has no business
 * rewriting the parts a person wrote.
 */
export function renderBundleReadme(
  existing: string,
  artifacts: readonly string[],
): string {
  const lines = existing.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Contents");
  if (start === -1) {
    throw new Error("The bundle README has no Contents section to replace.");
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );

  return [
    ...lines.slice(0, start + 1),
    "",
    ...artifacts.map((path) => `- \`${path}\``),
    "",
    ...(end === -1 ? [] : lines.slice(end)),
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const bundles = refreshEvidence(process.cwd());
  process.stdout.write(`Refreshed ${bundles.length} evidence bundles.\n`);
}
