import { describe, expect, it } from "vitest";

import {
  parsePicture,
  storageLength,
} from "../packages/cobol-runtime/src/picture";
import type { Picture, Usage } from "../packages/cobol-runtime/src/picture";
import { CobolUnsupportedError } from "../packages/cobol-runtime/src/source";
import {
  DivideByZero,
  ZERO,
  add,
  compare,
  decimalOf,
  decimalOfNumber,
  decodeNumeric,
  decodeText,
  digitsOf,
  divide,
  edit,
  encodeNumeric,
  encodeText,
  isOverpunched,
  isZero,
  multiply,
  negate,
  overflows,
  rescale,
  subtract,
  toNumber,
} from "../packages/cobol-runtime/src/value";

/**
 * Decimal arithmetic and the bytes it is stored in.
 *
 * `packages/cobol-runtime/src/value.ts` scored 37.44% the first time anything
 * measured it — 232 survivors and 52 mutants nothing executed — because every
 * test that reached it did so through whole programs. That exercises the
 * encodings the emitter generates and nothing else, and this file implements
 * rather more: the EBCDIC overpunch, the separate sign at either end, binary at
 * three widths, and the edited-picture walk.
 *
 * Money is what these functions hold, so the properties worth asserting are
 * exact rather than approximate: truncation toward zero, digits dropped off the
 * high-order end, and a round trip through storage that returns what went in.
 */

/** Somewhere to encode into, filled with a byte that is not a valid digit. */
function buffer(length: number): Uint8Array {
  return new Uint8Array(length).fill(0xff);
}

describe("decimal arithmetic", () => {
  it("restates a value at a wider scale without changing it", () => {
    expect(rescale(decimalOf("1.5"), 3)).toEqual({ units: 1500n, scale: 3 });
  });

  it("returns the same value when the scale already matches", () => {
    const value = decimalOf("1.50");
    expect(rescale(value, 2)).toBe(value);
  });

  /**
   * Truncation toward zero, not rounding: storing into a field with fewer
   * decimal places and no ROUNDED phrase drops the digits, and it drops them
   * the same way on both sides of zero.
   */
  it("truncates toward zero at a narrower scale", () => {
    expect(rescale(decimalOf("1.99"), 1)).toEqual({ units: 19n, scale: 1 });
    expect(rescale(decimalOf("-1.99"), 1)).toEqual({ units: -19n, scale: 1 });
  });

  it("adds and subtracts at the wider of the two scales", () => {
    expect(add(decimalOf("1.5"), decimalOf("2.25"))).toEqual({
      units: 375n,
      scale: 2,
    });
    expect(subtract(decimalOf("2.25"), decimalOf("1.5"))).toEqual({
      units: 75n,
      scale: 2,
    });
  });

  it("multiplies by adding the scales", () => {
    expect(multiply(decimalOf("1.5"), decimalOf("2.25"))).toEqual({
      units: 3375n,
      scale: 3,
    });
  });

  /** Division carries thirty digits so the caller's rounding decides the last. */
  it("divides at a scale wider than any field can observe", () => {
    const quotient = divide(decimalOf("1"), decimalOf("3"));
    expect(quotient.scale).toBe(30);
    expect(quotient.units).toBe(333333333333333333333333333333n);
  });

  it("refuses division by zero rather than returning something", () => {
    expect(() => divide(decimalOf("1"), ZERO)).toThrow(DivideByZero);
    expect(() => divide(decimalOf("1"), ZERO)).toThrow(/Division by zero/);
  });

  it("negates, compares and recognises zero", () => {
    expect(negate(decimalOf("1.25"))).toEqual({ units: -125n, scale: 2 });
    expect(compare(decimalOf("1.5"), decimalOf("1.50"))).toBe(0);
    expect(compare(decimalOf("1.5"), decimalOf("2"))).toBe(-1);
    expect(compare(decimalOf("2"), decimalOf("1.5"))).toBe(1);
    expect(isZero(ZERO)).toBe(true);
    expect(isZero(decimalOf("0.00"))).toBe(true);
    expect(isZero(decimalOf("0.01"))).toBe(false);
  });
});

