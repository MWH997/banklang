/**
 * The reports, generated from result JSON and never maintained by hand.
 *
 *   pnpm horizontal:report
 *
 * Writes `docs/validation/horizontal-validation-results.md` and the OpenCBS
 * defect matrix from whatever the lanes last measured. Nothing here computes a
 * result; it renders `evidence/horizontal/*` and says so, which is the only way
 * a published number and a measured number stay the same number.
 *
 * A lane that has not run is reported as not run. That is deliberate and it is
 * the reason this tool is separate from the lanes: a report that silently
 * carried yesterday's figure for a corpus nobody measured today would be worse
 * than one with a gap in it.
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

import {
  CORPORA,
  DEFECT_DEMONSTRATIONS,
  DEFECT_FAMILIES,
  blockerFor,
  corpus,
  familyOf,
  formatRate,
  ibmClaimSentence,
  ibmValidationStatus,
  parseDefect,
  supportFor,
  type CorpusTally,
  type DefectCase,
  type DefectCoverage,
  type RunEnvironment,
} from "../packages/horizontal-validation/src/index";
import { corpusDir } from "./horizontal-fetch";
import { snapshotIndex, snapshotRepresentability } from "./horizontal-snapshot";

const EVIDENCE = "evidence/horizontal";

/** Where an IBM run's imported result lands, if one ever exists. */
export const IBM_RESULT_PATH = "evidence/ibm/result.json";

/**
 * The IBM claim, derived rather than typed.
 *
 * This paragraph used to be four string literals in the middle of this
 * function, which is a disclaimer that survives only as long as everybody
 * remembers it. It now comes from whatever is on disk: with no imported result
 * the only reachable sentence says the validation has not been performed, and
 * `tests/ibm-validation-bundle.test.ts` holds that.
 */
function ibmParagraph(cwd: string): string[] {
  const path = resolve(cwd, IBM_RESULT_PATH);
  const status = ibmValidationStatus(
    existsSync(path) ? readFileSync(path, "utf8") : null,
  );
  return [
    "**Target: IBM Enterprise COBOL 6.4. Runtime validation: GnuCOBOL.**",
    ibmClaimSentence(status),
    "",
    status.performed
      ? "The imported result is in `evidence/ibm/result.json`; every other number on this page was produced without an IBM compiler."
      : "Nothing on this page was produced by an IBM compiler, and no result here establishes behaviour under one.",
    "",
  ];
}

function readJson<T>(path: string): T | null {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as T)
    : null;
}

/* ------------------------------------------------------------------ *
 * The OpenCBS defect matrix
 * ------------------------------------------------------------------ */

export interface DefectRow {
  defect: string;
  title: string;
  family: string;
  coverage: DefectCoverage;
  /** The diagnostic proving it, where a demonstration exists. */
  diagnostic: string | null;
}

/**
 * One row per upstream defect, with what this repository has shown about it.
 *
 * The only route to `prevented-at-compile-time` is a demonstration in
 * `packages/horizontal-validation/src/defect-demonstrations.ts`, which
 * `tests/horizontal-defects.test.ts` compiles on every run. Everything else is
 * `not-demonstrated`, however obvious the answer looks — a defect family whose
 * mechanism is named but never exercised is a claim, and this matrix does not
 * print claims.
 */
export function defectMatrix(cwd = process.cwd()): DefectRow[] {
  const programs = join(corpusDir("opencbs", cwd), "COBOL_Programs");
  if (!existsSync(programs)) {
    return [];
  }
  const demonstrated = new Map(
    DEFECT_DEMONSTRATIONS.map((entry) => [entry.defect, entry]),
  );

  const rows: DefectRow[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(programs).sort()) {
    const defect: DefectCase | null = parseDefect(
      file,
      readFileSync(join(programs, file)).toString("latin1"),
    );
    if (!defect || defect.title === "" || seen.has(defect.id)) {
      continue;
    }
    seen.add(defect.id);
    const shown = demonstrated.get(defect.id);
    const family = familyOf(defect);
    rows.push({
      defect: defect.id,
      title: defect.title,
      family: family?.family ?? "unclassified",
      coverage: shown?.coverage ?? "not-demonstrated",
      diagnostic: shown?.expectDiagnostic ?? null,
    });
  }
  return rows;
}

