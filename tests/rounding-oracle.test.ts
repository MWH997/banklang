import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * The generated rounding sequences, executed and compared against exact
 * arithmetic.
 *
 * Enterprise COBOL has one rounding phrase. `ROUNDED` is half-up away from
 * zero, there is no `MODE IS` sub-phrase, and the five other modes BankTS
 * offers are arithmetic this compiler writes out: a truncation, the excess that
 * truncation discarded, and a conditional step of one unit in the last place.
 *
 * Reading that COBOL cannot tell a correct sequence from one that is off by a
 * unit at the tie, and neither can a test that asserts the text of it. The only
 * honest check is to run it over inputs chosen to land on and around every
 * boundary and compare each answer against arithmetic done exactly, which
 * here is a rational, held in two BigInts, rounded by the rule the mode names.
 *
 * Both shapes are covered, because they are different code. A multiplication
 * rounds from `expression - truncated`, evaluated in COBOL's own intermediate
 * result; a division rounds from `DIVIDE ... REMAINDER`, because a quotient has
 * no exact truncation to subtract from.
 */

const available =
  spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

/** The modes this compiler generates arithmetic for, and the one it does not. */
const MODES = [
  "HALF_UP",
  "HALF_EVEN",
  "HALF_DOWN",
  "UP",
  "DOWN",
  "CEILING",
  "FLOOR",
] as const;

type Mode = (typeof MODES)[number];

/** An exact decimal: `units` scaled by ten to the negative `scale`. */
interface Decimal {
  units: bigint;
  scale: number;
}

function decimal(text: string): Decimal {
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  return {
    units: BigInt(`${text.startsWith("-") ? "-" : ""}${whole}${fraction}`),
    scale: fraction.length,
  };
}

function render(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale);
  const fraction = digits.slice(digits.length - value.scale);
  return `${negative ? "-" : ""}${whole}${value.scale > 0 ? `.${fraction}` : ""}`;
}

/**
 * `n / d` rounded to an integer by the rule the mode names.
 *
 * The sign is moved onto the numerator so every comparison below is between
 * magnitudes, which is what each rule is actually about: `UP` is away from
 * zero, `CEILING` is toward positive infinity, and the two differ only in
 * sign.
 */
function roundQuotient(n: bigint, d: bigint, mode: Mode): bigint {
  const numerator = d < 0n ? -n : n;
  const divisor = d < 0n ? -d : d;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;

  const whole = magnitude / divisor;
  const remainder = magnitude % divisor;
  if (remainder === 0n) {
    return negative ? -whole : whole;
  }

  const twice = remainder * 2n;
  const away = (): bigint => (negative ? -(whole + 1n) : whole + 1n);
  const toward = (): bigint => (negative ? -whole : whole);

  switch (mode) {
    case "DOWN":
      return toward();
    case "UP":
      return away();
    case "CEILING":
      return negative ? toward() : away();
    case "FLOOR":
      return negative ? away() : toward();
    case "HALF_UP":
      return twice >= divisor ? away() : toward();
    case "HALF_DOWN":
      return twice > divisor ? away() : toward();
    case "HALF_EVEN":
      if (twice > divisor) {
        return away();
      }
      if (twice < divisor) {
        return toward();
      }
      return whole % 2n === 0n ? toward() : away();
  }
}

/** `left * right` rounded to `scale`, exactly. */
function expectedProduct(
  left: Decimal,
  right: Decimal,
  scale: number,
  mode: Mode,
): string {
  const product = {
    units: left.units * right.units,
    scale: left.scale + right.scale,
  };
  const shift = BigInt(10) ** BigInt(product.scale - scale);
  return render({ units: roundQuotient(product.units, shift, mode), scale });
}

/** `left / right` rounded to `scale`, exactly. */
function expectedQuotient(
  left: Decimal,
  right: Decimal,
  scale: number,
  mode: Mode,
): string {
  const numerator = left.units * BigInt(10) ** BigInt(right.scale + scale);
  const denominator = right.units * BigInt(10) ** BigInt(left.scale);
  return render({
    units: roundQuotient(numerator, denominator, mode),
    scale,
  });
}

