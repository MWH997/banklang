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
    });
    expect(ir.program?.functions[0]?.body[0]?.expression).toMatchObject({
      kind: "BinaryComparison",
      resolvedType: { kind: "bool" },
    });
    expect(ir.program?.functions[0]?.body[0]?.expression).toMatchObject({
      left: {
        kind: "Identifier",
        resolvedType: {
          kind: "decimal",
          precision: 18,
          scale: 2,
        },
      },
      right: {
        kind: "DecimalLiteral",
        resolvedType: {
          kind: "decimal",
          precision: 3,
          scale: 2,
        },
      },
    });
  });
});