describe("reading a numeric literal", () => {
  const literals: [text: string, units: bigint, scale: number][] = [
    ["12.34", 1234n, 2],
    ["-5", -5n, 0],
    ["+5", 5n, 0],
    ["0", 0n, 0],
    [".5", 5n, 1],
    ["  7  ", 7n, 0],
  ];

  for (const [text, units, scale] of literals) {
    it(`reads ${JSON.stringify(text)}`, () => {
      expect(decimalOf(text)).toEqual({ units, scale });
    });
  }

  it("refuses text that is not a numeric literal", () => {
    expect(() => decimalOf("12x")).toThrow(CobolUnsupportedError);
    expect(() => decimalOf("12x")).toThrow(/Not a numeric literal/);
  });

  it("reads a JavaScript number and converts back", () => {
    expect(decimalOfNumber(12.34)).toEqual({ units: 1234n, scale: 2 });
    expect(toNumber(decimalOf("12.34"))).toBeCloseTo(12.34, 10);
    expect(toNumber(decimalOf("-5"))).toBe(-5);
  });
});

describe("digits and overflow", () => {
  it("pads to the field width", () => {
    expect(digitsOf(decimalOf("1.5"), 5, 2)).toBe("00150");
  });

  /**
   * Digits past the top of the field are dropped, which is COBOL's answer and
   * exactly the silent loss `ON SIZE ERROR` exists to catch. `digitsOf` reports
   * the bytes; `overflows` is how a caller finds out it happened.
   */
  it("drops digits off the high-order end", () => {
    expect(digitsOf(decimalOf("12345"), 3, 0)).toBe("345");
    expect(overflows(decimalOf("12345"), 3, 0)).toBe(true);
    expect(overflows(decimalOf("345"), 3, 0)).toBe(false);
  });

  it("measures a negative value by its magnitude", () => {
    expect(digitsOf(decimalOf("-1.5"), 5, 2)).toBe("00150");
    expect(overflows(decimalOf("-12345"), 3, 0)).toBe(true);
  });
});

describe("the overpunched sign", () => {
  /**
   * GnuCOBOL's default ASCII configuration writes the EBCDIC overpunch, so a
   * signed unseparated DISPLAY field carries its sign in the last digit. No
   * generated record holds one — money is COMP-3 and counters are COMP — which
   * is exactly why nothing reached this.
   */
  it("recognises both halves of the overpunch table", () => {
    for (const char of "{ABCDEFGHI") {
      expect(isOverpunched(char)).toBe(true);
    }
    for (const char of "}JKLMNOPQR") {
      expect(isOverpunched(char)).toBe(true);
    }
    for (const char of "0123456789 +-") {
      expect(isOverpunched(char)).toBe(false);
    }
  });

  it("writes the positive overpunch into the last digit", () => {
    const picture = parsePicture("S9(3)");
    const bytes = buffer(3);
    encodeNumeric(bytes, 0, 3, decimalOf("123"), picture, "display");
    expect(decodeText(bytes, 0, 3)).toBe("12C");
  });

  it("writes the negative overpunch into the last digit", () => {
    const picture = parsePicture("S9(3)");
    const bytes = buffer(3);
    encodeNumeric(bytes, 0, 3, decimalOf("-123"), picture, "display");
    expect(decodeText(bytes, 0, 3)).toBe("12L");
  });
});

describe("a value through storage and back", () => {
  /**
   * The round trip is the property worth holding: whatever the encoding does to
   * a value, decoding must return it. It covers both directions at once, and a
   * mutant in either is caught by the pair disagreeing.
   */
  const cases: [label: string, pic: string, usage: Usage, text: string][] = [
    ["unsigned display", "9(5)", "display", "12345"],
    ["signed display, positive", "S9(5)", "display", "12345"],
    ["signed display, negative", "S9(5)", "display", "-12345"],
    ["display with scale", "9(3)V99", "display", "123.45"],
    ["unsigned packed", "9(5)", "packed", "12345"],
    ["signed packed, positive", "S9(5)V99", "packed", "12345.67"],
    ["signed packed, negative", "S9(5)V99", "packed", "-12345.67"],
    ["packed, even digit count", "S9(4)", "packed", "-1234"],
    ["binary halfword", "S9(4)", "binary", "-1234"],
    ["binary fullword", "S9(9)", "binary", "-123456789"],
    ["binary doubleword", "S9(18)", "binary", "-123456789012345678"],
    ["binary positive", "S9(9)", "binary", "123456789"],
    ["zero", "S9(5)V99", "packed", "0"],
  ];

  for (const [label, pic, usage, text] of cases) {
    it(`round-trips ${label}`, () => {
      const picture = parsePicture(pic);
      const length = storageLength(picture, usage);
      const bytes = buffer(length + 4);
      const value = rescale(decimalOf(text), picture.scale);
      // Offset deliberately non-zero: an encoder that ignores it would still
      // round-trip against a decoder that ignores it too.
      encodeNumeric(bytes, 2, length, value, picture, usage);
      expect(decodeNumeric(bytes, 2, length, picture, usage)).toEqual(value);
    });
  }

  /** The bytes either side of the field must be left alone. */
  it("writes only inside the field", () => {
    const picture = parsePicture("S9(5)V99");
    const length = storageLength(picture, "packed");
    const bytes = buffer(length + 4);
    encodeNumeric(bytes, 2, length, decimalOf("123.45"), picture, "packed");
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xff);
    expect(bytes[length + 2]).toBe(0xff);
  });

  /**
   * A separate sign spends a byte at one end or the other, and the digits move
   * to make room. Getting the end wrong reads the sign as a digit.
   */
  const separates: [mode: string, text: string, expected: string][] = [
    ["leading-separate", "12345", "+12345"],
    ["leading-separate", "-12345", "-12345"],
    ["trailing-separate", "12345", "12345+"],
    ["trailing-separate", "-12345", "12345-"],
  ];

  for (const [mode, text, expected] of separates) {
    it(`writes a ${mode} sign as ${expected}`, () => {
      const base = parsePicture("S9(5)");
      const picture: Picture = { ...base, sign: mode as Picture["sign"] };
      const length = storageLength(picture, "display");
      const bytes = buffer(length);
      const value = decimalOf(text);
      encodeNumeric(bytes, 0, length, value, picture, "display");
      expect(decodeText(bytes, 0, length)).toBe(expected);
      expect(decodeNumeric(bytes, 0, length, picture, "display")).toEqual(
        value,
      );
    });
  }
});