function renderDefectMatrix(rows: DefectRow[]): string {
  if (rows.length === 0) {
    return [
      "# OpenCBS defect coverage",
      "",
      "_The corpus is not in the local cache, so no matrix was produced._",
      "Run `pnpm horizontal:fetch opencbs` and then `pnpm horizontal:report`.",
      "",
    ].join("\n");
  }

  const count = (coverage: DefectCoverage): number =>
    rows.filter((row) => row.coverage === coverage).length;

  const definition = corpus("opencbs");
  return `${[
    "# OpenCBS defect coverage",
    "",
    "<!-- Generated by `pnpm horizontal:report`. Do not edit. -->",
    "",
    `**Upstream** ${definition.upstream}`,
    "",
    `**Citation** ${definition.citation}`,
    "",
    "Defects real COBOL developers reported on public forums, reconstructed as",
    "programs. Each carries the defective code as comments and the corrected code",
    "live, so both halves are recoverable.",
    "",
    "## What this repository has shown",
    "",
    "`prevented-at-compile-time` requires a BankTS program that the compiler",
    "refuses, named in `packages/horizontal-validation/src/defect-demonstrations.ts`",
    "and compiled by `tests/horizontal-defects.test.ts` on every run. Nothing else",
    "may claim it. `not-demonstrated` means exactly that — not that BankLang",
    "would fail to catch the defect, but that this repository has not shown it.",
    "",
    "| Coverage | Defects |",
    "| --- | --- |",
    `| prevented at compile time | ${formatRate(count("prevented-at-compile-time"), rows.length)} |`,
    `| not expressible in BankTS at all | ${formatRate(count("not-expressible-in-bankts"), rows.length)} |`,
    `| outside BankLang's model | ${formatRate(count("outside-banklang-model"), rows.length)} |`,
    `| not demonstrated | ${formatRate(count("not-demonstrated"), rows.length)} |`,
    "",
    "## Every defect",
    "",
    "| Defect | Family | What went wrong | Coverage | Diagnostic |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.defect} | ${row.family} | ${row.title.toLowerCase()} | ${row.coverage} | ${row.diagnostic ? `\`${row.diagnostic}\`` : "—"} |`,
    ),
    "",
    "## Families, and what BankLang says about each",
    "",
    ...DEFECT_FAMILIES.flatMap((family) => [
      `### ${family.family}`,
      "",
      family.mechanism
        ? `**Mechanism** ${family.mechanism}`
        : "**Mechanism** none — see below.",
      "",
      family.banklangPosition,
      "",
    ]),
  ].join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * The overall results page
 * ------------------------------------------------------------------ */

interface CoverageSummary {
  corpus: string;
  discovered: number;
  analysed: number;
  analyserFailures: number;
  representability: Record<string, number>;
}

