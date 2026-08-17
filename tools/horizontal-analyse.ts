/**
 * Reading a whole corpus of somebody else's COBOL, and reporting what is in it.
 *
 *   pnpm horizontal:analyse                every coverage corpus in the cache
 *   pnpm horizontal:analyse xcobol-v2      one of them
 *
 * This is the horizontal lane that needs no oracle and makes no correctness
 * claim. It runs `packages/migration-analysis`, the same reader `bankc analyse`
 * uses rather than a second one, over every COBOL file the corpus holds, records
 * which constructs each file contains, and applies the representability rules
 * in `packages/horizontal-validation` to say what BankTS could express.
 *
 * The most useful thing it produces is the list of *unsupported constructs
 * ranked by real-world frequency*, which is a to-do list ordered by evidence
 * rather than by whoever asked most recently.
 *
 * **What lands in git.** For a corpus marked `derived-only` (X-COBOL, whose
 * CC-BY licence covers the compilation rather than the 168 repositories it
 * licence forbids redistribution) the evidence bundle carries measurements,
 * and never a line of the corpus itself.
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
  addRecordUsage,
  addStringUsage,
  emptyRecordUsage,
  emptyStringUsage,
} from "../packages/migration-analysis/src/index";
import {
  analyseFile,
  corpus as corpusById,
  CORPORA,
  looksLikeCobol,
  summarise,
  supportFor,
  supportGaps,
  type CorpusAnalysis,
  type FileAnalysis,
} from "../packages/horizontal-validation/src/index";
import { corpusDir } from "./horizontal-fetch";
import { describeEnvironment } from "./horizontal-environment";

/** Corpora this lane reads: the ones with programs but no expected output. */
export const ANALYSABLE = ["xcobol-v2", "opencbs"];

/** Every file under a root, as paths relative to it. */
function walk(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const inner = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? inner(path) : [path];
    });
  return inner(root)
    .map((path) => relative(root, path).split("\\").join("/"))
    .sort();
}

/**
 * Which upstream repository a file came from, where the corpus records it.
 *
 * X-COBOL names each repository's directory `<owner>@<repo>` and nests those
 * under two levels of `COBOL_Files/`, so provenance is the path segment holding
 * the `@` rather than the first one. Taking the first segment reported all
 * 5,195 files as coming from one repository called `COBOL_Files`, which is a
 * provenance record that attributes nothing, and provenance is the entire
 * reason this corpus's material stays in the cache while its measurements are
 * published.
 *
 * The record ships no per-file licence, which is why the corpus is
 * `derived-only`: knowing which repository a file came from is enough to
 * attribute a measurement and not enough to copy anything.
 */
export function provenanceOf(path: string): string | null {
  return path.split("/").find((segment) => segment.includes("@")) ?? null;
}

export function analyseCorpus(
  id: string,
  cwd = process.cwd(),
): CorpusAnalysis | null {
  const root = corpusDir(id, cwd);
  if (!existsSync(root)) {
    return null;
  }
  const files: FileAnalysis[] = [];
  // Which *forms* of the string operations a corpus uses, alongside which
  // constructs it contains. `detectFeatures` says a file uses reference
  // modification; this says whether the bounds are ones BankTS can check.
  const usage = emptyStringUsage();
  // How many files carry more than one record description, and what the
  // several records are for. `BANK-FILE-002` refuses the second one, and
  // whether that is a safety property or a hole is a question about this
  // number rather than about the two benchmark tasks that want it.
  const records = emptyRecordUsage();
  for (const path of walk(root)) {
    if (!looksLikeCobol(path)) {
      continue;
    }
    // Latin-1 rather than UTF-8. Real mainframe source that has been through a
    // codepage conversion carries bytes that are not valid UTF-8, and reading
    // it as UTF-8 replaces them with U+FFFD, which changes the text being
    // measured. Latin-1 is total: every byte maps to a character, so nothing is
    // silently substituted.
    const text = readFileSync(join(root, path)).toString("latin1");
    const provenance = provenanceOf(path);
    files.push(analyseFile(path, text, provenance));
    addStringUsage(text, usage);
    addRecordUsage(text, records, provenance);
  }
  const analysis = summarise(id, files);
  analysis.stringUsage = usage;
  analysis.recordUsage = records;
  return analysis;
}

