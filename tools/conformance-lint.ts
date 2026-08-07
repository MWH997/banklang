/**
 * Run the conformance linter over everything this repository ships.
 *
 * Three sets of artifacts, for three different reasons.
 *
 * Fresh output, because that is what the compiler produces today. The checked-in
 * fixtures, because a golden file that holds a defect freezes it — the audit
 * found `IS-ELIGIBLE-FOR-INTEREST-RESULT`, a 31-character COBOL word, sitting in
 * `tests/fixtures/batch-interest-accrual.cbl`, where every run of the test suite
 * had compared it against itself and agreed. And the `evidence/` bundles,
 * because they are the artifacts a reader is invited to check the claims
 * against, and an evidence bundle that does not meet the rules is worse than no
 * evidence at all.
 *
 * The set itself is `tools/generated-artifacts.ts`, shared with the z/OS
 * semantics lane so that the two cannot drift apart in what they read.
 *
 *   pnpm lint:conformance
 */

import { pathToFileURL } from "node:url";

import {
  formatFindings,
  lintArtifact,
  type ConformanceFinding,
} from "../packages/conformance-lint/src/index";
import {
  checkedInArtifacts,
  freshArtifacts,
  runtimePrograms,
} from "./generated-artifacts";

export function lintAll(cwd = process.cwd()): ConformanceFinding[] {
  const knownPrograms = runtimePrograms(cwd);
  return [...freshArtifacts(cwd), ...checkedInArtifacts(cwd)].flatMap(
    (artifact) => lintArtifact(artifact.file, artifact.text, { knownPrograms }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const findings = lintAll(process.cwd());
  process.stdout.write(formatFindings(findings));
  if (findings.length > 0) {
    const counts = new Map<string, number>();
    for (const finding of findings) {
      counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
    }
    process.stdout.write(
      `\n${findings.length} findings: ${[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([rule, count]) => `${rule} ${count}`)
        .join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}
