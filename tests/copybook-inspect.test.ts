import { describe, expect, it } from "vitest";

import {
  inspectGeneratedCopybook,
  renderCopybook,
} from "../packages/copybook/src/index";
import { compileExample } from "./helpers";

describe("copybook inspection", () => {
  it("recovers layout from generated copybooks", () => {
    const { ir } = compileExample();
    if (!ir.program) {
      throw new Error("Expected the example to compile.");
    }

    const generated = renderCopybook(ir.program.records[0]);
    const inspection = inspectGeneratedCopybook(generated);

    expect(inspection.cobolName).toBe("TRANSFER-REQUEST");
    expect(inspection.totalLength).toBe(42);
    expect(inspection.fields).toHaveLength(3);
    expect(inspection.fields[0]).toMatchObject({
      cobolName: "DEBIT-ACCOUNT",
      offset: 0,
      length: 16,
    });
    expect(inspection.fields[2]).toMatchObject({
      cobolName: "AMOUNT",
      offset: 32,
      length: 10,
    });
  });
});