/** The report a person reads, generated from the analysis and nothing else. */
export function renderAnalysis(analysis: CorpusAnalysis): string {
  const definition = corpusById(analysis.corpus);
  const gaps = supportGaps(
    analysis,
    (feature) => supportFor(feature)?.support ?? null,
  );
  const rate = (count: number): string =>
    analysis.discovered === 0
      ? "0"
      : `${String(count)} / ${String(analysis.discovered)} (${((count / analysis.discovered) * 100).toFixed(1)}%)`;

  const lines = [
    `# ${definition.name}: horizontal coverage`,
    "",
    `**Upstream** ${definition.upstream}`,
    "",
    `**Citation** ${definition.citation}`,
    "",
    `**Licence** ${definition.licence}, redistribution: ${definition.redistribution}`,
    "",
    `**What this establishes.** ${definition.establishes}`,
    "",
    `**What it does not.** ${definition.limits}`,
    "",
    "## Reading the corpus",
    "",
    "| | |",
    "| --- | --- |",
    `| COBOL files discovered | ${String(analysis.discovered)} |`,
    `| analysed without error | ${rate(analysis.analysed)} |`,
    `| analyser failures | ${String(analysis.analyserFailures)} |`,
    "",
    "## Representability under BankTS",
    "",
    "Every percentage is of the files discovered, and a file is counted once.",
    "This is a statement about what BankTS can express, not about whether any",
    "program is correct: nothing in this corpus carries an expected output.",
    "",
    "| Verdict | Files |",
    "| --- | --- |",
    ...Object.entries(analysis.representability).map(
      ([verdict, count]) => `| ${verdict} | ${rate(count)} |`,
    ),
    "",
    "## Constructs BankTS cannot express, by how often they occur",
    "",
    gaps.length === 0
      ? "_No unsupported construct occurs in this corpus._"
      : "| Construct | Support | Files | Share of corpus |",
    ...(gaps.length === 0
      ? []
      : [
          "| --- | --- | --- | --- |",
          ...gaps.map(
            (gap) =>
              `| \`${gap.feature}\` | ${gap.support} | ${String(gap.files)} | ${gap.share} |`,
          ),
        ]),
    "",
    "## Every construct found, by frequency",
    "",
    "| Construct | Files | Lines | BankTS |",
    "| --- | --- | --- | --- |",
    ...Object.entries(analysis.featureFiles)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([feature, files]) =>
          `| \`${feature}\` | ${String(files)} | ${String(analysis.featureLines[feature] ?? 0)} | ${supportFor(feature)?.support ?? "unclassified"} |`,
      ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The evidence bundle for one corpus.
 *
 * `files.json` carries one row per file: its path inside the corpus, the sha256
 * of the bytes measured, the repository it came from and the constructs found.
 * That is provenance and measurement, which is what makes a number checkable,
 * and it is not the corpus. No COBOL is copied out of the cache.
 */
export function writeEvidence(
  analysis: CorpusAnalysis,
  cwd = process.cwd(),
): string[] {
  const root = resolve(cwd, "evidence", "horizontal", analysis.corpus);
  mkdirSync(root, { recursive: true });

  const written: string[] = [];
  const write = (name: string, content: string): void => {
    const path = join(root, name);
    writeFileSync(path, content, "utf8");
    written.push(relative(cwd, path));
  };

  write(
    "environment.json",
    `${JSON.stringify(describeEnvironment(cwd), null, 2)}\n`,
  );
  write(
    "summary.json",
    `${JSON.stringify(
      {
        corpus: analysis.corpus,
        discovered: analysis.discovered,
        analysed: analysis.analysed,
        analyserFailures: analysis.analyserFailures,
        representability: analysis.representability,
      },
      null,
      2,
    )}\n`,
  );
  write(
    "features.json",
    `${JSON.stringify(
      {
        files: analysis.featureFiles,
        lines: analysis.featureLines,
      },
      null,
      2,
    )}\n`,
  );
  write(
    "gaps.json",
    `${JSON.stringify(
      supportGaps(analysis, (feature) => supportFor(feature)?.support ?? null),
      null,
      2,
    )}\n`,
  );
  write(
    "files.json",
    `${JSON.stringify(
      analysis.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        bytes: file.bytes,
        provenance: file.provenance,
        programId: file.programId,
        analysed: file.analysed,
        failure: file.failure,
        representability: file.representability,
        features: Object.keys(file.features).sort(),
      })),
      null,
      2,
    )}\n`,
  );
  // The form breakdown, which is what decides a representability rule for a
  // construct that is really a family: `FIELD(1:4)` and `FIELD(WS-I:WS-LEN)`
  // are the same syntax and a different language.
  if (analysis.stringUsage) {
    write(
      "string-usage.json",
      `${JSON.stringify(analysis.stringUsage, null, 2)}\n`,
    );
  }
  // What the several records under one FD are for, which is what decides
  // whether BANK-FILE-002 is protecting anything.
  if (analysis.recordUsage) {
    write(
      "record-usage.json",
      `${JSON.stringify(analysis.recordUsage, null, 2)}\n`,
    );
  }
  write("summary.md", renderAnalysis(analysis));
  return written;
}

function main(argv: string[]): number {
  const cwd = process.cwd();
  const wanted = argv.filter((argument) => !argument.startsWith("--"));
  const selected = wanted.length > 0 ? wanted : ANALYSABLE;

  let failed = false;
  for (const id of selected) {
    if (!CORPORA.some((entry) => entry.id === id)) {
      process.stderr.write(`No corpus '${id}'.\n`);
      failed = true;
      continue;
    }
    const analysis = analyseCorpus(id, cwd);
    if (!analysis) {
      process.stdout.write(
        `${id.padEnd(14)} not in the cache. Run \`pnpm horizontal:fetch ${id}\`.\n`,
      );
      continue;
    }
    const written = writeEvidence(analysis, cwd);
    process.stdout.write(
      `${id.padEnd(14)} ${String(analysis.discovered)} files, ${String(analysis.analysed)} analysed, ${String(analysis.analyserFailures)} analyser failures\n`,
    );
    for (const [verdict, count] of Object.entries(analysis.representability)) {
      if (count > 0) {
        process.stdout.write(`  ${verdict.padEnd(34)} ${String(count)}\n`);
      }
    }
    process.stdout.write(`  wrote ${written.length} evidence files\n`);
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
