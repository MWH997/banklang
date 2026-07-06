import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { emitCobol } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

export function exampleSourceFile(): string {
  return resolve(process.cwd(), "examples/account-transfer/src/main.bank.ts");
}

export function loadExampleSource(): string {
  return readFileSync(exampleSourceFile(), "utf8");
}

export function compileExample() {
  const sourceFile = exampleSourceFile();
  const sourceText = loadExampleSource();
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(typechecked);

  if (!ir.program) {
    throw new Error("Expected the account-transfer example to compile.");
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
