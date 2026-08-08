/**
 * Reading a corpus of real COBOL and saying what is in it.
 *
 * The measurement behind X-COBOL and OpenCBS. It answers three questions and
 * is careful to keep them apart, because conflating them is how a coverage
 * corpus gets reported as though it proved something about correctness.
 *
 *   1. Does this toolchain's reader survive real COBOL? An exception here is a
 *      defect in `packages/migration-analysis`, found by input nobody wrote for
 *      it, and it is reported as one.
 *   2. What constructs does real COBOL contain, and how often?
 *   3. Which of those can BankTS represent?
 *
 * The third is a statement about language scope and nothing else. No file here
 * has an expected output, so nothing here can establish that any program
 * computes anything correctly — and a reader of the report is told so in the
 * same breath as the number.
 */

import { analyseCobol } from "../../migration-analysis/src/index";
import type { FeatureCounts } from "../../migration-analysis/src/features";
import { classifyProgram, type Representability } from "./representability";
import { hashBytes } from "./lock";

export interface FileAnalysis {
  /** Path inside the corpus cache. Never an absolute path. */
  path: string;
  sha256: string;
  bytes: number;
  /** Provenance where the corpus supplies it: the repository a file came from. */
  provenance: string | null;
  programId: string | null;
  statementLines: number;
  /** True when the reader completed. False means a defect worth fixing. */
  analysed: boolean;
  /** The exception, when the reader threw. */
  failure: string | null;
  features: FeatureCounts;
  representability: Representability;
  /** Features that decided the verdict. */
  deciding: string[];
}

export interface CorpusAnalysis {
  corpus: string;
  /** Files the corpus contains that look like COBOL. Never reduced. */
  discovered: number;
  analysed: number;
  analyserFailures: number;
  /** Files per verdict, summing to `discovered`. */
  representability: Record<Representability, number>;
  /** How many files contain each feature, and how many lines use it. */
  featureFiles: Record<string, number>;
  featureLines: Record<string, number>;
  files: FileAnalysis[];
  /**
   * Which forms of the string operations the corpus uses.
   *
   * Set by the caller after `summarise`, because it is accumulated while the
   * files are read rather than derived from the per-file rows. Optional so a
   * corpus nobody measured it for still summarises.
   */
  stringUsage?: unknown;
}

/** Extensions the corpora use for COBOL. `.cpy` is a copybook, not a program. */
export const COBOL_EXTENSIONS = [".cbl", ".cob", ".ccp", ".cobol"];

export function looksLikeCobol(path: string): boolean {
  const lower = path.toLowerCase();
  return COBOL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * One file, read defensively.
 *
 * `analyseCobol` is a reader over untrusted text and this is the first place it
 * has ever been given five thousand files of somebody else's COBOL. It is
 * expected to survive all of them; where it does not, the file is recorded as
 * an analyser failure with the message, and the run continues. A crash that
 * took the whole corpus down would turn one defect into no measurement at all.
 */
export function analyseFile(
  path: string,
  text: string,
  provenance: string | null = null,
): FileAnalysis {
  const base = {
    path,
    sha256: hashBytes(text),
    bytes: Buffer.byteLength(text, "utf8"),
    provenance,
  };
  try {
    const analysis = analyseCobol(text, path);
    const verdict = classifyProgram(analysis.features);
    return {
      ...base,
      programId: analysis.programId,
      statementLines: analysis.statementLines,
      analysed: true,
      failure: null,
      features: analysis.features,
      representability: verdict.verdict,
      deciding: verdict.deciding,
    };
  } catch (error) {
    return {
      ...base,
      programId: null,
      statementLines: 0,
      analysed: false,
      failure: error instanceof Error ? error.message : String(error),
      features: {},
      representability: "analyser-failure",
      deciding: [],
    };
  }
}

const EMPTY_REPRESENTABILITY: Record<Representability, number> = {
  "fully-representable": 0,
  "representable-with-adaptation": 0,
  "unsupported-by-design": 0,
  "unsupported-not-yet-implemented": 0,
  "analyser-failure": 0,
  unknown: 0,
};

/** The corpus-wide totals, derived from the per-file rows and nothing else. */
export function summarise(
  corpus: string,
  files: FileAnalysis[],
): CorpusAnalysis {
  const representability = { ...EMPTY_REPRESENTABILITY };
  const featureFiles: Record<string, number> = {};
  const featureLines: Record<string, number> = {};

  for (const file of files) {
    representability[file.representability] += 1;
    for (const [name, count] of Object.entries(file.features)) {
      featureFiles[name] = (featureFiles[name] ?? 0) + 1;
      featureLines[name] = (featureLines[name] ?? 0) + count;
    }
  }

  return {
    corpus,
    discovered: files.length,
    analysed: files.filter((file) => file.analysed).length,
    analyserFailures: files.filter((file) => !file.analysed).length,
    representability,
    featureFiles,
    featureLines,
    files,
  };
}

/**
 * Unsupported constructs ranked by how often they actually occur.
 *
 * The output of this whole exercise that is worth the most: a list of what to
 * build next, ordered by the real world rather than by whoever asked loudest. A
 * feature BankTS lacks that appears in four files is a curiosity; one that
 * appears in nine hundred is a decision.
 */
export function supportGaps(
  analysis: CorpusAnalysis,
  supportOf: (feature: string) => string | null,
): { feature: string; support: string; files: number; share: string }[] {
  return Object.entries(analysis.featureFiles)
    .map(([feature, files]) => ({
      feature,
      support: supportOf(feature) ?? "unclassified",
      files,
      share:
        analysis.discovered === 0
          ? "0%"
          : `${((files / analysis.discovered) * 100).toFixed(1)}%`,
    }))
    .filter(
      (row) => row.support !== "supported" && row.support !== "unclassified",
    )
    .sort((a, b) => b.files - a.files);
}
