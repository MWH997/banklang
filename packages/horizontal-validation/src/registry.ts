/**
 * The external corpora this compiler is measured against, named and pinned.
 *
 * Every other check in this repository is *vertical*: a test written for
 * BankLang, run against BankLang, passing because BankLang does what the person
 * who wrote the test expected. Thousands of them, and they share one blind
 * spot: they cannot tell you what happens when the compiler meets a program
 * nobody wrote for it. A shared misreading between the test and the code agrees
 * with itself perfectly, which is the same argument `packages/cobol-runtime`
 * exists to answer for execution.
 *
 * So these are corpora built by other people, for other purposes, before this
 * project existed. None of them was designed around BankTS and none of them can
 * be quietly adjusted when it reports something unwelcome.
 *
 * **Nothing here is fetched by a test.** A corpus is downloaded by
 * `tools/horizontal.ts` into an ignored cache and pinned by
 * `validation/corpus-lock.json`; the suite reads what is already on disk and
 * skips when it is absent. A validation lane that silently depends on somebody
 * else's server being up is a lane that reports a compiler defect when the
 * network is slow.
 */

import { CompilerInvariant } from "../../diagnostics/src/errors";

/**
 * How a corpus is obtained.
 *
 * `local` is not a lesser case. The NIST COBOL-85 validation suite is
 * deliberately never downloaded by this repository (see `ccvs85-local` below)
 * and the adapter for it has to be exactly as real as the others.
 */
export type FetchMechanism =
  | {
      kind: "github";
      owner: string;
      repo: string;
      ref: string;
      paths: string[];
    }
  | { kind: "huggingface"; dataset: string; revision: string; files: string[] }
  | { kind: "zenodo"; record: string; files: string[] }
  | { kind: "local"; envVar: string };

/**
 * What a corpus is for, which decides what a result from it may claim.
 *
 * The distinction matters more than it looks. A `semantic` corpus ships an
 * oracle, expected output for a given input, so a run of it produces a
 * pass or a failure. A `coverage` corpus is a pile of real programs with no
 * expected behaviour attached: it can tell you what COBOL people write and
 * whether this toolchain can read it, and it cannot tell you that anything is
 * correct. Reporting a coverage corpus as though it were a semantic one is the
 * single easiest way to overstate what external validation established, so the
 * category is carried on the corpus rather than remembered by the reader.
 */
export type CorpusCategory = "semantic" | "coverage" | "defect" | "conformance";

/**
 * Whether the corpus's own material may be committed to this repository.
 *
 * Separate from the licence, because the two answers genuinely differ.
 * `redistributable` means the upstream licence permits it *and* this project
 * has determined the permission covers what would be copied. `derived-only`
 * means statistics, hashes and identifiers may be published while the source
 * may not, which is the right answer for a dataset that aggregates 168 other
 * people's repositories under a licence covering the *compilation* rather than
 * the contents. `none` means not even a hash goes in until somebody supplies
 * the corpus themselves.
 */
export type RedistributionPolicy = "redistributable" | "derived-only" | "none";

export interface CorpusDefinition {
  /** Stable identifier, used in paths, lock entries and result rows. */
  id: string;
  name: string;
  /** Where a reader goes to check this entry against the source. */
  upstream: string;
  /** The paper or dataset record this corpus comes from, for citation. */
  citation: string;
  category: CorpusCategory;
  /** SPDX identifier the upstream declares for the corpus as a whole. */
  licence: string;
  redistribution: RedistributionPolicy;
  fetch: FetchMechanism;
  /** What this corpus can establish, and what it cannot. Printed in reports. */
  establishes: string;
  limits: string;
}

/**
 * The corpora, in the order the validation pyramid stacks them.
 *
 * Each `licence` and `ref` here was read off the upstream API on 2026-08-08 and
 * is pinned again, with checksums, in `validation/corpus-lock.json`. This table
 * says what a corpus *is*; the lock says which bytes were measured.
 */
