import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

import { loadExampleSource } from "./helpers";

describe("compiler api", () => {
  it("compiles the account-transfer example to artifacts", () => {
    const result = compile(loadExampleSource());

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PROGRAM-ID. ACCOUNT-TRANSFER.");
    expect(result.copybooks).toEqual([
      expect.objectContaining({
        record: "TransferRequest",
        fileName: "TRANSFER-REQUEST.cpy",
      }),
    ]);
    expect(result.sourceMap?.entries.length).toBeGreaterThan(0);
    expect(result.coverage?.diagnostics).toEqual([]);
  });

  it("omits JCL unless requested", () => {
    expect(compile(loadExampleSource()).jcl).toBeNull();
    expect(compile(loadExampleSource(), { emitJcl: true }).jcl).toContain("//");
  });

  it("reports syntax diagnostics without emitting artifacts", () => {
    const result = compile("module Broken;\n\nrecord {");

    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].id).toMatch(/^BANK-SYN-/);
    expect(result.cobol).toBeNull();
    expect(result.copybooks).toEqual([]);
  });

  it("reports type diagnostics without emitting artifacts", () => {
    const result = compile(`module Broken;

function f(a: decimal<18, 2>): bool {
  return a;
}`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].id).toMatch(/^BANK-TYPE-/);
    expect(result.cobol).toBeNull();
  });

  it("reports banking safety diagnostics without emitting artifacts", () => {
    const result = compile(`module Broken;

type MoneyBDT = decimal<18, 2>;

record Posting {
  debitAccount: string<16>;
  amount: MoneyBDT;
}

transaction post(request: Posting) {
  debit(request.debitAccount, request.amount);
}`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-TXN-001",
      "BANK-AUD-001",
      "BANK-LED-001",
    ]);
    expect(result.cobol).toBeNull();
    // The summary still surfaces, so a caller can show what was analysed.
    expect(result.analysis?.transactionCount).toBe(1);
  });

  it("uses the supplied source file name in diagnostics", () => {
    const result = compile("module Broken;\n\nrecord {", {
      sourceFile: "playground.bank.ts",
    });

    expect(result.diagnostics[0].span?.sourceFile).toBe("playground.bank.ts");
  });

  it("is deterministic across repeated calls", () => {
    const first = compile(loadExampleSource());
    const second = compile(loadExampleSource());

    expect(first.cobol).toBe(second.cobol);
    expect(JSON.stringify(first.sourceMap)).toBe(
      JSON.stringify(second.sourceMap),
    );
  });
});
