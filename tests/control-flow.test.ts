import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { emitCobol, emitJcl } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import {
  compileExample,
  exampleSourceFile,
  loadExampleSource,
} from "./helpers";

describe("control flow example", () => {
  it("parses, typechecks, and lowers the second example", () => {
    const sourceFile = exampleSourceFile("examples/batch-interest-accrual");
    const parsed = parseBankTs(
      loadExampleSource("examples/batch-interest-accrual"),
      sourceFile,
    );
    const checked = typecheckProgram(parsed.program);
    const ir = lowerProgramToIR(checked);

    expect(parsed.diagnostics).toEqual([]);
    expect(checked.diagnostics).toEqual([]);
    expect(ir.program?.functions[0]?.body.kind).toBe("Block");
    expect(ir.program?.functions[0]?.body.statements[0]).toMatchObject({
      kind: "LetStatement",
      declaredType: {
        kind: "decimal",
        precision: 18,
        scale: 2,
      },
    });
    expect(ir.program?.functions[0]?.body.statements[1]).toMatchObject({
      kind: "IfStatement",
    });
  });

  it("emits the golden COBOL output for the second example", () => {
    const { ir } = compileExample("examples/batch-interest-accrual");
    if (!ir.program) {
      throw new Error(
        "Expected the batch-interest-accrual example to compile.",
      );
    }

    const emit = emitCobol(ir.program);
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/batch-interest-accrual.cbl"),
      "utf8",
    );

    expect(emit.cobol).toBe(expected);
  });

  it("emits the golden JCL output for the second example", () => {
    const { ir } = compileExample("examples/batch-interest-accrual");
    if (!ir.program) {
      throw new Error(
        "Expected the batch-interest-accrual example to compile.",
      );
    }

    const emit = emitJcl(ir.program);
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/batch-interest-accrual.jcl"),
      "utf8",
    );

    expect(emit.jcl).toBe(expected);
  });
});
