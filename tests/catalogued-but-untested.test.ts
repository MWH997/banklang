import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import {
  DIAGNOSTICS,
  renderDiagnosticDoc,
} from "../packages/diagnostics/src/index";

/**
 * The diagnostics the catalogue claimed and nothing provoked.
 *
 * `tests/feature-coverage.test.ts` asks whether every diagnostic documented as
 * implemented is named by some test. Five were not: `BANK-TYPE-000`,
 * `BANK-TYPE-014`, `BANK-DEC-004`, `BANK-LED-004` and `BANK-FILE-012`. A rule
 * with no test that fails when you break it is a comment, and a catalogue entry
 * with no test is a promise nobody checked, which is worse, because it is
 * printed by `bankc explain` as though it were a guarantee.
 *
 * Written together here because they were found together, and because what they
 * have in common is being hard to reach by accident.
 */

const PREAMBLE = `module Catalogue;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(source: string): string[] {
  return compile(source).diagnostics.map((entry) => entry.id);
}

describe("BANK-TYPE-000", () => {
  /**
   * The typechecker asked to check nothing.
   *
   * Unreachable through `compile`, which stops at the parse errors, so it is
   * provoked at the boundary it defends. It exists because a null program
   * reaching the typechecker used to be a crash rather than a diagnostic, and a
   * compiler that throws on bad input is one whose error handling is the stack
   * trace.
   */
  it("is what the typechecker says when there is no program", () => {
    const result = typecheckProgram(null);

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-000",
    );
    expect(result.program).toBeNull();
  });
});

describe("BANK-TYPE-014", () => {
  /**
   * More instantiations of one generic than the compiler will expand.
   *
   * Generics are monomorphised, so each distinct type argument is another copy
   * of the code. The cap exists because a generic that calls itself at a new
   * type argument expands until memory runs out, and it fires here for the
   * other reason, which is why the message reports the cap rather than
   * claiming a non-termination it cannot prove. Provoking it takes 201 types,
   * because a language whose type arguments are inferred rather than written
   * gives no shorter way to reach it.
   */
  const widths = Array.from({ length: 201 }, (_, index) => index + 1);

  it("refuses more instantiations than it will expand", () => {
    expect(
      ids(`${PREAMBLE}
function firstOf<T>(left: T, right: T): T {
  return left;
}

record Widths {
${widths.map((width) => `  w${width}: string<${width}>;`).join("\n")}
}

entry transaction go(account: Account, widths: Widths) {
${widths.map((width) => `  widths.w${width} = firstOf(widths.w${width}, widths.w${width});`).join("\n")}
  audit("X", account.idempotencyKey);
}`),
    ).toContain("BANK-TYPE-014");
  });

  it("expands a handful without complaint", () => {
    expect(
      ids(`${PREAMBLE}
function firstOf<T>(left: T, right: T): T {
  return left;
}

entry transaction go(account: Account, count: decimal<9, 0>) {
  account.balance = firstOf(account.balance, account.balance);
  count = firstOf(count, count);
  audit("X", account.idempotencyKey);
}`),
    ).not.toContain("BANK-TYPE-014");
  });
});

describe("BANK-DEC-004", () => {
  /**
   * A product that needs more digits than the receiver declares.
   *
   * Multiplication adds the operand scales and the integer digits, and COBOL
   * truncates the high-order end of an overflow silently under
   * `NUMPROC(NOPFD)`, so the answer is worse than wrong: it is a plausible
   * smaller number.
   */
  it("refuses a product that cannot fit its receiver", () => {
    expect(
      ids(`${PREAMBLE}
function tooWide(a: decimal<4, 4>, b: decimal<4, 4>): decimal<4, 4> {
  return a * b;
}

entry transaction go(account: Account) {
  audit("X", account.idempotencyKey);
}`),
    ).toContain("BANK-DEC-004");
  });

  it("allows a product whose digits fit", () => {
    expect(
      ids(`${PREAMBLE}
function narrow(a: decimal<8, 2>, b: decimal<8, 2>): decimal<18, 4> {
  return a * b;
}

entry transaction go(account: Account) {
  audit("X", account.idempotencyKey);
}`),
    ).not.toContain("BANK-DEC-004");
  });
});

describe("BANK-LED-004", () => {
  /**
   * An amount wider than the ledger interface can carry.
   *
   * `BANK-LEDGER-AMOUNT` is `PIC S9(16)V99`, and COBOL truncates a `MOVE` into
   * a narrower field without a word. A posting of 1234.5678 becomes 1234.56 and
   * the ledger balances against a number nobody wrote.
   */
  it("refuses a posting finer than the ledger's own scale", () => {
    expect(
      ids(`${PREAMBLE}
entry transaction go(account: Account, fine: decimal<18, 4>) {
  debit(account.accountId, fine);
  credit("SUSPENSE", fine);
  audit("X", account.idempotencyKey);
}`),
    ).toContain("BANK-LED-004");
  });

  it("allows a posting the interface holds exactly", () => {
    expect(
      ids(`${PREAMBLE}
entry transaction go(account: Account) {
  debit(account.accountId, account.balance);
  credit("SUSPENSE", account.balance);
  audit("X", account.idempotencyKey);
}`),
    ).not.toContain("BANK-LED-004");
  });
});

describe("BANK-FILE-012", () => {
  /**
   * Two files whose names agree in the first eight characters.
   *
   * A DD name is one to eight characters and the dataset name is derived from
   * it, so `settlementExtract` and `settlementReport` are one DD allocated
   * twice, and in a job of several steps, one step's output written over the
   * dataset the next step reads, under a name that looks deliberate.
   */
  it("refuses two files that share a DD name", () => {
    expect(
      ids(`${PREAMBLE}
file settlementExtract sequential output record Account status extractStatus;
file settlementReport sequential output record Account status reportStatus;

entry transaction go(account: Account) {
  audit("X", account.idempotencyKey);
}`),
    ).toContain("BANK-FILE-012");
  });

  it("allows two files that differ within eight characters", () => {
    expect(
      ids(`${PREAMBLE}
file extractOut sequential output record Account status extractStatus;
file reportOut sequential output record Account status reportStatus;

entry transaction go(account: Account) {
  audit("X", account.idempotencyKey);
}`),
    ).not.toContain("BANK-FILE-012");
  });
});

/**
 * Every catalogue entry's `specReference`, if it names a file, must name one.
 *
 * `BANK-LED-004` pointed at `docs/docs/adr/0003-...`, a path with the directory
 * written twice, and `bankc explain` printed it as though it were somewhere to
 * go. Nothing checked it, because the documentation link test reads Markdown
 * files and this is a string in TypeScript.
 */
describe("every catalogued spec reference", () => {
  it("points at a document that exists", async () => {
    const { existsSync } = await import("node:fs");
    const broken = DIAGNOSTICS.filter((entry) => {
      const reference = entry.specReference;
      if (!reference) {
        return false;
      }
      // Rendered exactly as `bankc explain` prints it, which is where the
      // doubled `docs/docs/adr/...` was: the entry held a path that already
      // began `docs/` and the renderer prepends one.
      const rendered = renderDiagnosticDoc(entry)
        .split("\n")
        .find((line) => line.startsWith("Specified by: "));
      if (!rendered) {
        return false;
      }
      const path = rendered
        .replace("Specified by: ", "")
        .split(/\s+section\s+/)[0]!;
      return !existsSync(path);
    }).map((entry) => `${entry.id} → ${entry.specReference}`);

    expect(broken).toEqual([]);
  });
});
