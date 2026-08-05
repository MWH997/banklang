import { renderCopybook } from "../packages/cobol-backend/src/index";
import { describe, expect, it } from "vitest";

import {
  diffGeneratedCopybooks,
  renderCopybookDiff,
} from "../packages/copybook/src/index";
import { compileExample } from "./helpers";

describe("copybook diff", () => {
  it("detects identical generated copybooks", () => {
    const { ir } = compileExample();
    if (!ir.program) {
      throw new Error("Expected the example to compile.");
    }

    const copybook = renderCopybook(ir.program.records[0]);
    const diff = diffGeneratedCopybooks(copybook, copybook);

    expect(diff.identical).toBe(true);
    expect(renderCopybookDiff(diff)).toContain("Identical: yes");
  });

  it("detects changed field layouts", () => {
    const { ir } = compileExample();
    if (!ir.program) {
      throw new Error("Expected the example to compile.");
    }

    const left = renderCopybook(ir.program.records[0]);
    const right = left.replace("PIC X(16).", "PIC X(18).");
    const diff = diffGeneratedCopybooks(left, right);

    expect(diff.identical).toBe(false);
    expect(diff.totalLengthDiffers).toBe(true);
    expect(renderCopybookDiff(diff)).toContain("Layout differences");
  });
});
