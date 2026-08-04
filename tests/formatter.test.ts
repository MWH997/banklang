import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatBankTs } from "../packages/formatter/src/index";
import { parseBankTs } from "../packages/parser/src/index";

const EXAMPLES = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `examples/${entry.name}/src/main.bank.ts`);

function format(source: string): string {
  return formatBankTs(source).text;
}

describe("formatter", () => {
  it("leaves every checked-in example unchanged", () => {
    for (const path of EXAMPLES) {
      const source = readFileSync(path, "utf8");
      expect(format(source), `${path} is not canonically formatted`).toBe(
        source,
      );
    }
  });

  it("is idempotent", () => {
    for (const path of EXAMPLES) {
      const once = format(readFileSync(path, "utf8"));
      expect(format(once)).toBe(once);
    }
  });

  it("normalises spacing, indentation, and blank lines", () => {
    const messy = `module   Messy;
type    MoneyBDT=decimal<18,2>;
record Account{
accountId:string<16>;
      balance:MoneyBDT;
}



function check(balance:MoneyBDT):bool{
return balance>0.00;
}`;

    expect(format(messy)).toBe(`module Messy;

type MoneyBDT = decimal<18, 2>;

record Account {
  accountId: string<16>;
  balance: MoneyBDT;
}

function check(balance: MoneyBDT): bool {
  return balance > 0.00;
}
`);
  });

  it("preserves own-line comments", () => {
    const source = `module Commented;

// This alias is the ledger currency.
type MoneyBDT = decimal<18, 2>;

record Account {
  // The externally visible identifier.
  accountId: string<16>;
}
`;

    const formatted = format(source);
    expect(formatted).toContain("// This alias is the ledger currency.");
    expect(formatted).toContain("  // The externally visible identifier.");
    expect(formatted).toBe(source);
  });

  it("preserves trailing comments on the line they annotate", () => {
    const source = `module Trailing;

record Account {
  accountId: string<16>; // fixed width for the mainframe
}
`;

    expect(format(source)).toContain(
      "accountId: string<16>; // fixed width for the mainframe",
    );
  });

  it("never drops a comment", () => {
    const source = `module Keep;

// one
type A = decimal<18, 2>; // two

// three
record R {
  // four
  f: A; // five
}
`;

    const formatted = format(source);
    for (const text of ["one", "two", "three", "four", "five"]) {
      expect(formatted, `lost comment: ${text}`).toContain(`// ${text}`);
    }
  });

  it("formats transactions and file declarations", () => {
    const source = `module Postings;
type MoneyBDT=decimal<18,2>;
record Req{debitAccount:string<16>;creditAccount:string<16>;amount:MoneyBDT;idempotencyKey:string<36>;}
file feed sequential input record Req status feedStatus;
transaction post(request:Req){
debit(request.debitAccount,request.amount);
credit(request.creditAccount,request.amount);
audit("POSTED",request.idempotencyKey);
}`;

    expect(format(source)).toContain(
      "file feed sequential input record Req status feedStatus;",
    );
    expect(format(source)).toContain(
      "  debit(request.debitAccount, request.amount);",
    );
    expect(format(source)).toContain(
      '  audit("POSTED", request.idempotencyKey);',
    );
  });

  it("formats nested if/else", () => {
    const source = `module Branch;
type M=decimal<18,2>;
function f(a:M):bool{
if a>0.00{
return true;
}else{
return false;
}
}`;

    expect(format(source)).toBe(`module Branch;

type M = decimal<18, 2>;

function f(a: M): bool {
  if a > 0.00 {
    return true;
  } else {
    return false;
  }
}
`);
  });

  it("produces source that still parses to the same shape", () => {
    for (const path of EXAMPLES) {
      const source = readFileSync(path, "utf8");
      const before = parseBankTs(source, path);
      const after = parseBankTs(format(source), path);

      expect(after.diagnostics).toEqual([]);
      expect(
        JSON.stringify(after.program?.declarations.map((d) => d.kind)),
      ).toBe(JSON.stringify(before.program?.declarations.map((d) => d.kind)));
    }
  });

  it("refuses to rewrite source it cannot parse", () => {
    const broken = "module Broken;\n\nrecord {";
    const result = formatBankTs(broken);

    expect(result.text).toBe(broken);
    expect(result.unchanged).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports whether the input was already formatted", () => {
    expect(formatBankTs("module A;\n").unchanged).toBe(true);
    expect(formatBankTs("module    A;\n").unchanged).toBe(false);
  });
});
