import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import { emitCobol } from "../packages/cobol-backend/src/index";
import type { IRProgram } from "../packages/ir/src/index";
import { checkSourceMapCoverage } from "../packages/verifier/src/index";

import { compileExample, compileSource, flowed } from "./helpers";

const KEYED_RECORD = `module Postings;

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  idempotencyKey: string<36>;
}
`;

describe("transaction parsing", () => {
  it("parses a transaction with ledger and audit statements", () => {
    const { parsed, typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
    expect(typechecked.transactions).toHaveLength(1);
    expect(typechecked.transactions[0].name).toBe("postTransfer");
  });

  it("keeps debit, credit, and audit usable as field names", () => {
    const { parsed, typechecked } = compileSource(`module Naming;

record Flags {
  debit: string<1>;
  credit: string<1>;
  audit: string<1>;
}

transaction noop(flags: Flags, idempotencyKey: string<36>) {
  audit("NOOP", idempotencyKey);
}`);

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
  });
});

describe("transaction type rules", () => {
  it("rejects a ledger amount that is not decimal", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.creditAccount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-003",
    );
    expect(typechecked.diagnostics[0].message).toContain(
      "amount argument must be a decimal or currency value",
    );
  });

  it("rejects a ledger account that is not a string", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest) {
  debit(request.amount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`,
    );

    expect(typechecked.diagnostics[0].message).toContain(
      "account argument must be a string value",
    );
  });

  it("rejects field access on an unknown field", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.missingField);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-006",
    );
  });

  it("rejects field access on a non-record value", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest, idempotencyKey: string<36>) {
  debit(idempotencyKey.nested, request.amount);
  audit("TRANSFER_POSTED", idempotencyKey);
}`,
    );

    expect(typechecked.diagnostics[0].message).toContain(
      "Field access requires a record value",
    );
  });

  it("rejects ledger statements outside a transaction", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
function validateAmount(amount: MoneyBDT): bool {
  debit("ACC", amount);
}`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-007",
    );
  });

  it("rejects return statements inside a transaction", () => {
    const { typechecked } = compileSource(
      `${KEYED_RECORD}
transaction postTransfer(request: TransferRequest) {
  return true;
}`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-007",
    );
  });
});

describe("transaction COBOL emission", () => {
  it("emits the golden COBOL output for the account-posting example", () => {
    const { emit } = compileExample("examples/account-posting");
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/account-posting.cbl"),
      "utf8",
    );

    expect(emit.cobol).toBe(expected);
  });

  it("emits deterministic output across repeated emits", () => {
    const { ir } = compileExample("examples/account-posting");
    const first = emitCobol(ir.program as IRProgram);
    const second = emitCobol(ir.program as IRProgram);

    expect(first.cobol).toBe(second.cobol);
  });

  it("qualifies record field references with the group item", () => {
    const { emit } = compileExample("examples/account-posting");

    // Long enough to wrap at column 72, so the assertion is on the statement
    // rather than on where the page happens to break it.
    expect(flowed(emit.cobol)).toContain(
      flowed(
        "MOVE DEBIT-ACCOUNT OF POST-TRANSFER-REQUEST TO BANK-LEDGER-ACCOUNT",
      ),
    );
  });

  it("traces the transaction in the source map", () => {
    const { ir, emit } = compileExample("examples/account-posting");
    const transactionEntry = emit.sourceMap.entries.find(
      (entry) => entry.category === "transaction",
    );

    expect(transactionEntry).toMatchObject({ symbol: "postTransfer" });

    const coverage = checkSourceMapCoverage(
      ir.program as IRProgram,
      emit.sourceMap,
      emit.cobol,
    );
    expect(coverage.diagnostics).toEqual([]);
  });

  it("records the postings and audit events in the audit artifact", () => {
    const outDir = mkdtempSync(join(tmpdir(), "bankc-txn-audit-"));
    const result = runBankc(
      ["build", "examples/account-posting", "--out", outDir],
      process.cwd(),
    );

    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(
        readFileSync(
          join(outDir, "audit", "transaction-analysis.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      status: "analyzed",
      transactions: [
        {
          name: "postTransfer",
          parameters: ["request"],
          ledgerPostings: [
            {
              operation: "debit",
              account: "request.debitAccount",
              amount: "request.amount",
            },
            {
              operation: "credit",
              account: "request.creditAccount",
              amount: "request.amount",
            },
          ],
          auditEvents: [
            {
              event: "TRANSFER_POSTED",
              correlation: "request.idempotencyKey",
            },
          ],
        },
      ],
    });
  });

  it("reports BANK-GEN-007 when the transaction entry is missing", () => {
    const { ir, emit } = compileExample("examples/account-posting");
    const sourceMap = JSON.parse(
      JSON.stringify(emit.sourceMap),
    ) as typeof emit.sourceMap;
    sourceMap.entries = sourceMap.entries.filter(
      (entry) => entry.category !== "transaction",
    );

    const coverage = checkSourceMapCoverage(
      ir.program as IRProgram,
      sourceMap,
      emit.cobol,
    );

    expect(coverage.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-GEN-007",
    ]);
  });
});
