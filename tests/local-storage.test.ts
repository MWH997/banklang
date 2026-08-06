import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * Where a `let` ends up in the generated program.
 *
 * COBOL has no block scope. Every local becomes an 01 item in WORKING-STORAGE,
 * which makes two questions the emitter has to answer and used to get wrong:
 * which locals get storage at all, and what happens when two routines pick the
 * same name. Both defects produced COBOL that no compiler would accept, so they
 * were caught at validation rather than in production — but they were caught by
 * GnuCOBOL, not by this project.
 */

const PREAMBLE = `module Locals;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function storageOf(cobol: string): string {
  return cobol.slice(
    cobol.indexOf("WORKING-STORAGE SECTION."),
    cobol.indexOf("PROCEDURE DIVISION"),
  );
}

function cobcAvailable(): boolean {
  return spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Compiles the emitted COBOL, which is what caught both defects originally. */
function expectCobcAccepts(cobol: string): void {
  if (!cobcAvailable()) {
    return;
  }
  const file = join(
    mkdtempSync(join(tmpdir(), "bankc-locals-")),
    "program.cbl",
  );
  writeFileSync(file, localCobol(cobol), "utf8");
  const result = spawnSync("cobc", ["-fsyntax-only", "-fixed", file], {
    encoding: "utf8",
  });
  expect(result.stderr, "cobc rejected the generated program").not.toContain(
    "error:",
  );
}

describe("local storage", () => {
  /**
   * Two routines each declaring `scratch` emitted two `01 SCRATCH` items — with
   * different PICTUREs when the two locals had different types. Every reference
   * was then ambiguous.
   */
  it("qualifies a local name more than one routine declares", () => {
    const result = compile(`${PREAMBLE}
function feeOn(amount: BDT): BDT {
  let scratch: BDT = amount;
  return scratch;
}

function levyOn(amount: BDT): BDT {
  let scratch: string<8> = "LEVY";
  return amount;
}

entry transaction settle(account: Account) {
  let fee: BDT = feeOn(account.balance);
  let levy: BDT = levyOn(account.balance);
  debit(account.accountId, fee);
  credit("CASH", fee);
  audit("SETTLED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const storage = storageOf(result.cobol ?? "");
    expect(storage).toContain("01  FEE-ON-SCRATCH       PIC S9(16)V99 COMP-3.");
    expect(storage).toContain("01  LEVY-ON-SCRATCH      PIC X(8).");
    expect(storage).not.toContain("01  SCRATCH ");

    // The body has to read the qualified field, not the bare one.
    expect(result.cobol).toContain("MOVE FEE-ON-P1 TO FEE-ON-SCRATCH");
    expectCobcAccepts(result.cobol ?? "");
  });

  /**
   * Qualifying only on collision follows the rule paragraph names already use,
   * and keeps the common case short: a data name is capped at 30 characters on
   * IBM Enterprise COBOL, and a transaction name is long.
   */
  it("leaves a local only one routine declares unqualified", () => {
    const result = compile(`${PREAMBLE}
function feeOn(amount: BDT): BDT {
  let scratch: BDT = amount;
  return scratch;
}

entry transaction settle(account: Account) {
  let fee: BDT = feeOn(account.balance);
  debit(account.accountId, fee);
  credit("CASH", fee);
  audit("SETTLED", account.idempotencyKey);
}`);

    const storage = storageOf(result.cobol ?? "");
    expect(storage).toContain("01  SCRATCH ");
    expect(storage).not.toContain("FEE-ON-SCRATCH");
  });

  /**
   * `collectFunctionLocals` visited the top level and the branches of an `if`,
   * so a local declared inside a loop had no storage at all and the generated
   * program referenced a name it never declared.
   */
  it("gives a local declared inside a loop its storage", () => {
    const result = compile(`${PREAMBLE}
entry transaction settle(account: Account) {
  let total: BDT = 0.00;
  let count: decimal<9, 0> = 0;

  while count < 3 limit 10 {
    let step: BDT = 1.00;
    total = total + step;
    count = count + 1;
  }

  debit(account.accountId, total);
  credit("CASH", total);
  audit("SETTLED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(storageOf(result.cobol ?? "")).toContain("01  STEP ");
    expectCobcAccepts(result.cobol ?? "");
  });

  it("gives a local declared inside a switch branch its storage", () => {
    const result = compile(`${PREAMBLE}
enum Tier {
  BASIC,
  PREMIUM,
}

entry transaction settle(account: Account, tier: Tier) {
  let charge: BDT = 0.00;

  switch tier {
    case BASIC {
      let basicFee: BDT = 1.00;
      charge = basicFee;
    }
    case PREMIUM {
      let premiumFee: BDT = 2.00;
      charge = premiumFee;
    }
  }

  debit(account.accountId, charge);
  credit("CASH", charge);
  audit("SETTLED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const storage = storageOf(result.cobol ?? "");
    expect(storage).toContain("01  BASIC-FEE ");
    expect(storage).toContain("01  PREMIUM-FEE ");
    expectCobcAccepts(result.cobol ?? "");
  });

  /** The failure handler is part of the transaction, so its locals are too. */
  it("gives a local declared in an on failure block its storage", () => {
    const result = compile(`${PREAMBLE}
entry transaction settle(account: Account, requested: BDT) {
  on failure {
    let reason: string<16> = "REJECTED";
    audit(reason, account.idempotencyKey);
  }

  if requested <= 0.00 {
    raise "NON_POSITIVE_AMOUNT";
  }

  debit(account.accountId, requested);
  credit("CASH", requested);
  audit("SETTLED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(storageOf(result.cobol ?? "")).toContain("01  REASON ");
    expectCobcAccepts(result.cobol ?? "");
  });
});