/**
 * The operand pairs each case is run over.
 *
 * Chosen rather than random. What a rounding rule can get wrong is the tie and
 * the values either side of it, the sign of the excess, and zero, so every
 * pair here either lands exactly on half a unit in the last place, one unit
 * away from it in each direction, or on a boundary a mode treats specially.
 * Random inputs would mostly land nowhere near any of them.
 */
const PRODUCT_CASES: [string, string][] = [
  // Exact ties: the digit past the receiver's scale is a 5 and nothing follows.
  ["1.0050", "1.0000"],
  ["1.0150", "1.0000"],
  ["2.0050", "1.0000"],
  ["-1.0050", "1.0000"],
  ["-1.0150", "1.0000"],
  ["1.0050", "-1.0000"],
  // Either side of a tie by one unit in the last place of the intermediate.
  ["1.0051", "1.0000"],
  ["1.0049", "1.0000"],
  ["-1.0051", "1.0000"],
  ["-1.0049", "1.0000"],
  // Nothing to discard, which every mode has to leave alone.
  ["1.0000", "1.0000"],
  ["-2.5000", "1.0000"],
  ["0.0000", "1.0000"],
  // A real multiplication, where the excess is not a round number.
  ["1234.5678", "1.0500"],
  ["-1234.5678", "1.0500"],
  ["9999.9999", "1.0001"],
  ["0.0001", "0.0001"],
  ["12345.6789", "0.0725"],
];

const QUOTIENT_CASES: [string, string][] = [
  // A quotient that is exactly half a unit past the receiver's scale.
  ["1.0000", "8.0000"],
  ["3.0000", "8.0000"],
  ["-1.0000", "8.0000"],
  ["1.0000", "-8.0000"],
  // Recurring, so the remainder is never zero and the sign of it decides.
  ["1.0000", "3.0000"],
  ["-1.0000", "3.0000"],
  ["2.0000", "3.0000"],
  ["-2.0000", "3.0000"],
  ["1.0000", "-3.0000"],
  // Exact, so nothing is discarded.
  ["1.0000", "4.0000"],
  ["-9.0000", "4.5000"],
  ["0.0000", "7.0000"],
  // Larger operands, where the intermediate has to hold more digits.
  ["12345.6789", "7.0000"],
  ["-98765.4321", "11.0000"],
  ["1.0000", "7.0000"],
];

/** Where the answer is stored, which is what the rounding is to. */
const SCALE = 2;

/**
 * One program per mode and shape, computing every case and logging the answer.
 *
 * One compile and one run for a hundred-odd comparisons, rather than a process
 * per case. The point is coverage of the boundaries, and a test nobody runs
 * because it takes four minutes covers nothing.
 */
function programFor(
  mode: Mode,
  shape: "product" | "quotient",
  cases: readonly [string, string][],
): string {
  // BankTS has no unary minus on a literal, so a negative operand is written
  // as a subtraction from zero. It is exact at the same scale, and it is the
  // value that matters here rather than how it was spelt.
  const operand = (text: string): string =>
    text.startsWith("-") ? `0.0000 - ${text.slice(1)}` : text;

  const body = cases
    .flatMap(([left, right], index) => [
      `  work.left = ${operand(left)};`,
      `  work.right = ${operand(right)};`,
      shape === "product"
        ? `  work.answer = round(work.left * work.right, "${mode}");`
        : `  work.answer = divide(work.left, work.right, "${mode}");`,
      `  log "CASE ${index} ", work.answer;`,
    ])
    .join("\n");

  return `module RoundOracle;

record Work {
  left: decimal<14, 4>;
  right: decimal<14, 4>;
  answer: decimal<14, ${SCALE}>;
  idempotencyKey: string<36>;
}

entry transaction run(work: Work) {
${body}
  audit("ROUNDED", work.idempotencyKey);
}`;
}

