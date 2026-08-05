import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `binary<n>` and `zoned<p, s>` alongside packed `decimal<p, s>`.
 *
 * A value's precision and scale say what it means; its usage says how the bytes
 * are arranged. Every number this compiler emitted used to be `COMP-3`, which
 * meant it could not represent — and therefore could not read — most fields in
 * an existing estate's copybooks: the halfword counters, the fullword
 * sequence numbers, and the zoned decimal that much legacy input arrives as.
 *
 * Usage is representation, not meaning, so it takes no part in type
 * compatibility. A count is a count whichever bytes hold it.
 */

const PREAMBLE = `module Usage;

type BDT = currency<"BDT", 18, 2>;

record LegacyMaster {
  accountId: string<16>;
  recordType: binary<4>;
  lineCount: binary<9>;
  sequenceNo: binary<18>;
  legacyBalance: zoned<11, 2>;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction settle(master: LegacyMaster) {
${body}
  audit("SETTLED", master.idempotencyKey);
}`);
}

describe("binary fields", () => {
  it("emits COMP for a binary field", () => {
    const cobol = txn("").cobol ?? "";

    expect(cobol).toContain("05  RECORD-TYPE          PIC S9(4) COMP.");
    expect(cobol).toContain("05  LINE-COUNT           PIC S9(9) COMP.");
    expect(cobol).toContain("05  SEQUENCE-NO          PIC S9(18) COMP.");
  });

  /**
   * IBM Enterprise COBOL holds a COMP item in a halfword, fullword, or
   * doubleword, chosen by the declared digit count. Getting these wrong is how
   * a copybook read against a real dataset lands every later field at the wrong
   * offset.
   */
  it("allocates a halfword, fullword, or doubleword by digit count", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "LegacyMaster",
    );
    const bytesOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.bytes;

    expect(bytesOf("LEGACY-MASTER.RECORD-TYPE")).toBe(2);
    expect(bytesOf("LEGACY-MASTER.LINE-COUNT")).toBe(4);
    expect(bytesOf("LEGACY-MASTER.SEQUENCE-NO")).toBe(8);
  });

  it("rejects more digits than a doubleword holds", () => {
    const result = compile(
      `${PREAMBLE.replace("binary<18>", "binary<20>")}
entry transaction settle(master: LegacyMaster) {
  audit("SETTLED", master.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-002");
  });
});

describe("zoned decimal fields", () => {
  /**
   * One byte per digit, with the sign kept separate so the field reads as plain
   * text — which is what a file another system or a person reads needs.
   */
  it("emits a display picture with a separate sign", () => {
    expect(txn("").cobol).toContain(
      "05  LEGACY-BALANCE       PIC S9(9)V99 SIGN IS TRAILING SEPARATE.",
    );
  });

  it("occupies one byte per digit plus the sign", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "LegacyMaster",
    );

    expect(
      layout?.entries.find(
        (entry) => entry.path === "LEGACY-MASTER.LEGACY-BALANCE",
      )?.bytes,
    ).toBe(12);
  });
});

describe("the layout report names the usage", () => {
  it("distinguishes COMP, COMP-3, and DISPLAY", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "LegacyMaster",
    );
    const usageOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.usage;

    expect(usageOf("LEGACY-MASTER.LINE-COUNT")).toBe("COMP");
    expect(usageOf("LEGACY-MASTER.LEGACY-BALANCE")).toBe("DISPLAY");
    expect(usageOf("LEGACY-MASTER.BALANCE")).toBe("COMP-3");
  });

  it("names the declared type rather than flattening it to decimal", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "LegacyMaster",
    );
    const typeOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.type;

    expect(typeOf("LEGACY-MASTER.LINE-COUNT")).toBe("binary<9>");
    expect(typeOf("LEGACY-MASTER.LEGACY-BALANCE")).toBe("zoned<11,2>");
  });
});

describe("usage is representation, not meaning", () => {
  it("computes with a binary field like any other number", () => {
    const result = txn("  master.lineCount = master.lineCount + 1;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "COMPUTE LINE-COUNT OF LEGACY-MASTER = (LINE-COUNT OF LEGACY-MASTER + 1)",
    );
  });

  it("computes with a zoned field like any other number", () => {
    const result = txn("  master.legacyBalance = master.legacyBalance + 1.00;");

    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Currency stays nominally typed regardless of how either side is stored: a
   * BDT amount is not an unqualified number that happens to have two decimals.
   */
  it("still refuses to assign a plain number to a currency", () => {
    const result = txn("  master.balance = master.legacyBalance;");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("still refuses to combine a currency with a plain number", () => {
    const result = txn(
      "  master.balance = master.balance + master.legacyBalance;",
    );

    expect(ids(result)).toContain("BANK-DEC-005");
  });
});