export const CORPORA: CorpusDefinition[] = [
  {
    id: "cobolcodebench",
    name: "CobolCodeBench",
    upstream: "https://huggingface.co/datasets/harshini-kumar/CobolCodeBench",
    citation:
      "harshini-kumar/CobolCodeBench, Hugging Face datasets, revision 9d02534b7d1aabcbac1a1ec21c5a5e80c50323a8",
    category: "semantic",
    licence: "Apache-2.0",
    redistribution: "redistributable",
    fetch: {
      kind: "huggingface",
      dataset: "harshini-kumar/CobolCodeBench",
      revision: "9d02534b7d1aabcbac1a1ec21c5a5e80c50323a8",
      files: ["CobolCodeBench_Dataset.jsonl"],
    },
    establishes:
      "Whether BankTS can independently express a program specified by somebody else in prose, and whether the COBOL this compiler emits for it produces the byte-exact output files the benchmark expects.",
    limits:
      "46 tasks, written as general file-processing exercises rather than banking programs. A task BankTS cannot express is a fact about the language's chosen scope, not a compiler defect.",
  },
  {
    id: "coboleval",
    name: "COBOLEval",
    upstream: "https://github.com/zorse-project/COBOLEval",
    citation:
      "zorse-project/COBOLEval, commit 0bb96c3114bb2bb28e221e9d6000614781f8609d, a COBOL transpilation of OpenAI HumanEval",
    category: "semantic",
    licence: "MIT",
    redistribution: "redistributable",
    fetch: {
      kind: "github",
      owner: "zorse-project",
      repo: "COBOLEval",
      ref: "0bb96c3114bb2bb28e221e9d6000614781f8609d",
      paths: ["data/CobolEval.jsonl"],
    },
    establishes:
      "Whether BankTS can express general algorithmic tasks against a fixed calling interface defined by somebody else, and whether the results match the benchmark's own COBOL test drivers.",
    limits:
      "146 tasks derived from HumanEval. The interface every task is defined against uses COMP-2, IEEE binary floating point, which BankTS refuses by design, so the representability figure here measures the distance between a banking language and a general-purpose one rather than a defect.",
  },
  {
    id: "xcobol-v2",
    name: "X-COBOL v2",
    upstream: "https://zenodo.org/records/14269462",
    citation:
      "X-COBOL: A Dataset of Open-Source COBOL repositories, Zenodo, DOI 10.5281/zenodo.14269462, published 2024-12-05",
    category: "coverage",
    licence: "CC-BY-4.0",
    // The Zenodo record is CC-BY-4.0. That covers the *compilation*, the act
    // of gathering 5,195 files from 168 repositories and publishing the set. It
    // does not relicense the files, each of which belongs to whoever wrote it
    // under whatever terms that repository carries, and the record ships no
    // per-file licence field to check. So the source stays in the ignored cache
    // and only measurements leave it. See `licence.ts` for the gate.
    redistribution: "derived-only",
    fetch: {
      kind: "zenodo",
      record: "14269462",
      files: ["COBOL_Files.zip", "file_stats.csv", "final_repo_statistics.csv"],
    },
    establishes:
      "What constructs real COBOL actually contains, whether this toolchain's reader survives them, and which of them BankTS can and cannot represent, ranked by how often they really occur.",
    limits:
      "No behavioural oracle. These are files, not tests: nothing here can establish that anything computes the right answer, and a representability figure is a statement about language scope rather than about correctness.",
  },
  {
    id: "opencbs",
    name: "OpenCBS COBOL defects suite",
    upstream: "https://github.com/PhaseChangeSoftware/cobol-defects-suite",
    citation:
      "D. Lee, A. Henley, B. Hinshaw, R. Pandita, 'OpenCBS: An Open-Source COBOL Defects Benchmark Suite', ICSME 2022, arXiv:2206.06260; artifact at PhaseChangeSoftware/cobol-defects-suite, commit a7a10bb0330c021c973792d1fd05275475bbcce1",
    category: "defect",
    licence: "MIT",
    redistribution: "redistributable",
    fetch: {
      kind: "github",
      owner: "PhaseChangeSoftware",
      repo: "cobol-defects-suite",
      ref: "a7a10bb0330c021c973792d1fd05275475bbcce1",
      paths: [
        "COBOL_Programs",
        "COBOL_Copybooks",
        "DEFNOTES_20211027.TXT",
        "LICENSE",
      ],
    },
    establishes:
      "Which of the defects real COBOL developers actually reported are refused by BankTS at compile time, which are outside its safety model, and which it would compile as happily as COBOL does.",
    limits:
      "Defects reconstructed from public forum posts, so they over-represent what people ask about rather than what most often reaches production. A defect BankTS cannot express at all is prevented trivially and is recorded as such rather than counted as a save.",
  },
  {
    id: "ccvs85-local",
    name: "NIST COBOL-85 validation suite (local)",
    upstream: "https://www.itl.nist.gov/div897/ctg/cobol_form.htm",
    citation:
      "NIST COBOL-85 Compiler Validation System, supplied locally by the operator; not redistributed by this repository",
    category: "conformance",
    // Not an SPDX identifier and deliberately not guessed at. The suite is a US
    // government validation product with its own distribution terms, and this
    // project has no standing to restate them.
    licence: "NOASSERTION",
    redistribution: "none",
    fetch: { kind: "local", envVar: "BANKLANG_CCVS85_DIR" },
    establishes:
      "Whether the COBOL implementation underneath this compiler behaves as the standard requires for the constructs the backend actually emits.",
    limits:
      "Validates the compiler below BankLang, not BankTS. Never downloaded and never redistributed: the operator supplies a copy and points `BANKLANG_CCVS85_DIR` at it, or the lane reports unavailable.",
  },
];

/**
 * One corpus by id, or a throw naming what is registered.
 *
 * `CompilerInvariant` rather than a bare `Error`: every id passed here comes
 * from this repository's own tooling, so an unknown one is a defect in the
 * caller rather than something a reader of a BankTS program can act on.
 */
export function corpus(id: string): CorpusDefinition {
  const found = CORPORA.find((entry) => entry.id === id);
  if (!found) {
    throw new CompilerInvariant(
      `No corpus '${id}'. Registered: ${CORPORA.map((entry) => entry.id).join(", ")}.`,
    );
  }
  return found;
}
