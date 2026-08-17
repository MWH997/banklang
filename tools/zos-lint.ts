/**
 * Run the z/OS semantics pass over everything this repository ships.
 *
 * The same artifacts the conformance linter reads (fresh output from every
 * example, the checked-in fixtures and the evidence bundles) asked a different
 * question. See `packages/zos-lint/src/index.ts` for which question and why it
 * needed its own lane.
 *
 *   pnpm lint:zos
 */

import { pathToFileURL } from "node:url";

import {
  formatZosFindings,
  lintZos,
  type ZosFinding,
} from "../packages/zos-lint/src/index";
import { checkedInArtifacts, freshArtifacts } from "./generated-artifacts";

export function lintZosAll(cwd = process.cwd()): ZosFinding[] {
  return [...freshArtifacts(cwd), ...checkedInArtifacts(cwd)].flatMap(
    (artifact) => lintZos(artifact.file, artifact.text),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const findings = lintZosAll(process.cwd());
  process.stdout.write(formatZosFindings(findings));
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
