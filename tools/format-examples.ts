import { runBankc } from "../packages/bankc-cli/src/index";
import { exampleProjects } from "./example-projects";

/**
 * Formats every checked-in example, or verifies formatting with `--check`.
 *
 * Used by `pnpm fmt` and `pnpm fmt:check`, and by the formatting step in CI.
 */
const checkOnly = process.argv.includes("--check");

const examples = exampleProjects();

let failed = false;

for (const example of examples) {
  const args = ["fmt", example, ...(checkOnly ? ["--check"] : [])];
  const result = runBankc(args, process.cwd());

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.exitCode !== 0) {
    failed = true;
  }
}

if (failed) {
  process.stderr.write(
    checkOnly
      ? "\nSome examples are not formatted. Run `pnpm fmt`.\n"
      : "\nFormatting failed.\n",
  );
  process.exitCode = 1;
}
