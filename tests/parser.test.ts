import { describe, expect, it } from "vitest";

import { parseBankTs } from "../packages/parser/src/index";
import { loadExampleSource, exampleSourceFile } from "./helpers";

describe("parser", () => {
  it("parses the account-transfer example", () => {
    const result = parseBankTs(loadExampleSource(), exampleSourceFile());

    expect(result.diagnostics).toEqual([]);
    expect(result.program?.module.name).toBe("AccountTransfer");
    expect(result.program?.declarations).toHaveLength(3);
    expect(result.program?.declarations[0]).toMatchObject({
      kind: "TypeAliasDeclaration",
      name: "MoneyBDT",
    });
    expect(result.program?.declarations[1]).toMatchObject({
      kind: "RecordDeclaration",
      name: "TransferRequest",
    });
    expect(result.program?.declarations[2]).toMatchObject({
      kind: "FunctionDeclaration",
      name: "validateAmount",
    });
  });

  it("reports syntax errors with spans", () => {
    const result = parseBankTs("module Broken\n", "broken.bank.ts");

    expect(result.program).toBeNull();
    expect(result.diagnostics).not.toHaveLength(0);
    expect(result.diagnostics[0]).toMatchObject({
      id: "BANK-SYN-001",
      severity: "error",
    });
    expect(result.diagnostics[0]!.span?.sourceFile).toBe("broken.bank.ts");
  });

  it("parses local variables and arithmetic expressions", () => {
    const source = [
      "module Demo;",
      "",
      "type Money = decimal<18, 2>;",
      "",
      "function compute(balance: Money): bool {",
      "  let projectedBalance: Money = balance + 0000000000000025.00;",
      "",
      "  if projectedBalance > 1000.00 {",
      "    return true;",
      "  } else {",
      "    return false;",
      "  }",
      "}",
      "",
    ].join("\n");

    const result = parseBankTs(source, "demo.bank.ts");

    expect(result.diagnostics).toEqual([]);
    expect(result.program?.declarations[1]).toMatchObject({
      kind: "FunctionDeclaration",
    });
    expect(result.program?.declarations[1]).toMatchObject({
      body: {
        statements: [
          {
            kind: "LetStatement",
            expression: {
              kind: "BinaryExpression",
              operator: "+",
            },
          },
          {
            kind: "IfStatement",
            condition: {
              kind: "BinaryExpression",
              operator: ">",
            },
          },
        ],
      },
    });
  });
});
