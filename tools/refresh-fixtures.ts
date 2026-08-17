/**
 * Rewrite the golden fixtures from the compiler as it stands.
 *
 * A golden file is a claim that the compiler still emits exactly this. It is
 * only worth anything if a test compares it, and only honest if regenerating it
 * is a reviewable diff rather than a manual edit. `tests/fixtures/
 * batch-interest-accrual.cbl` held `IS-ELIGIBLE-FOR-INTEREST-RESULT`, a
 * 31-character COBOL word, and `tests/fixtures/interest-posting-batch.cbl` held
 * `ROUNDED MODE IS NEAREST-EVEN`, a phrase Enterprise COBOL does not have.
 * Every run of the suite compared each against itself and agreed.
 *
 *   pnpm fixtures:refresh
 *
 * `tests/golden-fixtures.test.ts` is what compares them, and
 * `pnpm lint:conformance` reads them alongside fresh output, so a defect frozen
 * here is reported rather than ratified.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  emitCobol,
  emitJcl,
  renderCopybook,
} from "../packages/cobol-backend/src/index";
import { lowerProgramToIR, type IRProgram } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * Every golden fixture, and what produces it.
 *
 * One entry per file, so a fixture that nothing generates and nothing compares
 * cannot survive here unnoticed.
 */
export const FIXTURES: {
  file: string;
  example: string;
  render: (program: IRProgram) => string;
}[] = [
  {
    file: "tests/fixtures/account-transfer.cbl",
    example: "examples/account-transfer",
    render: (program) => emitCobol(program).cobol,
  },
  {
    file: "tests/fixtures/transfer-request.cpy",
    example: "examples/account-transfer",
    render: (program) => renderCopybook(program.records[0]!),
  },
  {
    file: "tests/fixtures/account-posting.cbl",
    example: "examples/account-posting",
    render: (program) => emitCobol(program).cobol,
  },
  {
    file: "tests/fixtures/account-file-batch.cbl",
    example: "examples/account-file-batch",
    render: (program) => emitCobol(program).cobol,
  },
  {
    file: "tests/fixtures/batch-interest-accrual.cbl",
    example: "examples/batch-interest-accrual",
    render: (program) => emitCobol(program).cobol,
  },
  {
    file: "tests/fixtures/batch-interest-accrual.jcl",
    example: "examples/batch-interest-accrual",
    render: (program) => emitJcl(program).jcl,
  },
  {
    // The rounding example, and the one whose fixture froze `ROUNDED MODE IS`.
    file: "tests/fixtures/interest-posting-batch.cbl",
    example: "examples/interest-posting-batch",
    render: (program) => emitCobol(program).cobol,
  },
];

export function exampleProgram(
  example: string,
  cwd = process.cwd(),
): IRProgram {
  const sourceFile = resolve(cwd, example, "src/main.bank.ts");
  const parsed = parseBankTs(readFileSync(sourceFile, "utf8"), sourceFile);
  if (!parsed.program) {
    throw new Error(`${example} did not parse.`);
  }
  const ir = lowerProgramToIR(typecheckProgram(parsed.program));
  if (!ir.program) {
    throw new Error(`${example} did not lower.`);
  }
  return ir.program;
}

export function refreshFixtures(cwd = process.cwd()): string[] {
  const programs = new Map<string, IRProgram>();
  for (const fixture of FIXTURES) {
    if (!programs.has(fixture.example)) {
      programs.set(fixture.example, exampleProgram(fixture.example, cwd));
    }
    writeFileSync(
      resolve(cwd, fixture.file),
      fixture.render(programs.get(fixture.example) as IRProgram),
      "utf8",
    );
  }
  return FIXTURES.map((fixture) => fixture.file);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const written = refreshFixtures(process.cwd());
  process.stdout.write(`${written.join("\n")}\n`);
}
