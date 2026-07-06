import { describe, expect, it } from "vitest";

import {
  decimalPicture,
  packedDecimalByteLength,
} from "../packages/cobol-ir/src/index";

describe("numeric semantics", () => {
  it("maps decimal<18,2> to the expected PIC clause", () => {
    expect(decimalPicture(18, 2)).toBe("PIC S9(16)V99 COMP-3");
  });

  it("calculates packed decimal bytes for even and odd digit counts", () => {
    expect(packedDecimalByteLength(18)).toBe(10);
    expect(packedDecimalByteLength(15)).toBe(8);
    expect(packedDecimalByteLength(9)).toBe(5);
  });
});
