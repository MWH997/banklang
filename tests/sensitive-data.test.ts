import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { formatBankTs } from "../packages/formatter/src/index";

/**
 * `sensitive` field marking, and where restricted data may not go.
 *
 * The marking is on the field rather than inferred from its name, because
 * whether a value is restricted is a decision about the data and not a guess
 * from spelling. What the compiler adds is that the decision then holds
 * everywhere the value goes, rather than everywhere someone remembered.
 */

const PREAMBLE = `module Sensitive;

type BDT = currency<"BDT", 18, 2>;

record Customer {
  customerId: string<16>;
  sensitive nationalId: string<20>;
  sensitive cardNumber: string<19>;
  balance: BDT;
  idempotencyKey: string<36>;
}

record Receipt {
  reference: string<19>;
  sensitive storedCard: string<19>;
  amount: BDT;
}

function maskPan(card: string<19>): string<19> {
  return "****";
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/** A transaction with the given body, over the preamble's records. */
function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction settle(customer: Customer, receipt: Receipt) {
${body}
}`);
}

describe("marking a field sensitive", () => {
  it("parses and round-trips through the formatter", () => {
    const source = `${PREAMBLE}
entry transaction settle(customer: Customer, receipt: Receipt) {
  audit("SETTLED", customer.idempotencyKey);
}`;

    expect(compile(source).diagnostics).toEqual([]);
    const formatted = formatBankTs(source, "sensitive.bank.ts").text;
    expect(formatted).toContain("sensitive nationalId: string<20>;");
    // The marking survives a second pass, so `bankc fmt --check` is stable.
    expect(formatBankTs(formatted, "sensitive.bank.ts").text).toBe(formatted);
  });

  /**
   * The marking has to be visible in the evidence, or an auditor has to read
   * BankTS source to find out which bytes of a record are restricted.
   */
  it("reports which layout fields are restricted", () => {
    const result = txn(`  audit("SETTLED", customer.idempotencyKey);`);
    const layout = result.layout?.reports.find(
      (report) => report.recordName === "Customer",
    );

    const restricted = layout?.entries
      .filter((entry) => entry.sensitive)
      .map((entry) => entry.path);
    expect(restricted).toEqual([
      "CUSTOMER.NATIONAL-ID",
      "CUSTOMER.CARD-NUMBER",
    ]);
  });

  it("leaves an unmarked field unrestricted", () => {
    const result = txn(`  audit("SETTLED", customer.idempotencyKey);`);
    const layout = result.layout?.reports.find(
      (report) => report.recordName === "Customer",
    );

    expect(
      layout?.entries.find((entry) => entry.path === "CUSTOMER.CUSTOMER-ID")
        ?.sensitive,
    ).toBe(false);
  });
});

describe("restricted data may not reach a log", () => {
  it("rejects a sensitive field as an audit correlation key", () => {
    const result = txn(`  audit("SETTLED", customer.nationalId);`);

    expect(ids(result)).toContain("BANK-AUD-002");
  });

  /**
   * The ledger journal is a log too: it outlives the transaction and is read by
   * operators reconciling postings.
   */
  it("rejects a sensitive field as a ledger account identifier", () => {
    const result = txn(`  debit(customer.nationalId, customer.balance);
  credit("CASH", customer.balance);
  audit("SETTLED", customer.idempotencyKey);`);

    expect(ids(result)).toContain("BANK-AUD-002");
  });

  it("follows restricted data through a local", () => {
    const result = txn(`  let carried: string<20> = customer.nationalId;
  audit("SETTLED", carried);`);

    expect(ids(result)).toContain("BANK-AUD-002");
  });

  it("follows it through a local assigned later", () => {
    const result = txn(`  let carried: string<20> = "PLAIN";
  carried = customer.nationalId;
  audit("SETTLED", carried);`);

    expect(ids(result)).toContain("BANK-AUD-002");
  });

  it("lets a local go back to being unrestricted", () => {
    const result = txn(`  let scratch: string<20> = customer.nationalId;
  scratch = "PLAIN";
  audit("SETTLED", scratch);`);

    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an unrestricted correlation key", () => {
    const result = txn(`  audit("SETTLED", customer.idempotencyKey);`);

    expect(result.diagnostics).toEqual([]);
  });
});

describe("restricted data may not be reclassified", () => {
  /**
   * A field's marking is part of its record declaration and therefore part of
   * its copybook. Copying restricted data into an unmarked field would
   * reclassify it silently and defeat the marking everywhere downstream.
   */
  it("rejects assigning a sensitive value to an unmarked field", () => {
    const result = txn(`  receipt.reference = customer.cardNumber;
  audit("SETTLED", customer.idempotencyKey);`);

    expect(ids(result)).toContain("BANK-SEC-001");
  });

  it("accepts assigning it to a field that is also marked", () => {
    const result = txn(`  receipt.storedCard = customer.cardNumber;
  audit("SETTLED", customer.idempotencyKey);`);

    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Passing a restricted value into a function is the declassification point.
   * The compiler does not check that `maskPan` masks anything. See the stated
   * limit in the language reference. It does make the boundary explicit
   * rather than letting a bare copy pass.
   */
  it("treats a function result as unrestricted", () => {
    const result = txn(`  receipt.reference = maskPan(customer.cardNumber);
  audit("SETTLED", customer.idempotencyKey);`);

    expect(result.diagnostics).toEqual([]);
  });
});

describe("restricted data may still be used", () => {
  /**
   * `cardExtract` rather than `customerOutput`, which folds to the DD name
   * `CUSTOMER`, the same eight characters as the `Customer` record's COBOL
   * group. `ASSIGN TO CUSTOMER` then takes the file name from that group's
   * contents on both compilers, and the OPEN fails with file status 35.
   * `BANK-FILE-016`.
   */
  it("allows writing it to a file, which is where it lives", () => {
    const result = compile(`${PREAMBLE}
file cardExtract sequential output record Customer status cardExtractStatus;

entry transaction settle(customer: Customer) {
  open cardExtract;
  write cardExtract from customer;
  close cardExtract;

  audit("SETTLED", customer.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("allows computing with it", () => {
    const result = txn(`  let masked: string<19> = maskPan(customer.cardNumber);
  audit("SETTLED", customer.idempotencyKey);`);

    expect(result.diagnostics).toEqual([]);
  });
});
