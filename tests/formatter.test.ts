import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatBankTs } from "../packages/formatter/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { exampleProjects } from "../tools/example-projects";

/**
 * Every BankTS program in the repository, not only the examples.
 *
 * The formatter rewrites somebody's source, so "works on some programs" is not
 * a property worth having. The corpus was `examples/` alone, and the tools
 * mutation lane found 72 mutants in the formatter that no test reaches, the
 * comment emitter, `reserved` slots, generic parameters, and five statement
 * kinds among them. The conversions carry constructs the examples do not:
 * a Db2 cursor, `REDEFINES`, an `OCCURS DEPENDING ON`.
 */
const EXAMPLES = [
  ...exampleProjects().map((path) => `${path}/src/main.bank.ts`),
  ...readdirSync("conversions", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `conversions/${entry.name}/banklang/src/main.bank.ts`)
    .filter((path) => existsSync(path)),
];

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

  /**
   * The whole tree, not the shape of its top level.
   *
   * This test used to compare the list of declaration kinds, which is a
   * comparison every program passes: the formatter printed nothing at all for
   * seventeen of the thirty statement kinds, so running `pnpm fmt` deleted
   * every `log`, `commit`, `rollback`, `checkpoint`, `restart`, `getMessage`,
   * `initiate` and `on error` handler from a program, and the result still
   * parsed, still had the same declarations, and still passed here.
   *
   * Spans are excluded because formatting moves lines, which is its job.
   * Everything else has to survive the round trip exactly.
   */
  it("produces source that parses back to the same tree", () => {
    const withoutSpans = (value: unknown): string =>
      JSON.stringify(value, (key, node) =>
        key === "span" || key.endsWith("Span") ? undefined : node,
      );

    for (const path of EXAMPLES) {
      const source = readFileSync(path, "utf8");
      const before = parseBankTs(source, path);
      const after = parseBankTs(format(source), path);

      expect(after.diagnostics).toEqual([]);
      expect(withoutSpans(after.program), path).toBe(
        withoutSpans(before.program),
      );
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

/**
 * Constructs no checked-in program uses.
 *
 * The corpus is every BankTS project in the repository, and it still does not
 * contain a DL/I `database`, a `json`/`xml` payload statement, a `split`, or a
 * generic record. The mutation lane reported 68 mutants in this file that no
 * test reaches, most of them the `case` arms for those.
 *
 * The property is the one the corpus tests assert, applied to sources written
 * for the purpose: formatting must not change what the program means, and
 * formatting twice must equal formatting once. Round-tripping through the
 * parser is what catches a printer that emits something the parser cannot read
 * back, which is exactly what `database` did.
 */
describe("formatting a construct no example contains", () => {
  const withoutSpans = (value: unknown): string =>
    JSON.stringify(value, (key, node) =>
      key === "span" || key.endsWith("Span") ? undefined : node,
    );

  const roundTrips = (name: string, source: string) => {
    it(`keeps the program the same: ${name}`, () => {
      const before = parseBankTs(source, "m.bank.ts");
      expect(
        before.diagnostics.map((entry) => entry.id),
        "the fixture itself does not parse",
      ).toEqual([]);

      const formatted = format(source);
      const after = parseBankTs(formatted, "m.bank.ts");

      expect(
        after.diagnostics.map((entry) => entry.id),
        "the formatter emitted source the parser cannot read",
      ).toEqual([]);
      expect(withoutSpans(after.program)).toBe(withoutSpans(before.program));
      expect(format(formatted), "formatting is not idempotent").toBe(formatted);
    });
  };

  const ROW = `record Row {
  branch: string<8>;
  account: string<16>;
  reference: string<32>;
  idempotencyKey: string<36>;
}`;

  /**
   * `pcb` and a quoted key. The printer dropped the keyword and unquoted the
   * key, so `bankc fmt` turned a working program into one that failed with
   * "Expected `pcb` after the database name" on the next build.
   */
  roundTrips(
    "a DL/I database declaration",
    `module M;

record Seg {
  acctId: string<10>;
}

${ROW}

database accountDb pcb segment "ACCTSEG" key "ACCTID" record Seg status dbStatus;

entry transaction go(row: Row) {
  audit("X", row.idempotencyKey);
}
`,
  );

  roundTrips(
    "a JSON payload statement",
    `module M;

${ROW}

entry transaction go(row: Row, doc: string<200>) {
  json doc from row;
  audit("X", row.idempotencyKey);
}
`,
  );

  roundTrips(
    "a split into two targets",
    `module M;

${ROW}

entry transaction go(row: Row) {
  split row.reference by "-" into row.branch, row.account;
  audit("X", row.idempotencyKey);
}
`,
  );

  roundTrips(
    "a generic record",
    `module M;

record Box<T> {
  value: T;
}

${ROW}

entry transaction go(row: Row) {
  audit("X", row.idempotencyKey);
}
`,
  );
});
