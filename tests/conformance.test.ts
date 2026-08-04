import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  buildRecord,
  decodePacked,
  encodePacked,
  hasCobc,
  layoutOf,
  readField,
  runConformance,
} from "../tools/conformance";

/**
 * Executes generated COBOL against the reference runtime in `runtime/`.
 *
 * Every other suite reads the generated program. This one runs it, which is the
 * only way to catch a defect that compiles: a rounding mode applied to the
 * wrong operand, a bounds guard that clamps instead of refusing, a rollback
 * that never reaches the ledger. The runtime is a reference implementation in
 * this repository, not IBM Db2 or CICS; see `runtime/README.md`.
 */

const SOURCE = readFileSync(
  "examples/withdrawal-with-recovery/src/main.bank.ts",
  "utf8",
);

const runner = hasCobc() ? describe : describe.skip;

function workDir(name: string): string {
  return join(tmpdir(), `banklang-conformance-${name}`);
}

interface Request {
  accountId: string;
  balance: number;
  minimumBalance: number;
  requested: number;
  idempotencyKey: string;
}

function run(name: string, request: Request) {
  const compiled = compile(SOURCE, { sourceFile: "main.bank.ts" });
  const requestLayout = layoutOf(compiled, "SavingsAccount");
  const resultLayout = layoutOf(compiled, "WithdrawalResult");

  const result = runConformance({
    source: SOURCE,
    sourceFile: "main.bank.ts",
    workDir: workDir(name),
    inputs: {
      REQUESTI: buildRecord(requestLayout, {
        "ACCOUNT-ID": request.accountId,
        BALANCE: request.balance,
        "IDEMPOTENCY-KEY": request.idempotencyKey,
        "MINIMUM-BALANCE": request.minimumBalance,
        REQUESTED: request.requested,
      }),
    },
    outputs: ["RESULTOU"],
  });

  return { result, resultLayout };
}

describe("packed decimal round trip", () => {
  // The harness seeds COMP-3 fields itself, so an error here would look like a
  // compiler defect. Pinning it separately keeps the two apart.
  it("encodes and decodes a positive amount", () => {
    expect(decodePacked(encodePacked(5000.5, 2, 10), 2)).toBe("5000.50");
  });

  it("encodes and decodes a negative amount", () => {
    expect(decodePacked(encodePacked(-12.34, 2, 10), 2)).toBe("-12.34");
  });

  it("keeps trailing zeros in the fraction", () => {
    expect(decodePacked(encodePacked(100, 2, 10), 2)).toBe("100.00");
  });
});

describe("record inheritance layout", () => {
  /**
   * The reason `extends` is worth having at all: a derived record starts with
   * the base record's exact bytes, so a copybook cut for the base still reads a
   * derived record correctly.
   */
  it("lays the base record's fields out first, byte for byte", () => {
    const compiled = compile(SOURCE, { sourceFile: "main.bank.ts" });
    const base = layoutOf(compiled, "CurrentAccount");
    const derived = layoutOf(compiled, "SavingsAccount");

    for (const field of base.entries) {
      const inherited = derived.entries.find(
        (entry) =>
          entry.path.slice(entry.path.indexOf(".")) ===
          field.path.slice(field.path.indexOf(".")),
      );
      expect(inherited).toBeDefined();
      expect(inherited?.offset).toBe(field.offset);
      expect(inherited?.bytes).toBe(field.bytes);
    }

    expect(derived.totalLength).toBeGreaterThan(base.totalLength);
  });
});

runner("executed against the reference runtime", () => {
  it("posts a permitted withdrawal and leaves the ledger balanced", () => {
    const { result, resultLayout } = run("permitted", {
      accountId: "ACC-0000000001",
      balance: 5000.0,
      minimumBalance: 500.0,
      requested: 1200.0,
      idempotencyKey: "IDEM-0001",
    });

    expect(result.exitCode).toBe(0);
    expect(result.journal).toEqual([
      "DEBIT ACC-0000000001 -1200.00",
      "CREDIT BRANCH-TILL 1200.00",
    ]);

    // The two postings are equal and opposite, so the ledger nets to zero.
    expect(result.balances.get("ACC-0000000001")).toBe("-1200.00");
    expect(result.balances.get("BRANCH-TILL")).toBe("1200.00");

    expect(result.auditLog).toEqual(["WITHDRAWAL_POSTED IDEM-0001"]);
  });

  it("writes the closing balance the arithmetic produced", () => {
    const { result, resultLayout } = run("closing-balance", {
      accountId: "ACC-0000000001",
      balance: 5000.0,
      minimumBalance: 500.0,
      requested: 1200.0,
      idempotencyKey: "IDEM-0001",
    });

    const record = result.outputs.get("RESULTOU") as Buffer;
    expect(readField(resultLayout, record, "ACCOUNT-ID")).toBe(
      "ACC-0000000001",
    );
    expect(readField(resultLayout, record, "PAID-OUT")).toBe("1200.00");
    expect(readField(resultLayout, record, "CLOSING-BALANCE")).toBe("3800.00");
  });

  /**
   * The behaviour the exception model exists for. `permittedAmount` raises
   * before any posting is made, so the failure path runs and nothing reaches
   * the ledger.
   */
  it("makes no posting when the guard raises before the debit", () => {
    const { result } = run("below-minimum", {
      accountId: "ACC-0000000002",
      balance: 800.0,
      minimumBalance: 500.0,
      requested: 700.0,
      idempotencyKey: "IDEM-0002",
    });

    expect(result.exitCode).toBe(0);
    expect(result.journal).toEqual(["ROLLBACK 0000"]);
    expect(result.balances.size).toBe(0);
    expect(result.auditLog).toEqual(["WITHDRAWAL_REJECTED IDEM-0002"]);
  });

  it("rejects a non-positive amount through the same path", () => {
    const { result } = run("non-positive", {
      accountId: "ACC-0000000003",
      balance: 900.0,
      minimumBalance: 0.0,
      requested: 0.0,
      idempotencyKey: "IDEM-0003",
    });

    expect(result.auditLog).toEqual(["WITHDRAWAL_REJECTED IDEM-0003"]);
    expect(result.journal).toEqual(["ROLLBACK 0000"]);
  });

  it("writes no result record when the transaction fails", () => {
    const { result } = run("no-output", {
      accountId: "ACC-0000000002",
      balance: 800.0,
      minimumBalance: 500.0,
      requested: 700.0,
      idempotencyKey: "IDEM-0002",
    });

    expect(result.outputs.get("RESULTOU")?.length ?? 0).toBe(0);
  });

  it("permits a withdrawal that lands exactly on the minimum balance", () => {
    const { result } = run("boundary", {
      accountId: "ACC-0000000004",
      balance: 1000.0,
      minimumBalance: 500.0,
      requested: 500.0,
      idempotencyKey: "IDEM-0004",
    });

    expect(result.auditLog).toEqual(["WITHDRAWAL_POSTED IDEM-0004"]);
    expect(result.balances.get("BRANCH-TILL")).toBe("500.00");
  });
});
