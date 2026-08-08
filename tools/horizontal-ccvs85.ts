/**
 * NIST's COBOL-85 validation suite, if the operator supplies one.
 *
 *   BANKLANG_CCVS85_DIR=/path/to/ccvs85 pnpm horizontal:ccvs85
 *
 * This repository never downloads it and never redistributes it. The suite is a
 * US government validation product with its own distribution terms, and this
 * project has no standing to restate them — so the corpus is `local` in the
 * registry, the directory is the operator's, and with nothing supplied the lane
 * reports `unavailable` and says exactly what to set.
 *
 * **What it validates, and what it does not.** CCVS85 exercises the COBOL
 * implementation *underneath* BankLang: whether `cobc` handles a construct the
 * way the standard requires. That is worth knowing — every claim this project
 * makes about executed behaviour rests on the compiler below it, and
 * `docs/divergences.md` exists because those compilers differ. It establishes
 * nothing about BankTS: no CCVS85 test was written in BankTS and none of them
 * can be.
 *
 * So the applicability map below runs the other way from the semantic corpora.
 * Rather than asking which tests BankTS can express, it asks which of them
 * exercise a construct *the backend actually emits* — because a conformance
 * failure in a construct this compiler never generates is somebody else's
 * problem, and counting it would misstate the risk to this project either way.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  corpus,
  hashBytes,
  type CorpusDefinition,
} from "../packages/horizontal-validation/src/index";
import { detectFeatures } from "../packages/migration-analysis/src/features";
import { locateLocal } from "./horizontal-fetch";
import { describeEnvironment } from "./horizontal-environment";

/**
 * Which emitted construct a CCVS85 module bears on.
 *
 * The suite is organised by module — `NC` nucleus, `SQ` sequential I/O, `IX`
 * indexed I/O, and so on — and the file names carry the prefix. The map is from
 * that prefix to the BankLang feature it covers, so applicability is decided by
 * what this compiler emits rather than by which tests look interesting.
 */
export const CCVS_MODULES: {
  prefix: string;
  name: string;
  /** Feature names from `packages/migration-analysis`, or [] when none apply. */
  emitted: string[];
}[] = [
  {
    prefix: "NC",
    name: "Nucleus",
    emitted: [
      "move",
      "arithmetic-verbs",
      "conditional",
      "compute",
      "evaluate",
      "perform-varying",
    ],
  },
  {
    prefix: "SQ",
    name: "Sequential I/O",
    emitted: ["file-sequential", "file-verbs", "file-status"],
  },
  {
    prefix: "IX",
    name: "Indexed I/O",
    emitted: ["file-indexed", "start-browse", "file-verbs"],
  },
  { prefix: "RL", name: "Relative I/O", emitted: [] },
  { prefix: "ST", name: "Sort/Merge", emitted: ["sort-merge"] },
  { prefix: "SM", name: "Source text manipulation", emitted: ["copy"] },
  {
    prefix: "IC",
    name: "Inter-program communication",
    emitted: ["call-static", "linkage-section"],
  },
  { prefix: "RW", name: "Report Writer", emitted: ["report-writer"] },
  { prefix: "DB", name: "Debug", emitted: [] },
  { prefix: "CM", name: "Communication", emitted: [] },
  { prefix: "OB", name: "Obsolete features", emitted: [] },
];

export interface Ccvs85Report {
  available: boolean;
  /** Where it was found, or the variable to set. */
  location: string;
  /** sha256 over the sorted file list and sizes, so a copy can be identified. */
  corpusFingerprint: string | null;
  discovered: number;
  /** Tests in a module whose constructs this backend emits. */
  applicable: number;
  /** Tests in a module nothing here emits. */
  notEmittedByBanklang: number;
  /** Files that matched no known module prefix. */
  unrecognised: number;
  byModule: {
    module: string;
    name: string;
    files: number;
    applicable: boolean;
    emitted: string[];
  }[];
  /** Constructs the backend emits that no local module covers. */
  uncovered: string[];
}

/** Every CCVS85 source file under the supplied directory. */
function ccvsFiles(root: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  return walk(root)
    .filter((path) => /\.(cbl|cob|CBL|COB)$/.test(path))
    .map((path) => relative(root, path))
    .sort();
}

/**
 * Constructs the backend really emits, measured rather than listed.
 *
 * Read off this repository's own generated COBOL, so the coverage question is
 * asked against what the compiler produces today rather than against a list
 * somebody maintained. A construct that stops being emitted stops being
 * something CCVS85 needs to cover, without anybody editing a table.
 */