describe("editing a value for display", () => {
  const edits: [pic: string, text: string, expected: string][] = [
    ["ZZ9", "5", "  5"],
    ["ZZ9", "125", "125"],
    ["999", "5", "005"],
    ["ZZ,ZZ9.99", "1234.56", " 1,234.56"],
    ["ZZ,ZZ9.99", "1.00", "     1.00"],
    ["**,**9.99", "1.00", "*****1.00"],
    ["**,**9.99", "1234.56", "*1,234.56"],
    ["9(3).99", "1.5", "001.50"],
  ];

  for (const [pic, text, expected] of edits) {
    it(`edits ${text} through ${pic} as ${JSON.stringify(expected)}`, () => {
      const picture = parsePicture(pic);
      expect(edit(rescale(decimalOf(text), picture.scale), picture)).toBe(
        expected,
      );
    });
  }

  /**
   * `Z` blanks a suppressed position and `*` fills it, and the difference
   * reaches the insertion characters inside the suppressed run. A comma left as
   * a space in an asterisk-protected field is a gap on a cheque exactly where
   * the protection is supposed to be — this printed `** **1.00` for `1.00`
   * through `PIC **,**9.99` until the picture was measured.
   */
  it("fills a suppressed comma with the protection symbol, not a space", () => {
    const protectedPicture = parsePicture("**,**9.99");
    expect(
      edit(
        rescale(decimalOf("1.00"), protectedPicture.scale),
        protectedPicture,
      ),
    ).toBe("*****1.00");

    const blanked = parsePicture("ZZ,ZZ9.99");
    expect(edit(rescale(decimalOf("1.00"), blanked.scale), blanked)).toBe(
      "     1.00",
    );
  });

  /** A floating sign sits immediately left of the first surviving character. */
  it("floats a sign up against the digits", () => {
    const picture = parsePicture("---9");
    expect(edit(rescale(decimalOf("-5"), picture.scale), picture)).toBe("  -5");
    expect(edit(rescale(decimalOf("5"), picture.scale), picture)).toBe("   5");
  });

  /**
   * An edited picture is what a program prints, so a symbol this interpreter
   * cannot render is refused rather than approximated. A plausible-looking
   * wrong report is the worst outcome available.
   */
  it("refuses a picture it does not implement", () => {
    const picture = parsePicture("9(3)CR");
    expect(() => edit(decimalOf("5"), picture)).toThrow(CobolUnsupportedError);
    expect(() => edit(decimalOf("5"), picture)).toThrow(/does not implement/);
  });
});

describe("character storage", () => {
  it("pads a short value with blanks and truncates a long one", () => {
    const bytes = buffer(6);
    encodeText(bytes, 0, 6, "AB");
    expect(decodeText(bytes, 0, 6)).toBe("AB    ");

    encodeText(bytes, 0, 6, "ABCDEFGH");
    expect(decodeText(bytes, 0, 6)).toBe("ABCDEF");
  });

  it("writes only inside the field", () => {
    const bytes = buffer(8);
    encodeText(bytes, 2, 4, "AB");
    expect(bytes[1]).toBe(0xff);
    expect(bytes[6]).toBe(0xff);
    expect(decodeText(bytes, 2, 4)).toBe("AB  ");
  });
});
