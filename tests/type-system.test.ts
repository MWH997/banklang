import { describe, expect, it } from "vitest";

import { isReservedCobolWord } from "../packages/cobol-ir/src/index";
import { compile } from "../packages/compiler/src/index";

const PREAMBLE = `module Types;

type BDT = currency<"BDT", 18, 2>;
type USD = currency<"USD", 18, 2>;
type Idx = decimal<4, 0>;

enum Status {
  ACTIVE,
  DORMANT,
  CLOSED,
}

record Line {
  amount: BDT;
  note: string<20>;
}

record Holder {
  accountId: string<16>;
  status: Status;
  balance: BDT;
  lines: Line[10];
  manager: nullable<string<20>>;
  idempotencyKey: string<36>;
}
`;

function txn(body: string) {
  return compile(
    `${PREAMBLE}\ntransaction t(holder: Holder) {\n${body}\n  audit("DONE", holder.idempotencyKey);\n}`,
  );
}

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("currency types", () => {
  it("allows arithmetic within one currency", () => {
    const result = compile(
      `${PREAMBLE}\nfunction f(a: BDT, b: BDT): BDT {\n  return a + b;\n}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("COMP-3");
  });

  it("reports BANK-DEC-005 when currencies differ", () => {
    const result = compile(
      `${PREAMBLE}\nfunction f(a: BDT, b: USD): BDT {\n  return a + b;\n}`,
    );

    expect(ids(result)).toContain("BANK-DEC-005");
    expect(result.diagnostics[0]!.message).toContain("BDT");
    expect(result.diagnostics[0]!.message).toContain("USD");
  });

  it("reports BANK-DEC-005 when comparing different currencies", () => {
    const result = compile(
      `${PREAMBLE}\nfunction f(a: BDT, b: USD): bool {\n  return a > b;\n}`,
    );

    expect(ids(result)).toContain("BANK-DEC-005");
  });

  it("reports BANK-DEC-005 when mixing currency with plain decimal", () => {
    const result = compile(
      `${PREAMBLE}\nfunction f(a: BDT, b: decimal<18, 2>): BDT {\n  return a + b;\n}`,
    );

    expect(ids(result)).toContain("BANK-DEC-005");
  });

  it("treats two currencies with identical precision as different types", () => {
    const result = compile(
      `${PREAMBLE}\nfunction f(a: USD): BDT {\n  return a;\n}`,
    );

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("enums", () => {
  it("emits level-88 condition names", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return h.status == Status.ACTIVE;
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("88  STATUS-FLD-ACTIVE");
    expect(result.cobol).toContain('VALUE "DORMANT"');
  });

  it("sizes the field to the widest member", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return h.status == Status.ACTIVE;
}`);

    // DORMANT is the longest member at seven characters.
    expect(result.cobol).toContain("PIC X(7)");
  });

  it("rejects an unknown enum member", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return h.status == Status.MISSING;
}`);

    expect(ids(result)).toContain("BANK-TYPE-006");
  });

  it("compiles switch to EVALUATE", () => {
    const result = txn(`  switch holder.status {
    case ACTIVE {
      holder.balance = holder.balance + 1.00;
    }
    case DORMANT {
      holder.balance = holder.balance + 2.00;
    }
    case CLOSED {
      holder.balance = holder.balance + 3.00;
    }
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("EVALUATE");
    expect(result.cobol).toContain('WHEN "ACTIVE"');
    expect(result.cobol).toContain("END-EVALUATE");
  });

  it("reports BANK-TYPE-010 when a switch misses a member", () => {
    const result = txn(`  switch holder.status {
    case ACTIVE {
      holder.balance = holder.balance + 1.00;
    }
  }`);

    expect(ids(result)).toContain("BANK-TYPE-010");
    expect(result.diagnostics[0]!.message).toContain("DORMANT");
  });

  it("accepts a partial switch with an else branch", () => {
    const result = txn(`  switch holder.status {
    case ACTIVE {
      holder.balance = holder.balance + 1.00;
    }
    else {
      holder.balance = holder.balance + 2.00;
    }
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("WHEN OTHER");
  });

  it("rejects a duplicate case", () => {
    const result = txn(`  switch holder.status {
    case ACTIVE {
      holder.balance = holder.balance + 1.00;
    }
    case ACTIVE {
      holder.balance = holder.balance + 2.00;
    }
    else {
      holder.balance = holder.balance + 3.00;
    }
  }`);

    expect(ids(result)).toContain("BANK-TYPE-005");
  });

  it("rejects switching over a non-enum", () => {
    const result = txn(`  switch holder.balance {
    case ACTIVE {
      holder.balance = holder.balance + 1.00;
    }
  }`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("bounded arrays", () => {
  it("emits OCCURS with nested level numbers", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): BDT {
  return h.lines[1].amount;
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("OCCURS 10 TIMES");
    expect(result.cobol).toContain("10  AMOUNT");
  });

  it("emits a qualified subscript reference", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder, i: Idx): BDT {
  return h.lines[i].amount;
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toMatch(/AMOUNT OF HOLDER \(/);
  });

  it("reports BANK-TYPE-009 for a literal index out of bounds", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): BDT {
  return h.lines[11].amount;
}`);

    expect(ids(result)).toContain("BANK-TYPE-009");
  });

  it("rejects indexing a non-array", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): BDT {
  return h.balance[1];
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects a fractional index", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): BDT {
  return h.lines[1.5].amount;
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects an unknown field on an array element", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): BDT {
  return h.lines[1].missing;
}`);

    expect(ids(result)).toContain("BANK-TYPE-006");
  });
});

describe("nullable values", () => {
  it("emits a null indicator beside the value", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return isPresent(h.manager);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toMatch(/MANAGER-IND\s+PIC S9\(4\) COMP\./);
  });

  it("reports BANK-TYPE-008 when read without a check", () => {
    const result = txn(`  let m: string<20> = valueOf(holder.manager);`);

    expect(ids(result)).toContain("BANK-TYPE-008");
  });

  it("allows the read inside an isPresent guard", () => {
    const result = txn(`  let m: string<20> = "NONE";
  if isPresent(holder.manager) {
    m = valueOf(holder.manager);
  }`);

    expect(result.diagnostics).toEqual([]);
  });

  it("allows the read when the guard is one side of an &&", () => {
    const result = txn(`  let m: string<20> = "NONE";
  if isPresent(holder.manager) && holder.balance > 0.00 {
    m = valueOf(holder.manager);
  }`);

    expect(result.diagnostics).toEqual([]);
  });

  it("does not carry the guard into the else branch", () => {
    const result = txn(`  let m: string<20> = "NONE";
  if isPresent(holder.manager) {
    m = "SET";
  } else {
    m = valueOf(holder.manager);
  }`);

    expect(ids(result)).toContain("BANK-TYPE-008");
  });

  it("rejects a presence check on a non-nullable value", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return isPresent(h.balance);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("indexed files", () => {
  const KSDS = `${PREAMBLE}
file master indexed input record Holder key accountId status masterStatus;
`;

  it("emits ORGANIZATION INDEXED with a qualified RECORD KEY", () => {
    const result = compile(`${KSDS}
transaction t(holder: Holder) {
  read master into holder key holder.accountId;
  audit("DONE", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("ORGANIZATION IS INDEXED");
    expect(result.cobol).toContain("ACCESS MODE IS DYNAMIC");
    expect(result.cobol).toContain("RECORD KEY IS ACCOUNT-ID OF MASTER-RECORD");
  });

  it("reports INVALID KEY rather than AT END", () => {
    const result = compile(`${KSDS}
transaction t(holder: Holder) {
  read master into holder key holder.accountId;
  audit("DONE", holder.idempotencyKey);
}`);

    expect(result.cobol).toContain('INVALID KEY MOVE "23"');
  });

  it("requires a key when reading an indexed file", () => {
    const result = compile(`${KSDS}
transaction t(holder: Holder) {
  read master into holder;
  audit("DONE", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-004");
  });

  it("requires a key clause on the declaration", () => {
    const result = compile(`${PREAMBLE}
file master indexed input record Holder status masterStatus;

transaction t(holder: Holder) {
  audit("DONE", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-004");
  });

  it("rejects a key field the record does not declare", () => {
    const result = compile(`${PREAMBLE}
file master indexed input record Holder key missingField status masterStatus;

transaction t(holder: Holder) {
  audit("DONE", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-004");
  });

  it("rejects a keyed read on a sequential file", () => {
    const result = compile(`${PREAMBLE}
file feed sequential input record Holder status feedStatus;

transaction t(holder: Holder) {
  read feed into holder key holder.accountId;
  audit("DONE", holder.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-004");
  });

  it("declares a record number for a relative file", () => {
    const result = compile(`${PREAMBLE}
file feed relative input record Holder status feedStatus;

transaction t(holder: Holder) {
  audit("DONE", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("ORGANIZATION IS RELATIVE");
    expect(result.cobol).toContain("RELATIVE KEY IS FEED-RRN");
    expect(result.cobol).toContain("FEED-RRN");
  });
});

describe("COBOL reserved words", () => {
  it("recognises reserved words case-insensitively", () => {
    expect(isReservedCobolWord("status")).toBe(true);
    expect(isReservedCobolWord("LINES")).toBe(true);
    expect(isReservedCobolWord("accountId")).toBe(false);
  });

  it("mangles a field whose name is reserved", () => {
    const result = compile(`${PREAMBLE}\nfunction f(h: Holder): bool {
  return h.status == Status.ACTIVE;
}`);

    // `status` and `lines` are COBOL reserved words.
    expect(result.cobol).toContain("STATUS-FLD");
    expect(result.cobol).toContain("LINES-FLD");
    expect(result.cobol).not.toMatch(/05 {2}STATUS {2}/);
  });
});
