import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

const PREAMBLE = `module Features;

type MoneyBDT = decimal<18, 2>;
type Rate = decimal<9, 4>;

record Account {
  accountId: string<16>;
  balance: MoneyBDT;
  idempotencyKey: string<36>;
}
`;

function compileBody(body: string) {
  return compile(`${PREAMBLE}\n${body}`);
}

function fn(body: string) {
  return compileBody(
    `function f(a: MoneyBDT, b: MoneyBDT): bool {\n${body}\n}`,
  );
}

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("comparison operators", () => {
  for (const [operator, cobol] of [
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
    ["==", "="],
    ["!=", "NOT ="],
  ] as const) {
    it(`compiles ${operator} to COBOL ${cobol}`, () => {
      const result = fn(`  return a ${operator} b;`);

      expect(result.diagnostics).toEqual([]);
      expect(result.cobol).toContain(`F-P1 ${cobol} F-P2`);
    });
  }

  it("rejects comparing a decimal to a string", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, s: string<16>): bool {\n  return a > s;\n}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("allows equality on strings", () => {
    const result = compileBody(
      `function f(a: string<16>, b: string<16>): bool {\n  return a == b;\n}`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("rejects comparing decimals of different scale", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, r: Rate): bool {\n  return a > r;\n}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
    expect(result.diagnostics[0].message).toContain("matching scale");
  });
});

describe("boolean operators", () => {
  it("compiles && and || to AND and OR", () => {
    const result = fn(`  return a > b && b > 0.00 || a == b;`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("AND");
    expect(result.cobol).toContain("OR");
  });

  it("compiles ! to NOT", () => {
    const result = fn(`  return !(a > b);`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("NOT (");
  });

  it("rejects && on decimal operands", () => {
    const result = fn(`  return a && b;`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("binds && tighter than ||", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): bool {
  return a > b || a > 0.00 && b > 0.00;
}`,
    );

    expect(result.diagnostics).toEqual([]);
    // The && group is parenthesised inside the OR, not the other way round.
    expect(result.cobol).toMatch(/OR \(\(.*AND.*\)\)|OR \(.*AND.*\)/);
  });
});

describe("arithmetic and rounding", () => {
  it("multiplies, adding the operand scales", () => {
    const result = compileBody(
      `function f(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}`,
    );

    expect(result.diagnostics).toEqual([]);
    // Not a phrase: `ROUNDED MODE IS` is COBOL 2002, and Enterprise COBOL has
    // no `MODE` sub-phrase at all. Banker's rounding is generated arithmetic.
    expect(result.cobol).not.toContain("ROUNDED MODE IS");
    expect(result.cobol).toContain("FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1");
    expect(result.cobol).toContain("*");
  });

  it("rejects bare division with BANK-DEC-003", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return a / b;
}`,
    );

    expect(ids(result)).toContain("BANK-DEC-003");
    expect(result.diagnostics[0].hint).toContain("divide(a, b,");
  });

  it("accepts divide() with an explicit mode", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return divide(a, b, "HALF_UP");
}`,
    );

    expect(result.diagnostics).toEqual([]);
    // HALF_UP is what IBM's ROUNDED means, so it is the phrase and nothing is
    // generated around it.
    expect(result.cobol).toContain("ROUNDED");
    expect(result.cobol).not.toContain("ROUNDED MODE IS");
    expect(result.cobol).not.toContain("REMAINDER");
  });

  it("truncates for DOWN, which is what leaving ROUNDED off does", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return divide(a, b, "DOWN");
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).not.toContain("ROUNDED");
    expect(result.cobol).not.toContain("REMAINDER");
  });

  for (const mode of [
    "HALF_EVEN",
    "HALF_DOWN",
    "UP",
    "CEILING",
    "FLOOR",
  ] as const) {
    it(`generates ${mode}, which Enterprise COBOL has no phrase for`, () => {
      const result = compileBody(
        `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return divide(a, b, "${mode}");
}`,
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.cobol).not.toContain("MODE IS");
      // A division is rounded from DIVIDE's own remainder rather than from a
      // quotient whose number of decimal places the compiler chose.
      expect(result.cobol).toContain(
        "GIVING BANK-RND-1-VALUE REMAINDER BANK-RND-1-REMAINDER",
      );
      expect(result.cobol).toContain("ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE");
    });
  }

  it("refuses a rounding that is not the whole value being stored", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return a + round(b, "HALF_EVEN");
}`,
    );

    expect(ids(result)).toContain("BANK-DEC-006");
  });

  it("rejects an unknown rounding mode", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): MoneyBDT {
  return divide(a, b, "SOMEHOW");
}`,
    );

    expect(ids(result)).toContain("BANK-DEC-003");
  });

  it("accepts a short literal for a wide decimal", () => {
    // Before literal widening this needed `0000000000000025.00`.
    const result = compileBody(
      `function f(a: MoneyBDT): MoneyBDT {
  return a + 25.00;
}`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects a literal whose scale differs", () => {
    const result = compileBody(
      `function f(a: MoneyBDT): MoneyBDT {
  return a + 25.0000;
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("function calls", () => {
  it("lowers a call to argument moves and a PERFORM", () => {
    const result = compileBody(
      `function twice(a: MoneyBDT): MoneyBDT {
  return a + a;
}

function f(a: MoneyBDT): MoneyBDT {
  return twice(a);
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE F-P1 TO TWICE-P1");
    expect(result.cobol).toContain("PERFORM TWICE");
  });

  /**
   * `DOUBLE` is a COBOL reserved word, so a function named `double` cannot
   * become a paragraph of that name.
   */
  it("renames a function whose name is reserved in COBOL", () => {
    const result = compileBody(
      `function double(a: MoneyBDT): MoneyBDT {
  return a + a;
}

function f(a: MoneyBDT): MoneyBDT {
  return double(a);
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PERFORM DOUBLE-FLD");
    expect(result.cobol).not.toMatch(/PERFORM DOUBLE$/m);
  });

  it("declares each parameter in working storage", () => {
    const result = compileBody(
      `function f(a: MoneyBDT, b: MoneyBDT): bool {
  return a > b;
}`,
    );

    expect(result.cobol).toContain("01  F-P1");
    expect(result.cobol).toContain("01  F-P2");
  });

  it("resolves a call to a function declared later", () => {
    const result = compileBody(
      `function f(a: MoneyBDT): bool {
  return later(a);
}

function later(a: MoneyBDT): bool {
  return a > 0.00;
}`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports an unknown callee", () => {
    const result = fn(`  return missing(a);`);

    expect(ids(result)).toContain("BANK-TYPE-001");
  });

  it("checks argument count", () => {
    const result = compileBody(
      `function g(a: MoneyBDT): bool {
  return a > 0.00;
}

function f(a: MoneyBDT): bool {
  return g(a, a);
}`,
    );

    expect(result.diagnostics[0].message).toContain("expects 1 argument");
  });

  it("checks argument types", () => {
    const result = compileBody(
      `function g(s: string<16>): bool {
  return s == "x";
}

function f(a: MoneyBDT): bool {
  return g(a);
}`,
    );

    expect(result.diagnostics[0].message).toContain("Argument 1 of g");
  });
});

describe("while loops", () => {
  const LOOP_PREAMBLE = `${PREAMBLE}
transaction t(account: Account) {
  let counter: MoneyBDT = 0.00;
`;

  it("requires a static limit", () => {
    const result = compile(
      `${LOOP_PREAMBLE}  while counter < 10.00 {
    counter = counter + 1.00;
  }
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TXN-004");
  });

  it("compiles a bounded loop to PERFORM UNTIL with a guard counter", () => {
    const result = compile(
      `${LOOP_PREAMBLE}  while counter < 10.00 limit 100 {
    counter = counter + 1.00;
  }
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PERFORM UNTIL");
    expect(result.cobol).toContain(">= 100 OR NOT");
    expect(result.cobol).toContain("END-PERFORM");
  });

  it("rejects a non-positive limit", () => {
    const result = compile(
      `${LOOP_PREAMBLE}  while counter < 10.00 limit 0 {
    counter = counter + 1.00;
  }
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TXN-004");
  });

  it("requires a bool condition", () => {
    const result = compile(
      `${LOOP_PREAMBLE}  while counter limit 10 {
    counter = counter + 1.00;
  }
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("assignment", () => {
  it("assigns to a record field", () => {
    const result = compile(
      `${PREAMBLE}
transaction t(account: Account) {
  account.balance = account.balance + 1.00;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("COMPUTE BALANCE OF ACCOUNT");
  });

  it("reports BANK-DEC-002 when assignment narrows scale", () => {
    const result = compile(
      `${PREAMBLE}
transaction t(account: Account, rate: Rate) {
  account.balance = rate;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-DEC-002");
  });

  it("accepts the narrowing when rounding is explicit", () => {
    const result = compile(
      `${PREAMBLE}
transaction t(account: Account, rate: Rate) {
  account.balance = round(rate, "HALF_EVEN");
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});

describe("file operations", () => {
  const FILES = `${PREAMBLE}
file feed sequential input record Account status feedStatus;

file sink sequential output record Account status sinkStatus;
`;

  it("compiles open, read, write, and close", () => {
    const result = compile(
      `${FILES}
transaction t(account: Account) {
  open feed;
  read feed into account;
  write sink from account;
  close feed;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("OPEN INPUT FEED-FILE");
    expect(result.cobol).toContain("READ FEED-FILE");
    expect(result.cobol).toContain("WRITE SINK-RECORD");
    expect(result.cobol).toContain("CLOSE FEED-FILE");
    // Fields are mapped one by one rather than moved as a group.
    expect(result.cobol).toContain(
      "MOVE ACCOUNT-ID OF FEED-RECORD TO ACCOUNT-ID OF ACCOUNT",
    );
    expect(result.cobol).toContain(
      "MOVE BALANCE OF ACCOUNT TO BALANCE OF SINK-RECORD",
    );
  });

  it("sets the file status at end of file", () => {
    const result = compile(
      `${FILES}
transaction t(account: Account) {
  read feed into account;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.cobol).toContain('AT END MOVE "10" TO FEED-STATUS');
  });

  it("rejects reading from an output file", () => {
    const result = compile(
      `${FILES}
transaction t(account: Account) {
  read sink into account;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-FILE-001");
  });

  it("rejects an undeclared file", () => {
    const result = compile(
      `${FILES}
transaction t(account: Account) {
  open missing;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-001");
  });

  it("reports BANK-FILE-002 on a record layout mismatch", () => {
    const result = compile(
      `${PREAMBLE}
record Other {
  code: string<4>;
}

file feed sequential input record Account status feedStatus;

transaction t(account: Account, other: Other) {
  read feed into other;
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-FILE-002");
  });

  it("exposes the file status field as a readable symbol", () => {
    const result = compile(
      `${FILES}
transaction t(account: Account) {
  while feedStatus == "00" limit 10 {
    read feed into account;
  }
  audit("DONE", account.idempotencyKey);
}`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
