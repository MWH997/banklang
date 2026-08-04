import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

const PREAMBLE = `module Generic;

type BDT = currency<"BDT", 18, 2>;
type USD = currency<"USD", 18, 2>;
type Count = decimal<9, 0>;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("record inheritance", () => {
  const BASE = `${PREAMBLE}
record Account {
  accountId: string<16>;
  balance: BDT;
}

record Savings extends Account {
  interestAccrued: BDT;
  idempotencyKey: string<36>;
}
`;

  /**
   * The property that makes `extends` worth having: a derived record's leading
   * storage is the base record's storage, byte for byte, so a copybook cut for
   * the base still reads a derived record.
   */
  it("lays the base fields out before the derived ones", () => {
    const result = compile(`${BASE}
transaction touch(savings: Savings) {
  audit("TOUCHED", savings.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const fields = result.program?.records.find(
      (record) => record.name === "Savings",
    )?.fields;
    expect(fields?.map((field) => field.name)).toEqual([
      "accountId",
      "balance",
      "interestAccrued",
      "idempotencyKey",
    ]);
  });

  it("emits the inherited fields into the derived COBOL group", () => {
    const result = compile(`${BASE}
transaction touch(savings: Savings) {
  audit("TOUCHED", savings.idempotencyKey);
}`);

    const group = (result.cobol ?? "").slice(
      (result.cobol ?? "").indexOf("01  SAVINGS."),
    );
    expect(group).toContain("05  ACCOUNT-ID           PIC X(16).");
    expect(group).toContain("05  INTEREST-ACCRUED     PIC S9(16)V99 COMP-3.");
  });

  it("resolves a base declared later in the file", () => {
    const result = compile(`${PREAMBLE}
record Savings extends Account {
  idempotencyKey: string<36>;
}

record Account {
  balance: BDT;
}

transaction touch(savings: Savings) {
  audit("TOUCHED", savings.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a field that the base already declares", () => {
    const result = compile(`${PREAMBLE}
record Account {
  balance: BDT;
}

record Savings extends Account {
  balance: BDT;
  idempotencyKey: string<36>;
}

transaction touch(savings: Savings) {
  audit("TOUCHED", savings.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-017");
  });

  it("rejects an inheritance cycle instead of recursing forever", () => {
    const result = compile(`${PREAMBLE}
record A extends B {
  left: BDT;
}

record B extends A {
  right: BDT;
}

transaction touch(a: A) {
  audit("TOUCHED", "KEY");
}`);

    expect(ids(result)).toContain("BANK-TYPE-016");
  });

  it("rejects extending something that is not a record", () => {
    const result = compile(`${PREAMBLE}
record Savings extends Missing {
  idempotencyKey: string<36>;
}

transaction touch(savings: Savings) {
  audit("TOUCHED", savings.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-001");
  });
});

describe("generic records", () => {
  const SLOT = `${PREAMBLE}
record Slot<T> {
  value: T;
  present: bool;
}
`;

  it("instantiates one concrete record per type argument", () => {
    const result = compile(`${SLOT}
record Holder {
  money: Slot<BDT>;
  count: Slot<Count>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = result.program?.records.map((record) => record.name) ?? [];
    expect(names).toContain("Slot$curBDT18_2");
    expect(names).toContain("Slot$dec9_0");
  });

  /**
   * `Slot<BDT>` and `Slot<currency<"BDT", 18, 2>>` name the same layout, so
   * they must not produce two records with duplicate storage.
   */
  it("normalises an alias to the same instantiation", () => {
    const result = compile(`${SLOT}
record Holder {
  viaAlias: Slot<BDT>;
  viaType: Slot<currency<"BDT", 18, 2>>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const slots = (result.program?.records ?? []).filter((record) =>
      record.name.startsWith("Slot$"),
    );
    expect(slots).toHaveLength(1);
  });

  /**
   * Monomorphisation must not launder a currency. `Slot<BDT>` and `Slot<USD>`
   * are separate records holding separate types, so the same rules that reject
   * mixing two currencies directly still apply through the generic.
   */
  it("keeps two currencies apart across instantiations", () => {
    const result = compile(`${SLOT}
transaction mix(local: Slot<BDT>, foreign: Slot<USD>, idempotencyKey: string<36>) {
  local.value = foreign.value;
  audit("MIXED", idempotencyKey);
}`);

    // The same id a direct BDT-to-USD assignment reports.
    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("reports a currency mismatch when instantiations are compared", () => {
    const result = compile(`${SLOT}
transaction mix(local: Slot<BDT>, foreign: Slot<USD>, idempotencyKey: string<36>) {
  if local.value > foreign.value {
    audit("GREATER", idempotencyKey);
  }
  audit("MIXED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-DEC-005");
  });

  it("rejects a generic used without type arguments", () => {
    const result = compile(`${SLOT}
record Holder {
  money: Slot;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-018");
  });

  it("rejects type arguments on a type that declares none", () => {
    const result = compile(`${PREAMBLE}
record Plain {
  balance: BDT;
}

record Holder {
  wrong: Plain<BDT>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-019");
  });
});

describe("generic functions", () => {
  it("infers the instantiation from the argument types", () => {
    const result = compile(`${PREAMBLE}
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}

transaction pick(a: BDT, b: BDT, idempotencyKey: string<36>) {
  let best: BDT = larger(a, b);
  debit("SOURCE", best);
  credit("TARGET", best);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("LARGER-CUR-BDT18-2");
  });

  it("emits one paragraph per distinct instantiation", () => {
    const result = compile(`${PREAMBLE}
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}

transaction pick(a: BDT, b: BDT, m: Count, n: Count, idempotencyKey: string<36>) {
  let money: BDT = larger(a, b);
  let count: Count = larger(m, n);
  debit("SOURCE", money);
  credit("TARGET", money);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = result.program?.functions.map((fn) => fn.name) ?? [];
    expect(names).toContain("larger$curBDT18_2");
    expect(names).toContain("larger$dec9_0");
  });

  it("rejects arguments that disagree about one type parameter", () => {
    const result = compile(`${PREAMBLE}
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}

transaction pick(a: BDT, n: Count, idempotencyKey: string<36>) {
  let best: BDT = larger(a, n);
  audit("PICKED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-020");
  });

  /**
   * A decimal literal carries the scale it was written with, not the type it is
   * meant to have, so it must not fix a type parameter another argument
   * already determined.
   */
  it("lets a literal follow a type parameter fixed by another argument", () => {
    const result = compile(`${PREAMBLE}
function orElse<T>(value: T, fallback: T): T {
  if value > fallback {
    return value;
  } else {
    return fallback;
  }
}

transaction pick(a: BDT, idempotencyKey: string<36>) {
  let best: BDT = orElse(a, 0.00);
  debit("SOURCE", best);
  credit("TARGET", best);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("warns about a generic that is never called", () => {
    const result = compile(`${PREAMBLE}
function unused<T>(value: T): T {
  return value;
}

transaction touch(idempotencyKey: string<36>) {
  audit("TOUCHED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-015");
  });
});

/**
 * Monomorphisation duplicates a paragraph per instantiation whether or not the
 * copies differ. Two currencies of the same precision and scale emit the same
 * PICTURE, so their instantiations are the same COBOL twice.
 */
describe("shared instantiations", () => {
  const LARGER = `${PREAMBLE}
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}
`;

  it("emits one paragraph for instantiations that lower identically", () => {
    const result = compile(`${LARGER}
transaction pick(a: BDT, b: BDT, c: USD, d: USD, idempotencyKey: string<36>) {
  let bdt: BDT = larger(a, b);
  let usd: USD = larger(c, d);
  debit("SOURCE", bdt);
  credit("TARGET", bdt);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = result.program?.functions.map((fn) => fn.name) ?? [];
    expect(names).toEqual(["larger$curBDT18_2"]);
    // Both call sites reach the surviving paragraph.
    expect(result.cobol).not.toContain("LARGER-CUR-USD18-2");
    expect(
      (result.cobol ?? "").match(/PERFORM LARGER-CUR-BDT18-2/g),
    ).toHaveLength(2);
  });

  /**
   * Sharing a paragraph is a decision about emitted COBOL, not about the type
   * system. A BDT amount is still not a USD amount.
   */
  it("keeps currencies nominally distinct", () => {
    const result = compile(`${LARGER}
transaction pick(a: BDT, c: USD, idempotencyKey: string<36>) {
  let bdt: BDT = larger(a, c);
  audit("PICKED", idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-020");
  });

  it("keeps instantiations that lower differently apart", () => {
    const result = compile(`${LARGER}
transaction pick(a: BDT, b: BDT, m: Count, n: Count, idempotencyKey: string<36>) {
  let money: BDT = larger(a, b);
  let count: Count = larger(m, n);
  debit("SOURCE", money);
  credit("TARGET", money);
  audit("PICKED", idempotencyKey);
}`);

    const names = result.program?.functions.map((fn) => fn.name) ?? [];
    expect(names).toContain("larger$curBDT18_2");
    expect(names).toContain("larger$dec9_0");
  });

  /**
   * Merging one pair can make another pair identical: two instantiations of a
   * caller differ only in the callee they name until those callees merge.
   */
  it("merges a caller once the callee it names has merged", () => {
    const result = compile(`${PREAMBLE}
function twice<T>(value: T): T {
  return value + value;
}

function quadruple<T>(value: T): T {
  return twice(twice(value));
}

transaction pick(a: BDT, c: USD, idempotencyKey: string<36>) {
  let bdt: BDT = quadruple(a);
  let usd: USD = quadruple(c);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = (result.program?.functions ?? []).map((fn) => fn.name).sort();
    expect(names).toEqual(["quadruple$curBDT18_2", "twice$curBDT18_2"]);
  });

  /**
   * A function the author wrote keeps its own paragraph even when another one
   * happens to match it exactly: that name is in the source, the source map and
   * the audit record.
   */
  it("never merges a function the author named", () => {
    const result = compile(`${PREAMBLE}
function feeOn(amount: BDT): BDT {
  return amount;
}

function levyOn(amount: BDT): BDT {
  return amount;
}

transaction charge(a: BDT, idempotencyKey: string<36>) {
  let fee: BDT = feeOn(a);
  let levy: BDT = levyOn(a);
  audit("CHARGED", idempotencyKey);
}`);

    const names = result.program?.functions.map((fn) => fn.name) ?? [];
    expect(names).toEqual(["feeOn", "levyOn"]);
  });
});

describe("record arguments", () => {
  /**
   * A record parameter is a LINKAGE cell the caller points at the argument, so
   * a nested record can be passed: the compiler takes its address.
   */
  it("accepts a record-typed field as an argument", () => {
    const result = compile(`${PREAMBLE}
record Inner {
  amount: BDT;
}

record Outer {
  inner: Inner;
  idempotencyKey: string<36>;
}

function total(inner: Inner): BDT {
  return inner.amount;
}

transaction sum(outer: Outer) {
  let value: BDT = total(outer.inner);
  audit("SUMMED", outer.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "SET ADDRESS OF TOTAL-P1 TO ADDRESS OF INNER OF OUTER",
    );
  });

  /**
   * A subscripted element is not addressable at the call site: the cell would
   * have to describe storage chosen by a subscript.
   */
  it("rejects a subscripted record element as an argument", () => {
    const result = compile(`${PREAMBLE}
record Inner {
  amount: BDT;
}

record Outer {
  entries: Inner[10];
  idempotencyKey: string<36>;
}

function total(inner: Inner): BDT {
  return inner.amount;
}

transaction sum(outer: Outer, at: Count) {
  let value: BDT = total(outer.entries[at]);
  audit("SUMMED", outer.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-021");
  });

  it("accepts a record passed by name", () => {
    const result = compile(`${PREAMBLE}
record Inner {
  amount: BDT;
  idempotencyKey: string<36>;
}

function total(inner: Inner): BDT {
  return inner.amount;
}

transaction sum(inner: Inner) {
  let value: BDT = total(inner);
  debit("SOURCE", value);
  credit("TARGET", value);
  audit("SUMMED", inner.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    // The cell is pointed at the record rather than copied into.
    expect(result.cobol).toContain(
      "SET ADDRESS OF TOTAL-P1 TO ADDRESS OF INNER",
    );
    expect(result.cobol).not.toContain("MOVE INNER TO TOTAL-P1");
  });

  /**
   * The payoff of laying base fields out first: a paragraph written against the
   * base runs over a derived record because the declared fields sit at the same
   * offsets. Verified end to end in tests/conformance.test.ts.
   */
  it("accepts a derived record where the base is expected", () => {
    const result = compile(`${PREAMBLE}
record Account {
  accountId: string<16>;
  balance: BDT;
}

record Savings extends Account {
  minimumBalance: BDT;
  idempotencyKey: string<36>;
}

function availableOf(account: Account): BDT {
  return account.balance;
}

transaction check(savings: Savings) {
  let value: BDT = availableOf(savings);
  debit("SOURCE", value);
  credit("TARGET", value);
  audit("CHECKED", savings.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "SET ADDRESS OF AVAILABLE-OF-P1 TO ADDRESS OF SAVINGS",
    );
    // The body reads the cell, not the declared type's own group.
    expect(result.cobol).toContain("BALANCE OF AVAILABLE-OF-P1");
  });

  it("still rejects an unrelated record", () => {
    const result = compile(`${PREAMBLE}
record Account {
  balance: BDT;
}

record Unrelated {
  balance: BDT;
  idempotencyKey: string<36>;
}

function availableOf(account: Account): BDT {
  return account.balance;
}

transaction check(other: Unrelated) {
  let value: BDT = availableOf(other);
  audit("CHECKED", other.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});
