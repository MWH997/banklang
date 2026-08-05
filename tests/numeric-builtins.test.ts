import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol } from "./helpers";

/**
 * The arithmetic COBOL already knows how to do — including the two it knows
 * because it was written for this industry.
 *
 * `ANNUITY` is the repayment factor of a loan and `PRESENT-VALUE` discounts a
 * cash flow. They are intrinsic functions of the language, not something this
 * compiler computes, and that is exactly why they are worth routing to: a
 * repayment factor worked out in a loop rounds differently from the one the
 * compiler's own intrinsic produces, and the difference lands in a customer's
 * final instalment.
 *
 * `mod` is what a check digit is. `isNumeric` is how a batch decides whether a
 * field from a flat file can be converted before it tries, which is the
 * difference between rejecting a record and abending on it.
 */

const PREAMBLE = `module Loan;

record Mortgage {
  principal: decimal<9, 2>;
  monthlyRate: decimal<9, 6>;
  termMonths: binary<4>;
  payment: decimal<9, 2>;
  idempotencyKey: string<36>;
}

record Feed {
  rawAmount: string<12>;
  parsed: decimal<9, 2>;
  checkDigit: binary<4>;
  flag: bool;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction quote(mortgage: Mortgage, feed: Feed) {
${body}
  audit("QUOTED", mortgage.idempotencyKey);
}`);
}

describe("each becomes its COBOL intrinsic", () => {
  const cases: [string, string][] = [
    [
      "  mortgage.payment = abs(mortgage.principal);",
      "FUNCTION ABS(PRINCIPAL OF MORTGAGE)",
    ],
    ["  feed.checkDigit = mod(123456789, 97);", "FUNCTION MOD(123456789, 97)"],
    ["  feed.checkDigit = rem(123456789, 97);", "FUNCTION REM(123456789, 97)"],
    [
      "  mortgage.payment = min(mortgage.principal, mortgage.payment);",
      "FUNCTION MIN(",
    ],
    [
      "  mortgage.payment = max(mortgage.principal, mortgage.payment);",
      "FUNCTION MAX(",
    ],
    [
      '  mortgage.payment = round(annuity(mortgage.monthlyRate, mortgage.termMonths), "HALF_UP");',
      "FUNCTION ANNUITY(",
    ],
    [
      '  mortgage.payment = round(presentValue(mortgage.monthlyRate, mortgage.principal), "HALF_UP");',
      "FUNCTION PRESENT-VALUE(",
    ],
    ["  feed.parsed = toNumber(feed.rawAmount);", "FUNCTION NUMVAL-C("],
    ["  feed.flag = isNumeric(feed.rawAmount);", "FUNCTION TEST-NUMVAL-C("],
    [
      "  mortgage.payment = integerPart(mortgage.principal);",
      "FUNCTION INTEGER-PART(",
    ],
    [
      "  mortgage.payment = fractionPart(mortgage.principal);",
      "FUNCTION FRACTION-PART(",
    ],
    ["  feed.checkDigit = sign(mortgage.principal);", "FUNCTION SIGN("],
    ["  feed.rawAmount = reverse(feed.rawAmount);", "FUNCTION REVERSE("],
    [
      "  feed.checkDigit = textLength(feed.rawAmount);",
      "FUNCTION STORED-CHAR-LENGTH(",
    ],
  ];

  for (const [source, expected] of cases) {
    it(`emits ${expected.replace(/\($/, "")}`, () => {
      const result = program(source);

      expect(result.diagnostics).toEqual([]);
      expect(flowed(result.cobol)).toContain(expected);
    });
  }
});

