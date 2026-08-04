import { readdirSync } from "node:fs";

import { runBankc } from "../packages/bankc-cli/src/index";

/**
 * Formats every checked-in example, or verifies formatting with `--check`.
 *
 * Used by `pnpm fmt` and `pnpm fmt:check`, and by the formatting step in CI.
 */
const checkOnly = process.argv.includes("--check");

const examples = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `examples/${entry.name}`)
  .sort();

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
