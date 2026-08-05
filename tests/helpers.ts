import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { emitCobol } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * A generated artifact with its line breaks flattened to single spaces.
 *
 * COBOL's reference format ends a source line at column 72, so a statement
 * wider than that is written across several lines. Where the break falls is a
 * property of the page rather than of the program, and a test asserting what
 * the emitter produced should not have to know it — `tests/reference-format`
 * checks the margin itself, over every artifact, once.
 *
 * Use this when the statement being asserted is long enough to wrap. Assert on
 * the text directly when the shape of the line is the point, as it is for the
 * column alignment of a data description entry.
 */
export function flowed(cobol: string | null | undefined): string {
  return (cobol ?? "").replace(/\s+/g, " ");
}

export function exampleSourceFile(
  examplePath = "examples/account-transfer",
): string {
  return resolve(process.cwd(), examplePath, "src/main.bank.ts");
}

export function loadExampleSource(
  examplePath = "examples/account-transfer",
): string {
  return readFileSync(exampleSourceFile(examplePath), "utf8");
}

/**
 * Compiles BankTS source text through parse, typecheck, and IR lowering without
 * touching the filesystem. Used by analysis tests that need many small
 * programs.
 */
export function compileSource(
  sourceText: string,
  sourceFile = "tests/inline.bank.ts",
) {
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(typechecked);
  return { parsed, typechecked, ir };
}

export function compileExample(examplePath = "examples/account-transfer") {
  const sourceFile = exampleSourceFile(examplePath);
  const sourceText = loadExampleSource(examplePath);
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(typechecked);

  if (!ir.program) {
    throw new Error(`Expected ${examplePath} to compile.`);
  }

  const emit = emitCobol(ir.program);
  return {
    sourceFile,
    sourceText,
    parsed,
    typechecked,
    ir,
    emit,
  };
}
