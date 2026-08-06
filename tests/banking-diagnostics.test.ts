import { describe, expect, it } from "vitest";

import type { IRProgram } from "../packages/ir/src/index";
import { analyzeProgramSemantics } from "../packages/semantic-analyzer/src/index";

import { compileSource } from "./helpers";

const PREAMBLE = `module Postings;

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  otherAmount: MoneyBDT;
  idempotencyKey: string<36>;
}

record UnkeyedRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
}
`;

function analyze(transactionSource: string) {
  const { parsed, typechecked, ir } = compileSource(
    `${PREAMBLE}\n${transactionSource}`,
  );
  expect(parsed.diagnostics).toEqual([]);
  expect(typechecked.diagnostics).toEqual([]);
  return analyzeProgramSemantics(ir.program as IRProgram);
}

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.id);
}

describe("banking diagnostics", () => {
  it("accepts a balanced, keyed, audited transaction", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      transactionCount: 1,
      auditEventCount: 1,
      ledgerPostingCount: 2,
    });
  });

  it("reports BANK-TXN-001 when no idempotency key is reachable", () => {
    const result = analyze(`transaction postTransfer(request: UnkeyedRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.debitAccount);
}`);

    expect(ids(result)).toEqual(["BANK-TXN-001"]);
    expect(result.diagnostics[0]!.message).toContain(
      "Transaction postTransfer has no idempotency key.",
    );
  });

  it("accepts an idempotency key passed as a direct parameter", () => {
    const result =
      analyze(`transaction postTransfer(request: UnkeyedRequest, idempotencyKey: string<36>) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("reports BANK-AUD-001 when a transaction emits no audit event", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
}`);

    expect(ids(result)).toEqual(["BANK-AUD-001"]);
  });

  it("reports BANK-AUD-003 when the audit event name is not a literal", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit(request.idempotencyKey, request.idempotencyKey);
}`);

    expect(ids(result)).toEqual(["BANK-AUD-003"]);
    expect(result.diagnostics[0]!.message).toContain(
      "compile-time string constant",
    );
  });

  it("reports BANK-LED-001 when debit and credit amounts differ", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.otherAmount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toEqual(["BANK-LED-001"]);
    expect(result.diagnostics[0]!.message).toContain(
      "debited request.amount against credited request.otherAmount",
    );
  });

  it("reports BANK-LED-001 when a debit has no matching credit", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toEqual(["BANK-LED-001"]);
    expect(result.diagnostics[0]!.message).toContain("credited nothing");
  });

  it("balances multiple postings regardless of statement order", () => {
    const result = analyze(`transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.otherAmount);
  debit(request.debitAccount, request.otherAmount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("reports every violated rule for one transaction", () => {
    const result = analyze(`transaction postTransfer(request: UnkeyedRequest) {
  debit(request.debitAccount, request.amount);
}`);

    expect(ids(result)).toEqual([
      "BANK-TXN-001",
      "BANK-AUD-001",
      "BANK-LED-001",
    ]);
  });

  it("leaves programs without transactions unchanged", () => {
    const { ir } = compileSource(`module NoTransactions;

type MoneyBDT = decimal<18, 2>;

function validateAmount(amount: MoneyBDT): bool {
  return amount > 0.00;
}`);

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      transactionCount: 0,
      functionCount: 1,
    });
  });
});
