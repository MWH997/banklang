import { renderCopybook } from "../packages/cobol-backend/src/index";
import { describe, expect, it } from "vitest";

import { inspectGeneratedCopybook } from "../packages/copybook/src/index";
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

/**
 * The inspector reads what this compiler emits, and has to keep up with it.
 *
 * It once knew only `PIC X` and `COMP-3`. Every field the numeric-usage,
 * temporal, and edited work added made it throw on the compiler's own output —
 * `bankc` copybook inspect and diff were broken for any program using a
 * `binary`, a `zoned`, a date, or an edited field, and nothing noticed because
 * no example used one.
 */
describe("every picture the compiler emits", () => {
  it("measures each one", () => {
    const copybook = `01  LEGACY.
    05  ACCOUNT-ID           PIC X(16).
    05  FLAG                 PIC X.
    05  SHORT-COUNT          PIC S9(4) COMP.
    05  LINE-COUNT           PIC S9(9) COMP.
    05  BIG-COUNT            PIC S9(18) COMP.
    05  BALANCE              PIC S9(16)V99 COMP-3.
    05  LEGACY-BAL           PIC S9(9)V99 SIGN IS TRAILING SEPARATE.
    05  POSTED-ON            PIC 9(8).
    05  BOOKED-AT            PIC X(26).
    05  PRINTED              PIC Z,ZZZ,ZZ9.99-.
    05  PRINTED-CR           PIC Z,ZZ9.99CR.
    05  PRINTED-DATE         PIC 9999/99/99.
`;

    const lengths = Object.fromEntries(
      (inspectGeneratedCopybook(copybook).fields ?? []).map((field) => [
        field.cobolName,
        field.length,
      ]),
    );

    expect(lengths).toEqual({
      "ACCOUNT-ID": 16,
      FLAG: 1,
      // A binary field takes the halfword, fullword, or doubleword that fits.
      "SHORT-COUNT": 2,
      "LINE-COUNT": 4,
      "BIG-COUNT": 8,
      BALANCE: 10,
      // Zoned decimal is a byte per digit, plus one for the separate sign.
      "LEGACY-BAL": 12,
      "POSTED-ON": 8,
      "BOOKED-AT": 26,
      // An edited picture is one character per position, CR taking two.
      PRINTED: 13,
      "PRINTED-CR": 10,
      "PRINTED-DATE": 10,
    });
  });
});
