import { describe, expect, it } from "vitest";

import { compileExample } from "./helpers";

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
    expect(emit.sourceMap.entries[0]).toMatchObject({
      symbol: "AccountTransfer",
      targetStartLine: 4,
      targetEndLine: 5,
    });
    expect(emit.sourceMap.entries[1]).toMatchObject({
      symbol: "TransferRequest",
      targetStartLine: 10,
      targetEndLine: 13,
    });
    expect(emit.sourceMap.entries[5]).toMatchObject({
      symbol: "validateAmount",
      targetStartLine: 18,
      targetEndLine: 24,
    });
  });
});