/** The value each `log` line reported, in case order. */
function runProgram(source: string, dir: string): string[] {
  const result = compile(source);
  expect(
    result.diagnostics.filter((entry) => entry.severity === "error"),
  ).toEqual([]);

  writeFileSync(join(dir, "program.cbl"), localCobol(result.cobol), "utf8");
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

  return ran.stdout
    .split("\n")
    .flatMap((line) => {
      const match = /^CASE (\d+) (.+)$/.exec(line.trim());
      return match ? [[Number(match[1]), match[2]!.trim()] as const] : [];
    })
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value);
}

/**
 * `DISPLAY` of a packed field writes a sign and every digit of the picture.
 * The comparison is against a value, not against a layout.
 */
function asDecimal(display: string): string {
  const match = /^([+-])?0*(\d+)(?:\.(\d+))?$/.exec(display);
  if (!match) {
    throw new Error(`Not a number this test can read: ${display}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const value = `${whole}${fraction ? `.${fraction}` : ""}`;
  return sign === "-" && Number(value) !== 0 ? `-${value}` : value;
}

/** Two renderings of the same value compare equal. */
function sameValue(a: string, b: string): boolean {
  const normalise = (text: string): string => {
    const value = decimal(text);
    return render({ units: value.units, scale: value.scale }).replace(
      /^(-?)0+(?=\d)/,
      "$1",
    );
  };
  return normalise(a) === normalise(b);
}

describe.skipIf(!available)("every rounding mode, run and checked", () => {
  const dir = available ? mkdtempSync(join(tmpdir(), "bankc-oracle-")) : "";

  for (const mode of MODES) {
    it(`rounds a product the way ${mode} says`, () => {
      const answers = runProgram(
        programFor(mode, "product", PRODUCT_CASES),
        dir,
      );

      expect(answers).toHaveLength(PRODUCT_CASES.length);
      PRODUCT_CASES.forEach(([left, right], index) => {
        const expected = expectedProduct(
          decimal(left),
          decimal(right),
          SCALE,
          mode,
        );
        const actual = asDecimal(answers[index]!);

        expect(
          sameValue(actual, expected),
          `${mode}: ${left} * ${right} to ${SCALE} places is ${expected}, and the generated program said ${actual}`,
        ).toBe(true);
      });
    });

    it(`rounds a quotient the way ${mode} says`, () => {
      const answers = runProgram(
        programFor(mode, "quotient", QUOTIENT_CASES),
        dir,
      );

      expect(answers).toHaveLength(QUOTIENT_CASES.length);
      QUOTIENT_CASES.forEach(([left, right], index) => {
        const expected = expectedQuotient(
          decimal(left),
          decimal(right),
          SCALE,
          mode,
        );
        const actual = asDecimal(answers[index]!);

        expect(
          sameValue(actual, expected),
          `${mode}: ${left} / ${right} to ${SCALE} places is ${expected}, and the generated program said ${actual}`,
        ).toBe(true);
      });
    });
  }
});

/**
 * The oracle checked against itself, so a test failure above means the compiler
 * is wrong rather than that this file is.
 */
describe("the oracle", () => {
  it("rounds a tie the way each mode names", () => {
    const half = (mode: Mode): string =>
      render({ units: roundQuotient(25n, 10n, mode), scale: 0 });

    expect(half("HALF_UP")).toBe("3");
    expect(half("HALF_DOWN")).toBe("2");
    expect(half("HALF_EVEN")).toBe("2");
    expect(half("UP")).toBe("3");
    expect(half("DOWN")).toBe("2");
    expect(half("CEILING")).toBe("3");
    expect(half("FLOOR")).toBe("2");
  });

  it("takes a negative tie the other way where the mode is signed", () => {
    const half = (mode: Mode): string =>
      render({ units: roundQuotient(-25n, 10n, mode), scale: 0 });

    expect(half("HALF_UP")).toBe("-3");
    expect(half("HALF_EVEN")).toBe("-2");
    expect(half("UP")).toBe("-3");
    expect(half("DOWN")).toBe("-2");
    expect(half("CEILING")).toBe("-2");
    expect(half("FLOOR")).toBe("-3");
  });

  it("rounds the other side of even the other way", () => {
    expect(
      render({ units: roundQuotient(35n, 10n, "HALF_EVEN"), scale: 0 }),
    ).toBe("4");
  });
});
