import { renderCopybook } from "../packages/cobol-backend/src/index";
import { describe, expect, it } from "vitest";

import {
  inspectGeneratedCopybook,
  renderCopybookTypes,
} from "../packages/copybook/src/index";
import { compileExample } from "./helpers";

describe("copybook types", () => {
  it("renders a field type summary for generated copybooks", () => {
    const { ir } = compileExample();
    if (!ir.program) {
      throw new Error("Expected the example to compile.");
    }

    const inspection = inspectGeneratedCopybook(
      renderCopybook(ir.program.records[0]),
    );

    const report = renderCopybookTypes(inspection);

    expect(report).toContain("Copybook types");
    expect(report).toContain("DEBIT-ACCOUNT");
    expect(report).toContain("PIC X(16)");
    expect(report).toContain("PIC S9(16)V99 COMP-3");
  });
});