export function emittedConstructs(cwd = process.cwd()): string[] {
  const found = new Set<string>();
  const evidence = resolve(cwd, "evidence");
  if (!existsSync(evidence)) {
    return [];
  }
  for (const bundle of readdirSync(evidence)) {
    const cobol = join(evidence, bundle, "cobol");
    if (!existsSync(cobol)) {
      continue;
    }
    for (const file of readdirSync(cobol)) {
      for (const feature of Object.keys(
        detectFeatures(readFileSync(join(cobol, file), "utf8")),
      )) {
        found.add(feature);
      }
    }
  }
  return [...found].sort();
}

export function reportCcvs85(cwd = process.cwd()): Ccvs85Report {
  const definition = corpus("ccvs85-local") as CorpusDefinition & {
    fetch: { kind: "local"; envVar: string };
  };
  const root = locateLocal(definition);
  const emitted = emittedConstructs(cwd);
  // The module map is static, so which emitted constructs CCVS85 would cover is
  // answerable whether or not a copy is on this machine. Reporting every
  // construct as uncovered when the suite is merely absent conflates "nothing
  // checks this" with "nothing is here to check it", and the first is the
  // finding worth acting on.
  const covered = new Set(CCVS_MODULES.flatMap((module) => module.emitted));
  const uncovered = emitted.filter((feature) => !covered.has(feature));

  if (!root) {
    return {
      available: false,
      location: `not supplied — set ${definition.fetch.envVar} to a local copy`,
      corpusFingerprint: null,
      discovered: 0,
      applicable: 0,
      notEmittedByBanklang: 0,
      unrecognised: 0,
      byModule: [],
      uncovered,
    };
  }

  const files = ccvsFiles(root);
  const byModule = CCVS_MODULES.map((module) => {
    const matched = files.filter((file) =>
      new RegExp(`(^|/)${module.prefix}\\d`, "i").test(file),
    );
    return {
      module: module.prefix,
      name: module.name,
      files: matched.length,
      applicable: module.emitted.length > 0,
      emitted: module.emitted,
    };
  });

  const recognised = byModule.reduce(
    (total, module) => total + module.files,
    0,
  );
  const applicable = byModule
    .filter((module) => module.applicable)
    .reduce((total, module) => total + module.files, 0);

  return {
    available: true,
    location: root,
    corpusFingerprint: hashBytes(files.join("\n")),
    discovered: files.length,
    applicable,
    notEmittedByBanklang: recognised - applicable,
    unrecognised: files.length - recognised,
    byModule,
    uncovered,
  };
}

export function renderCcvs85(report: Ccvs85Report): string {
  const definition = corpus("ccvs85-local");
  return `${[
    "# NIST COBOL-85 validation suite — local conformance",
    "",
    `**Status** ${report.available ? `available at \`${report.location}\`` : report.location}`,
    "",
    `**What this establishes.** ${definition.establishes}`,
    "",
    `**What it does not.** ${definition.limits}`,
    "",
    "Never downloaded and never redistributed by this repository.",
    "",
    "| | |",
    "| --- | --- |",
    `| test sources discovered | ${String(report.discovered)} |`,
    `| in a module this backend emits | ${String(report.applicable)} |`,
    `| in a module it does not emit | ${String(report.notEmittedByBanklang)} |`,
    `| unrecognised module prefix | ${String(report.unrecognised)} |`,
    "",
    "## Modules, against what the backend emits",
    "",
    "| Module | | Files | Applicable | Constructs |",
    "| --- | --- | --- | --- | --- |",
    ...report.byModule.map(
      (module) =>
        `| ${module.module} | ${module.name} | ${String(module.files)} | ${module.applicable ? "yes" : "no"} | ${module.emitted.map((name) => `\`${name}\``).join(", ") || "—"} |`,
    ),
    "",
    "## Constructs this backend emits that no module above covers",
    "",
    report.uncovered.length === 0
      ? "_None._"
      : report.uncovered.map((feature) => `- \`${feature}\``).join("\n"),
    "",
  ].join("\n")}\n`;
}

function main(): number {
  const cwd = process.cwd();
  const report = reportCcvs85(cwd);
  const out = resolve(cwd, "evidence", "horizontal", "ccvs85-local");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "environment.json"),
    `${JSON.stringify(describeEnvironment(cwd), null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(out, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(out, "summary.md"), renderCcvs85(report), "utf8");

  process.stdout.write(
    report.available
      ? `ccvs85-local   ${String(report.discovered)} sources, ${String(report.applicable)} in modules this backend emits\n`
      : `ccvs85-local   ${report.location}\n`,
  );
  if (report.uncovered.length > 0) {
    process.stdout.write(
      `               emitted constructs no module covers: ${report.uncovered.join(", ")}\n`,
    );
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
