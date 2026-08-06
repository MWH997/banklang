/**
 * `bankc test` over every example, and `bankc job` over every job.
 *
 * CI used to do this with a shell loop over every directory under `examples`,
 * which is the sixth place in this repository to enumerate them by hand and the
 * sixth to assume each one is a single program. `end-of-day-settlement` is not:
 * a night is several programs and a sort in one stream, so that directory holds
 * a `job.json` and a subdirectory per program. The loop ran `bankc test` on the
 * job directory, found no `src/main.bank.ts`, and stopped the build with a
 * stack trace.
 *
 * `tools/example-projects.ts` exists because the same mistake had already been
 * made five times. This is that enumeration applied to the one place still
 * doing it by hand — and `tests/example-corpus.test.ts` holds the workflow to
 * calling this rather than writing a seventh.
 *
 * Usage: pnpm examples:verify
 */

import { exampleJobs, exampleProjects } from "./example-projects";
import { runBankc } from "../packages/bankc-cli/src/index";

/** What to run over what: a project is tested, a job is built as a stream. */
export function verificationPlan(cwd = process.cwd()): {
  command: "test" | "job";
  path: string;
}[] {
  return [
    ...exampleProjects(cwd).map((path) => ({ command: "test", path }) as const),
    ...exampleJobs(cwd).map((path) => ({ command: "job", path }) as const),
  ];
}

function main(): void {
  const plan = verificationPlan();
  const failed: string[] = [];

  for (const { command, path } of plan) {
    // GitHub folds a group, so a passing example is one line and a failing one
    // is still readable in full.
    console.log(`::group::bankc ${command} ${path}`);
    const result = runBankc([command, path], process.cwd());
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.log("::endgroup::");
    if (result.exitCode !== 0) {
      failed.push(`${command} ${path}`);
    }
  }

  console.log(
    `\n${String(plan.length)} example(s): ${String(plan.length - failed.length)} passed, ${String(failed.length)} failed.`,
  );

  if (failed.length > 0) {
    console.error(`\nFailed:\n${failed.map((one) => `  ${one}`).join("\n")}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("verify-examples.ts")) {
  main();
}