function renderResults(cwd: string): string {
  const environment = readJson<RunEnvironment>(
    resolve(cwd, EVIDENCE, "xcobol-v2", "environment.json"),
  );

  const lines: string[] = [
    "# Horizontal validation — results",
    "",
    "<!-- Generated by `pnpm horizontal:report`. Do not edit. -->",
    "",
    "What happens when this compiler is confronted with COBOL, specifications and",
    "defects that were not written for it. The method is in",
    "[horizontal-validation.md](horizontal-validation.md); this page is the",
    "measurement, and every number on it is read out of `evidence/horizontal/`.",
    "",
    "## The compiler these numbers came from",
    "",
  ];

  if (environment) {
    lines.push(
      "| | |",
      "| --- | --- |",
      `| BankLang | ${environment.banklangVersion} |`,
      `| Node | ${environment.nodeVersion} |`,
      `| COBOL compiler | ${environment.gnucobolVersion ?? "not available — nothing was executed"} |`,
      `| platform | ${environment.platform}/${environment.arch} |`,
      `| corpus lock | \`${environment.corpusLockHash.slice(0, 12)}\` |`,
      "",
      /*
       * The commit is deliberately not on this page.
       *
       * It changes with every commit, including the one that publishes this
       * page, so printing it here means the page is stale the moment it is
       * committed — and the workflow that compares generated output against
       * git would fail on every run for a reason that is about bookkeeping
       * rather than about the measurement. It is recorded per lane in
       * `evidence/horizontal/<corpus>/environment.json`, which is where the
       * provenance of a specific run belongs.
       */
      "The exact commit each lane ran on is in",
      "`evidence/horizontal/<corpus>/environment.json`.",
      "",
    );
  } else {
    lines.push("_No lane has been run on this checkout._", "");
  }

  lines.push(
    ...ibmParagraph(cwd),
    "## Corpora",
    "",
    "| Corpus | Version | Licence | Redistribution |",
    "| --- | --- | --- | --- |",
    ...CORPORA.map(
      (entry) =>
        `| ${entry.name} | ${describeRevision(entry.id)} | ${entry.licence} | ${entry.redistribution} |`,
    ),
    "",
  );

  // ---- semantic ------------------------------------------------------
  lines.push("## Independent semantic benchmarks", "");
  let anySemantic = false;
  for (const id of ["cobolcodebench", "coboleval"]) {
    const summary = readJson<CorpusTally>(
      resolve(cwd, EVIDENCE, id, "summary.json"),
    );
    if (!summary) {
      continue;
    }
    anySemantic = true;
    const definition = corpus(id);
    lines.push(
      `### ${definition.name}`,
      "",
      `${definition.establishes}`,
      "",
      "| | |",
      "| --- | --- |",
      `| tasks discovered | ${String(summary.discovered)} |`,
      `| imported into the harness | ${String(summary.imported)} |`,
      `| applicable — BankTS can express it | ${String(summary.applicable)} |`,
      `| unsupported by design | ${String(summary.unsupportedByDesign)} |`,
      `| unsupported, not yet implemented | ${String(summary.unsupportedNotYetImplemented)} |`,
      `| the benchmark's own expectation is not derivable | ${String(summary.benchmarkAmbiguous)} |`,
      `| implementations written | ${String(summary.authored)} |`,
      `| executed | ${String(summary.executed)} |`,
      `| both engines ran it | ${String(summary.bothEngines)} |`,
      `| they agreed | ${String(summary.agreements)} |`,
      `| they diverged | ${String(summary.divergences)} |`,
      `| ran under \`cobc\` only — never a differential pass | ${String(summary.interpreterUnavailable)} |`,
      `| **authored, of applicable** | **${summary.authoringCoverage}** |`,
      `| **passed, of authored** | **${summary.passOfAuthored}** |`,
      `| **passed, of applicable** | **${summary.passOfApplicable}** |`,
      `| **passed, of all discovered** | **${summary.passOfDiscovered}** |`,
      "",
    );
    /*
     * Why each non-applicable task is non-applicable, from the recorded
     * blockers rather than from a number a reader has to interpret.
     *
     * Keyed on applicability rather than on whether the task ran. Some
     * non-applicable tasks are authored and executed — a benchmark whose
     * expected output is not derivable is best evidenced by running against it
     * and reading the byte that differs — so listing only what never ran gave
     * a table whose count did not reconcile with the summary above it.
     */
    const results = readJson<
      {
        taskId: string;
        applicability: string;
        outcome: string;
        detail: string | null;
      }[]
    >(resolve(cwd, EVIDENCE, id, "results.json"));
    if (results) {
      const kinds = new Map<string, string[]>();
      for (const row of results) {
        if (row.applicability === "applicable") {
          continue;
        }
        const task = row.taskId.split("/").pop() ?? row.taskId;
        // The recorded blocker where there is one, and the applicability
        // otherwise — the rules produce no blocker entry, so `randomness` and
        // the like still come from the detail the run wrote.
        const kind =
          blockerFor(task)?.kind ??
          (row.detail ?? "").split(":")[0]?.trim() ??
          row.applicability;
        kinds.set(kind, [...(kinds.get(kind) ?? []), task]);
      }
      if (kinds.size > 0) {
        lines.push(
          "Why the rest are not applicable:",
          "",
          "| Reason | Tasks | |",
          "| --- | --- | --- |",
          ...[...kinds]
            .sort((a, b) => b[1].length - a[1].length)
            .map(
              ([kind, tasks]) =>
                `| ${kind} | ${String(tasks.length)} | ${tasks.join(", ")} |`,
            ),
          "",
        );
      }
    }

    if (Object.keys(summary.failures).length > 0) {
      lines.push(
        "| Failure | Tasks |",
        "| --- | --- |",
        ...Object.entries(summary.failures)
          .sort((a, b) => b[1] - a[1])
          .map(([outcome, count]) => `| ${outcome} | ${String(count)} |`),
        "",
      );
    }
  }
  if (!anySemantic) {
    lines.push("_Not run on this checkout._", "");
  }

  // ---- coverage ------------------------------------------------------
  lines.push("## Real-world coverage", "");
  let anyCoverage = false;
  for (const id of ["xcobol-v2", "opencbs"]) {
    const summary = readJson<CoverageSummary>(
      resolve(cwd, EVIDENCE, id, "summary.json"),
    );
    if (!summary) {
      continue;
    }
    anyCoverage = true;
    const definition = corpus(id);
    lines.push(
      `### ${definition.name}`,
      "",
      definition.limits,
      "",
      "| | |",
      "| --- | --- |",
      `| COBOL files discovered | ${String(summary.discovered)} |`,
      `| read without error | ${formatRate(summary.analysed, summary.discovered)} |`,
      `| analyser failures | ${String(summary.analyserFailures)} |`,
      "",
      "| Representability | Files |",
      "| --- | --- |",
      ...Object.entries(summary.representability).map(
        ([verdict, count]) =>
          `| ${verdict} | ${formatRate(count, summary.discovered)} |`,
      ),
      "",
    );

    const gaps = readJson<
      { feature: string; support: string; files: number; share: string }[]
    >(resolve(cwd, EVIDENCE, id, "gaps.json"));
    if (gaps && gaps.length > 0) {
      lines.push(
        "Constructs BankTS cannot express, ranked by how often they occur:",
        "",
        "| Construct | Support | Files | Share |",
        "| --- | --- | --- | --- |",
        ...gaps
          .slice(0, 15)
          .map(
            (gap) =>
              `| \`${gap.feature}\` | ${gap.support} | ${String(gap.files)} | ${gap.share} |`,
          ),
        "",
        `The rules behind each verdict are in \`packages/horizontal-validation/src/representability.ts\`, one row per construct. ${supportFor("inspect")?.note ?? ""}`,
        "",
      );
    }
  }
  if (!anyCoverage) {
    lines.push("_Not run on this checkout._", "");
  }

  // ---- what each language change moved --------------------------------
  //
  // Computed from `evidence/horizontal-history/`, which holds the counts as
  // they stood before each feature landed. Written out rather than summarised,
  // because "line-sequential moved 155 files" is exactly the kind of claim that
  // gets rounded up in the retelling.
  const history = snapshotIndex(cwd);
  if (history.length > 0) {
    const current = readJson<CoverageSummary>(
      resolve(cwd, EVIDENCE, "xcobol-v2", "summary.json"),
    );
    lines.push(
      "## What each language change moved",
      "",
      "X-COBOL representability before and after each feature, over the same",
      "5,195 files. The before column is the measurement as it stood on the",
      "commit named in `evidence/horizontal-history/index.json`.",
      "",
    );
    for (const entry of history) {
      const before = snapshotRepresentability(entry.label, "xcobol-v2", cwd);
      if (!before || !current) {
        continue;
      }
      lines.push(
        `### \`${entry.label}\``,
        "",
        `Measured against \`${entry.gitCommit.slice(0, 12)}\`.`,
        "",
        "| Verdict | Before | After | Change |",
        "| --- | --- | --- | --- |",
        ...Object.keys(current.representability).map((verdict) => {
          const was = before[verdict] ?? 0;
          const now = current.representability[verdict] ?? 0;
          const delta = now - was;
          return `| ${verdict} | ${String(was)} | ${String(now)} | ${delta > 0 ? "+" : ""}${String(delta)} |`;
        }),
        "",
      );
    }
  }

  // ---- defects and conformance ---------------------------------------
  const matrix = defectMatrix(cwd);
  lines.push(
    "## Defect benchmark",
    "",
    matrix.length === 0
      ? "_Not run on this checkout._"
      : `${String(matrix.length)} reconstructed defects. ${String(matrix.filter((row) => row.coverage === "prevented-at-compile-time").length)} are prevented at compile time by a BankTS program the compiler refuses; see [the matrix](horizontal-defect-coverage.md).`,
    "",
    "## COBOL conformance",
    "",
  );
  const ccvs = readJson<{
    available: boolean;
    location: string;
    discovered: number;
    applicable: number;
  }>(resolve(cwd, EVIDENCE, "ccvs85-local", "summary.json"));
  lines.push(
    ccvs?.available
      ? `NIST COBOL-85, supplied locally: ${String(ccvs.discovered)} sources discovered, ${String(ccvs.applicable)} in modules this backend emits.`
      : "NIST COBOL-85 is never downloaded or redistributed by this repository. No local copy was supplied, so this lane is **unavailable** — which is not the same as passing.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function describeRevision(id: string): string {
  const entry = corpus(id).fetch;
  switch (entry.kind) {
    case "github":
      return `\`${entry.ref.slice(0, 12)}\``;
    case "huggingface":
      return `\`${entry.revision.slice(0, 12)}\``;
    case "zenodo":
      return `DOI 10.5281/zenodo.${entry.record}`;
    case "local":
      return "operator-supplied";
  }
}

function main(): number {
  const cwd = process.cwd();
  const docs = resolve(cwd, "docs", "validation");
  mkdirSync(docs, { recursive: true });

  const results = join(docs, "horizontal-validation-results.md");
  writeFileSync(results, renderResults(cwd), "utf8");

  const matrix = join(docs, "horizontal-defect-coverage.md");
  writeFileSync(matrix, renderDefectMatrix(defectMatrix(cwd)), "utf8");

  process.stdout.write(`Wrote ${results}\nWrote ${matrix}\n`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