describe("what they will take", () => {
  it("rejects the wrong number of arguments", () => {
    expect(ids(program("  mortgage.payment = abs(1.00, 2.00);"))).toContain(
      "BANK-TYPE-003",
    );
  });

  /** A check digit is integer arithmetic, and so is COBOL's MOD. */
  it("rejects a fractional modulus", () => {
    expect(
      ids(program("  feed.checkDigit = mod(mortgage.principal, 97);")),
    ).toContain("BANK-TYPE-003");
  });

  /** Comparing two numbers means the same two numbers, as anywhere else. */
  it("rejects min across two different types", () => {
    const result = compile(`${PREAMBLE}
type GBP = currency<"GBP", 18, 2>;
type EUR = currency<"EUR", 18, 2>;

record Pair {
  sterling: GBP;
  euro: EUR;
}

entry transaction quote(mortgage: Mortgage, pair: Pair) {
  pair.sterling = min(pair.sterling, pair.euro);
  audit("QUOTED", mortgage.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects a term that is not whole", () => {
    expect(
      ids(
        program(
          '  mortgage.payment = round(annuity(mortgage.monthlyRate, mortgage.principal), "HALF_UP");',
        ),
      ),
    ).toContain("BANK-TYPE-003");
  });

  /** A number has no order to reverse, and text has no magnitude. */
  it("keeps the text ones on text and the number ones on numbers", () => {
    expect(
      ids(program("  feed.rawAmount = reverse(mortgage.principal);")),
    ).toContain("BANK-TYPE-003");
    expect(
      ids(program("  mortgage.payment = integerPart(feed.rawAmount);")),
    ).toContain("BANK-TYPE-003");
  });

  it("reads text, not a number", () => {
    expect(
      ids(program("  feed.flag = isNumeric(mortgage.principal);")),
    ).toContain("BANK-TYPE-003");
  });

  /** The names stay usable as fields, like every other builtin family. */
  it("does not reserve the names", () => {
    const result = compile(`module Loan;

record Bounds {
  min: decimal<9, 2>;
  max: decimal<9, 2>;
  abs: decimal<9, 2>;
  idempotencyKey: string<36>;
}

entry transaction quote(bounds: Bounds) {
  bounds.min = bounds.max;
  audit("QUOTED", bounds.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });
});

/**
 * The arithmetic is the claim, so the arithmetic is what gets run. £100,000 at
 * 0.5% a month over 240 months is a payment of £716.43 — the number a mortgage
 * calculator gives, produced here by COBOL rather than by this compiler.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("prices a loan, parses a feed, checks a digit", () => {
    const result = program(`  mortgage.principal = 100000.00;
  mortgage.monthlyRate = 0.005000;
  mortgage.termMonths = 240;
  mortgage.payment = round(mortgage.principal * annuity(mortgage.monthlyRate, mortgage.termMonths), "HALF_UP");
  log "PAYMENT ", mortgage.payment;

  feed.rawAmount = "  1,234.56  ";
  if isNumeric(feed.rawAmount) {
    feed.parsed = toNumber(feed.rawAmount);
    log "PARSED ", feed.parsed;
  } else {
    returnCode = 12;
  }

  feed.checkDigit = mod(123456789, 97);
  log "CHECK ", feed.checkDigit;`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-numeric-"));
    writeFileSync(join(dir, "program.cbl"), localCobol(result.cobol ?? ""), "utf8");

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);

    // The standard repayment on a 20-year £100,000 loan at 0.5% a month.
    expect(ran.stdout).toContain("0000716.43");
    // "  1,234.56  " read through the grouping and the padding.
    expect(ran.stdout).toContain("0001234.56");
    // 123456789 mod 97, which is how an IBAN check digit is worked out.
    expect(ran.stdout).toContain("0039");
  });

  /**
   * Splitting an amount into whole units and the remainder, which is what a
   * cash-handling or a settlement program does, and measuring what a fixed
   * field actually holds rather than how wide it was declared.
   */
  it.skipIf(!available)("splits an amount and measures a field", () => {
    const result = program(`  mortgage.principal = 1234.56;
  mortgage.payment = integerPart(mortgage.principal);
  log "WHOLE ", mortgage.payment;
  mortgage.payment = fractionPart(mortgage.principal);
  log "PART ", mortgage.payment;
  feed.rawAmount = "1234";
  feed.checkDigit = textLength(feed.rawAmount);
  log "USED ", feed.checkDigit;
  feed.checkDigit = sign(mortgage.principal);
  log "SIGN ", feed.checkDigit;`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-numeric2-"));
    writeFileSync(join(dir, "program.cbl"), localCobol(result.cobol ?? ""), "utf8");

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);

    expect(ran.stdout).toContain("1234.00");
    expect(ran.stdout).toContain("0000.56");
    // The field is PIC X(12); four characters are in it.
    expect(ran.stdout).toContain("0004");
    expect(ran.stdout).toContain("0001");
  });
});
