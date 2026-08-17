import { existsSync, readdirSync } from "node:fs";

import { runBankc } from "../packages/bankc-cli/src/index";
import { exampleProjects } from "./example-projects";

/**
 * Formats every checked-in BankTS project, or verifies with `--check`.
 *
 * Used by `pnpm fmt` and `pnpm fmt:check`, and by the formatting step in CI.
 *
 * The conversions are here as well as the examples. They were not, so
 * `conversions/01-sequential-update` had never been through the formatter, and
 * more to the point neither had the two clauses only the conversions use.
 * `bankc fmt` silently dropped `redefines` and `depending on`, which is a
 * different record laid out differently, and no check could see it because no
 * checked-in source it ran over carried either clause.
 */
const checkOnly = process.argv.includes("--check");

const conversions = existsSync("conversions")
  ? readdirSync("conversions", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `conversions/${entry.name}/banklang`)
      .filter((path) => existsSync(`${path}/src/main.bank.ts`))
  : [];

const examples = [...exampleProjects(), ...conversions];

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
