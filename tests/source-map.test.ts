import { describe, expect, it } from "vitest";

import { compileExample } from "./helpers";

/**
 * The source map is a claim about where each BankTS declaration ended up.
 *
 * It is checked against the emitted text rather than against line numbers
 * written down here: a line number is a property of the whole file, so the
 * moment anything above a declaration grows, a test that names one is asserting
 * the layout of everything before it as well. That test fails for reasons that
 * have nothing to do with the map being right, and is then corrected by
 * copying the new number in — which is not a check at all.
 */
describe("source map", () => {
  it("records module, record, field, and function entries", () => {
    const { emit } = compileExample();

    expect(emit.sourceMap.entries.map((entry) => entry.category)).toEqual([
      "module",
      "record",
      "field",
      "field",
      "field",
      "function",
    ]);
  });

  it("points each entry at the lines that declare it", () => {
    const { emit } = compileExample();
    const lines = emit.cobol.split("\n");
    const target = (index: number): string[] => {
      const entry = emit.sourceMap.entries[index];
      return lines.slice(entry.targetStartLine - 1, entry.targetEndLine);
    };

    expect(target(0).join("\n")).toContain("PROGRAM-ID. ACCOUNT-TRANSFER.");
    expect(target(1)[0]).toBe("       01  TRANSFER-REQUEST.");
    expect(target(2)[0]).toContain("DEBIT-ACCOUNT");
    expect(target(5)[0]).toBe("       VALIDATE-AMOUNT.");
    expect(target(5).at(-1)).toBe("           EXIT.");
  });

  /** Every entry has to name lines the artifact actually has. */
  it("stays inside the artifact", () => {
    const { emit } = compileExample();
    const lineCount = emit.cobol.split("\n").length;

    for (const entry of emit.sourceMap.entries) {
      expect(entry.targetStartLine).toBeGreaterThan(0);
      expect(entry.targetEndLine).toBeGreaterThanOrEqual(entry.targetStartLine);
      expect(entry.targetEndLine).toBeLessThanOrEqual(lineCount);
    }
  });
});
