import { describe, expect, it } from "vitest";

import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { loadExampleSource, exampleSourceFile } from "./helpers";

describe("typechecker", () => {
  it("typechecks the account-transfer example", () => {
    const parsed = parseBankTs(loadExampleSource(), exampleSourceFile());
    const checked = typecheckProgram(parsed.program);

    expect(checked.diagnostics).toEqual([]);
    expect(checked.aliases.MoneyBDT).toEqual({
      kind: "decimal",
      precision: 18,
      scale: 2,
    });
    expect(checked.records[0]?.fields[2]?.type).toEqual({
      kind: "decimal",
      precision: 18,
      scale: 2,
    });
    expect(checked.functions[0]?.returnType).toEqual({ kind: "bool" });
  });

  it("reports unresolved types", () => {
    const source = [
      "module Broken;",
      "",
      "record Example {",
      "  amount: MissingType;",
      "}",
      "",
    ].join("\n");

    const parsed = parseBankTs(source, "broken.bank.ts");
    const checked = typecheckProgram(parsed.program);

    expect(
      checked.diagnostics.some(
        (diagnostic) => diagnostic.id === "BANK-TYPE-001",
      ),
    ).toBe(true);
  });

  it("reports invalid decimal parameters", () => {
    const source = [
      "module Broken;",
      "",
      "type BadAmount = decimal<18, 20>;",
      "",
    ].join("\n");

    const parsed = parseBankTs(source, "broken.bank.ts");
    const checked = typecheckProgram(parsed.program);

    expect(
      checked.diagnostics.some(
        (diagnostic) => diagnostic.id === "BANK-TYPE-002",
      ),
    ).toBe(true);
  });
});
