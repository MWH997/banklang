import { describe, expect, it } from "vitest";

import type { SourceMapDocument } from "../packages/cobol-backend/src/index";
import { checkSourceMapCoverage } from "../packages/verifier/src/index";

import { compileExample } from "./helpers";

function cloneSourceMap(sourceMap: SourceMapDocument): SourceMapDocument {
  return JSON.parse(JSON.stringify(sourceMap)) as SourceMapDocument;
}

describe("source map coverage", () => {
  it("reports full coverage for the account-transfer example", () => {
    const { ir, emit } = compileExample();

    const coverage = checkSourceMapCoverage(
      ir.program!,
      emit.sourceMap,
      emit.cobol,
    );

    expect(coverage.diagnostics).toEqual([]);
    expect(coverage.expectedSymbolCount).toBe(6);
    expect(coverage.coveredSymbolCount).toBe(6);
  });

  it("reports full coverage for the batch-interest-accrual example", () => {
    const { ir, emit } = compileExample("examples/batch-interest-accrual");

    const coverage = checkSourceMapCoverage(
      ir.program!,
      emit.sourceMap,
      emit.cobol,
    );

    expect(coverage.diagnostics).toEqual([]);
    expect(coverage.coveredSymbolCount).toBe(coverage.expectedSymbolCount);
  });

  it("reports BANK-GEN-004 when a function entry is missing", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    sourceMap.entries = sourceMap.entries.filter(
      (entry) => entry.category !== "function",
    );

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics).toHaveLength(1);
    expect(coverage.diagnostics[0]).toMatchObject({
      id: "BANK-GEN-004",
      severity: "error",
      message:
        "Generated COBOL source map is missing entry for function validateAmount.",
    });
    expect(coverage.coveredSymbolCount).toBe(5);
  });

  it("reports BANK-GEN-002 and BANK-GEN-003 when a record and field entry are missing", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    sourceMap.entries = sourceMap.entries.filter(
      (entry) =>
        entry.category !== "record" &&
        !(entry.category === "field" && entry.symbol === "amount"),
    );

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "BANK-GEN-002",
      "BANK-GEN-003",
    ]);
  });

  it("reports BANK-GEN-001 when the module entry is missing", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    sourceMap.entries = sourceMap.entries.filter(
      (entry) => entry.category !== "module",
    );

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "BANK-GEN-001",
    ]);
  });

  it("reports BANK-GEN-005 when an entry targets a line outside the artifact", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    const functionEntry = sourceMap.entries.find(
      (entry) => entry.category === "function",
    )!;
    functionEntry.targetStartLine = 9000;
    functionEntry.targetEndLine = 9001;

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics).toHaveLength(1);
    expect(coverage.diagnostics[0]).toMatchObject({ id: "BANK-GEN-005" });
    expect(coverage.diagnostics[0].message).toContain(
      "outside the generated artifact",
    );
  });

  it("reports BANK-GEN-006 when an entry points at the wrong line", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    const functionEntry = sourceMap.entries.find(
      (entry) => entry.category === "function",
    )!;
    functionEntry.targetStartLine = 1;
    functionEntry.targetEndLine = 2;

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics).toHaveLength(1);
    expect(coverage.diagnostics[0]).toMatchObject({ id: "BANK-GEN-006" });
    expect(coverage.diagnostics[0].message).toContain("VALIDATE-AMOUNT");
  });

  it("does not let a prefixed COBOL name satisfy an unrelated entry", () => {
    const { ir, emit } = compileExample();
    const sourceMap = cloneSourceMap(emit.sourceMap);
    const debitEntry = sourceMap.entries.find(
      (entry) => entry.symbol === "debitAccount",
    )!;
    const creditEntry = sourceMap.entries.find(
      (entry) => entry.symbol === "creditAccount",
    )!;
    debitEntry.targetStartLine = creditEntry.targetStartLine;
    debitEntry.targetEndLine = creditEntry.targetEndLine;

    const coverage = checkSourceMapCoverage(ir.program!, sourceMap, emit.cobol);

    expect(coverage.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
      "BANK-GEN-006",
    ]);
  });
});
