import { describe, expect, it } from "vitest";

import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { loadExampleSource, exampleSourceFile } from "./helpers";

describe("ir", () => {
  it("preserves decimal precision and scale", () => {
    const parsed = parseBankTs(loadExampleSource(), exampleSourceFile());
    const checked = typecheckProgram(parsed.program);
    const ir = lowerProgramToIR(checked);

    expect(ir.program).not.toBeNull();
    expect(ir.program?.records[0]?.fields[2]?.type).toEqual({
      kind: "decimal",
      precision: 18,
      scale: 2,
      usage: "packed",
    });
    expect(ir.program?.functions[0]?.body.statements[0]).toMatchObject({
      kind: "ReturnStatement",
      expression: {
        kind: "BinaryComparison",
        resolvedType: { kind: "bool" },
        left: {
          kind: "Identifier",
          resolvedType: {
            kind: "decimal",
            precision: 18,
            scale: 2,
            usage: "packed",
          },
        },
        right: {
          kind: "DecimalLiteral",
          resolvedType: {
            kind: "decimal",
            precision: 3,
            scale: 2,
            usage: "packed",
          },
        },
      },
    });
  });

  it("lowers local variables and decimal arithmetic", () => {
    const parsed = parseBankTs(
      loadExampleSource("examples/batch-interest-accrual"),
      exampleSourceFile("examples/batch-interest-accrual"),
    );
    const checked = typecheckProgram(parsed.program);
    const ir = lowerProgramToIR(checked);

    expect(ir.program).not.toBeNull();
    expect(ir.program?.functions[0]?.body.statements[0]).toMatchObject({
      kind: "LetStatement",
      declaredType: {
        kind: "decimal",
        precision: 18,
        scale: 2,
        usage: "packed",
      },
      initializer: {
        kind: "BinaryArithmetic",
        operator: "+",
        resolvedType: {
          kind: "decimal",
          precision: 18,
          scale: 2,
          usage: "packed",
        },
      },
    });
  });
});
