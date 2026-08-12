/**
 * Values, and the bytes they are stored as.
 *
 * Every number here is a scaled integer: `units` counted in `10^-scale`. There
 * is no binary floating point anywhere in this file, for the same reason there
 * is none in the compiler — `0.1 + 0.2` is not `0.3`, and a ledger that is out
 * by a hundredth of a penny is out.
 *
 * The encodings are the ones z/Architecture defines and GnuCOBOL reproduces.
 * They are written out rather than approximated because the point of this
 * interpreter is that it can be compared byte for byte against a real compiler:
 * `tests/cobol-runtime-differential.test.ts` runs every example both ways and
 * fails on any disagreement, and an encoding that is merely close would make
 * that comparison meaningless.
 */

import { signIsSeparate, type Picture, type Usage } from "./picture";
import { CobolUnsupportedError } from "./source";

/** A fixed-point number: `units × 10^-scale`. */
export interface Decimal {
  units: bigint;
  scale: number;
}

export const ZERO: Decimal = { units: 0n, scale: 0 };

const TEN = 10n;

function pow10(exponent: number): bigint {
  let result = 1n;
  for (let index = 0; index < exponent; index += 1) {
    result *= TEN;
  }
  return result;
}

/** Restates a number at a different scale, truncating toward zero. */
export function rescale(value: Decimal, scale: number): Decimal {
  if (value.scale === scale) {
    return value;
  }
  if (scale > value.scale) {
    return { units: value.units * pow10(scale - value.scale), scale };
  }
  const divisor = pow10(value.scale - scale);
  // Truncation toward zero, which is what COBOL does when a value is stored
  // into a field with fewer decimal places and no ROUNDED phrase.
  return { units: value.units / divisor, scale };
}

/** The scale both operands can be compared or added at without losing digits. */
function align(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [rescale(left, scale).units, rescale(right, scale).units, scale];
}

export function add(left: Decimal, right: Decimal): Decimal {
  const [a, b, scale] = align(left, right);
  return { units: a + b, scale };
}

export function subtract(left: Decimal, right: Decimal): Decimal {
  const [a, b, scale] = align(left, right);
  return { units: a - b, scale };
}

export function multiply(left: Decimal, right: Decimal): Decimal {
  return { units: left.units * right.units, scale: left.scale + right.scale };
}

/**
 * Division, carried at a scale wide enough that the caller's rounding decides
 * the last digit rather than this function's truncation.
 *
 * COBOL's intermediate results for division are defined by the ARITH option;
 * `docs/numeric-model.md` records what the compiler assumes. Thirty digits of
 * fraction is past anything an 18-digit target can observe.
 */
const DIVISION_SCALE = 30;

export function divide(left: Decimal, right: Decimal): Decimal {
  if (right.units === 0n) {
    throw new DivideByZero();
  }
  // left = L·10⁻ˡ, right = R·10⁻ʳ, and the quotient wanted at scale D is
  // L·10^(r−l+D) / R. With D at 30 and no COBOL scale above 18, that exponent
  // is never negative, so this stays integer arithmetic throughout.
  const numerator =
    left.units * pow10(DIVISION_SCALE + right.scale - left.scale);
  return { units: numerator / right.units, scale: DIVISION_SCALE };
}

export class DivideByZero extends Error {
  public constructor() {
    super("Division by zero.");
  }
}

export function negate(value: Decimal): Decimal {
  return { units: -value.units, scale: value.scale };
}

export function compare(left: Decimal, right: Decimal): number {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(value: Decimal): boolean {
  return value.units === 0n;
}

/** A decimal from a literal such as `12.34` or `-5`. */
export function decimalOf(text: string): Decimal {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) {
    throw new CobolUnsupportedError(`Not a numeric literal: ${text}`);
  }
  const [, sign, whole = "", fraction = ""] = match;
  const digits = `${whole}${fraction}` || "0";
  const units = BigInt(digits) * (sign === "-" ? -1n : 1n);
  return { units, scale: fraction.length };
}

export function decimalOfNumber(value: number): Decimal {
  return decimalOf(String(value));
}

export function toNumber(value: Decimal): number {
  return Number(value.units) / Number(pow10(value.scale));
}

/** The digits of a value at a given scale, unsigned, zero-padded to `digits`. */
export function digitsOf(
  value: Decimal,
  digits: number,
  scale: number,
): string {
  const scaled = rescale(value, scale);
  const magnitude = (
    scaled.units < 0n ? -scaled.units : scaled.units
  ).toString();
  // Truncation on the high-order end is what COBOL does storing a value too
  // large for its field, and is exactly the silent data loss `ON SIZE ERROR`
  // exists to catch. The caller decides whether that is an error; this only
  // reports the bytes.
  return magnitude.padStart(digits, "0").slice(-digits);
}

/** True when the value has more integer digits than the field can hold. */
export function overflows(
  value: Decimal,
  digits: number,
  scale: number,
): boolean {
  const scaled = rescale(value, scale);
  const magnitude = scaled.units < 0n ? -scaled.units : scaled.units;
  return magnitude >= pow10(digits);
}

/* ------------------------------------------------------------------ *
 * Storage encodings.
 * ------------------------------------------------------------------ */

const CODE_ZERO = 0x30;

/**
 * The overpunched sign an unseparated `DISPLAY` numeric carries.
 *
 * GnuCOBOL in its default ASCII configuration writes the EBCDIC overpunch
 * characters: `{` and `A`-`I` for `+0` to `+9`, `}` and `J`-`R` for `-0` to
 * `-9`. Money the compiler emits is `COMP-3` and counters are `COMP`, so no
 * generated record holds one of these; the unit tests cover it.
 *
 * A PARM is the exception, and the reason the separate sign below exists: the
 * linkage group declares every numeric parameter `SIGN IS LEADING SEPARATE`,
 * because a PARM is characters somebody types on an EXEC statement and `-1200`
 * is what they type. `+` and `-` are the only two signs that form takes.
 */
const POSITIVE_OVERPUNCH = "{ABCDEFGHI";
const NEGATIVE_OVERPUNCH = "}JKLMNOPQR";
const SIGN_PLUS = 0x2b;
const SIGN_MINUS = 0x2d;

/** True when a character is a digit carrying an overpunched sign. */
export function isOverpunched(char: string): boolean {
  return POSITIVE_OVERPUNCH.includes(char) || NEGATIVE_OVERPUNCH.includes(char);
}

export function encodeNumeric(
  bytes: Uint8Array,
  offset: number,
  length: number,
  value: Decimal,
  picture: Picture,
  usage: Usage,
): void {
  const digits = digitsOf(value, picture.digits, picture.scale);
  const negative = picture.signed && value.units < 0n;

  switch (usage) {
    case "display": {
      // A separate sign takes the first or last byte, and the digits take the
      // rest — so where the digits start depends on which end it is at.
      const separate = signIsSeparate(picture);
      const leading = separate && picture.sign === "leading-separate";
      const start = offset + (leading ? 1 : 0);
      for (let index = 0; index < digits.length; index += 1) {
        bytes[start + index] = CODE_ZERO + Number(digits[index]);
      }
      if (separate) {
        bytes[leading ? offset : start + digits.length] = negative
          ? SIGN_MINUS
          : SIGN_PLUS;
        return;
      }
      if (picture.signed) {
        const last = Number(digits[digits.length - 1]);
        const table = negative ? NEGATIVE_OVERPUNCH : POSITIVE_OVERPUNCH;
        bytes[offset + digits.length - 1] = table.charCodeAt(last);
      }
      return;
    }
    case "packed": {
      // Nibbles right to left: sign, then digits. An even digit count leaves a
      // high-order nibble of zero, which is what the hardware expects.
      const padded = digits.padStart(length * 2 - 1, "0");
      for (let index = 0; index < length; index += 1) {
        bytes[offset + index] = 0;
      }
      let nibble = 0;
      for (const digit of padded) {
        const byte = offset + (nibble >> 1);
        const value = Number(digit);
        bytes[byte] =
          nibble % 2 === 0
            ? (bytes[byte]! & 0x0f) | (value << 4)
            : (bytes[byte]! & 0xf0) | value;
        nibble += 1;
      }
      const sign = picture.signed ? (negative ? 0x0d : 0x0c) : 0x0f;
      const last = offset + length - 1;
      bytes[last] = (bytes[last]! & 0xf0) | sign;
      return;
    }
    case "binary": {
      const scaled = rescale(value, picture.scale);
      let magnitude = scaled.units;
      const limit = 1n << BigInt(length * 8);
      if (magnitude < 0n) {
        magnitude += limit;
      }
      magnitude &= limit - 1n;
      for (let index = length - 1; index >= 0; index -= 1) {
        bytes[offset + index] = Number(magnitude & 0xffn);
        magnitude >>= 8n;
      }
      return;
    }
  }
}

export function decodeNumeric(
  bytes: Uint8Array,
  offset: number,
  length: number,
  picture: Picture,
  usage: Usage,
): Decimal {
  switch (usage) {
    case "display": {
      let digits = "";
      let negative = false;
      if (signIsSeparate(picture)) {
        const at =
          picture.sign === "leading-separate" ? offset : offset + length - 1;
        negative = bytes[at] === SIGN_MINUS;
        for (let index = 0; index < length; index += 1) {
          if (offset + index === at) {
            continue;
          }
          const byte = bytes[offset + index]!;
          digits +=
            byte >= CODE_ZERO && byte <= CODE_ZERO + 9
              ? String(byte - CODE_ZERO)
              : "0";
        }
        return {
          units: BigInt(digits || "0") * (negative ? -1n : 1n),
          scale: picture.scale,
        };
      }
      for (let index = 0; index < length; index += 1) {
        const byte = bytes[offset + index]!;
        const char = String.fromCharCode(byte);
        const positive = POSITIVE_OVERPUNCH.indexOf(char);
        const minus = NEGATIVE_OVERPUNCH.indexOf(char);
        if (index === length - 1 && picture.signed && positive >= 0) {
          digits += String(positive);
        } else if (index === length - 1 && picture.signed && minus >= 0) {
          digits += String(minus);
          negative = true;
        } else if (byte >= CODE_ZERO && byte <= CODE_ZERO + 9) {
          digits += String(byte - CODE_ZERO);
        } else {
          // A blank or uninitialised numeric display item reads as zero, which
          // is what GnuCOBOL does and what a program that never moved anything
          // into the field observes.
          digits += "0";
        }
      }
      const units = BigInt(digits || "0") * (negative ? -1n : 1n);
      return { units, scale: picture.scale };
    }
    case "packed": {
      let digits = "";
      for (let index = 0; index < length; index += 1) {
        const byte = bytes[offset + index]!;
        const high = (byte >> 4) & 0x0f;
        const low = byte & 0x0f;
        digits += String(high <= 9 ? high : 0);
        if (index < length - 1) {
          digits += String(low <= 9 ? low : 0);
        }
      }
      const sign = bytes[offset + length - 1]! & 0x0f;
      const negative = sign === 0x0d || sign === 0x0b;
      return {
        units: BigInt(digits || "0") * (negative ? -1n : 1n),
        scale: picture.scale,
      };
    }
    case "binary": {
      let magnitude = 0n;
      for (let index = 0; index < length; index += 1) {
        magnitude = (magnitude << 8n) | BigInt(bytes[offset + index]!);
      }
      if (picture.signed) {
        const limit = 1n << BigInt(length * 8);
        if (magnitude >= limit >> 1n) {
          magnitude -= limit;
        }
      }
      return { units: magnitude, scale: picture.scale };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Editing.
 * ------------------------------------------------------------------ */

/**
 * Formats a value into a numeric-edited picture.
 *
 * Implemented for the symbols the compiler and `runtime/` actually use: a
 * floating sign string, `Z` suppression, `9`, the decimal point, and the comma.
 * Anything else raises rather than being approximated, because an edited field
 * is what a program prints — a wrong one is a wrong report, and a wrong report
 * that looks plausible is the worst outcome available.
 */
export function edit(value: Decimal, picture: Picture): string {
  const mask = picture.mask;
  const supported = /^[-+Z*9,.]+$/;
  if (!supported.test(mask)) {
    throw new CobolUnsupportedError(
      `This interpreter does not implement the edited picture ${mask}.`,
    );
  }

  const negative = value.units < 0n;
  const digits = digitsOf(value, picture.digits, picture.scale);

  // Walk the mask left to right, consuming a digit at each digit position.
  //
  // Only `-` and `+` float. The leftmost symbol of such a string is the sign
  // position and holds no digit, which is why a `PIC -(16)9.99` holds eighteen
  // digits from twenty characters rather than nineteen.
  const floatingSymbol = /^([-+])\1/.exec(mask)?.[1] ?? null;
  const out: string[] = [];
  let consumed = 0;
  let suppressing = true;
  const pointAt = mask.indexOf(".");

  // What a suppressed position is filled with. `Z` blanks it; `*` — check
  // protection, written on a cheque so a suppressed amount cannot be altered —
  // fills it with an asterisk, *including the simple insertion characters
  // inside the suppressed run. `PIC **,**9.99` on 1.00 is `*****1.00`, not
  // `** **1.00`: a gap there is a space where the protection is supposed to be,
  // which is precisely the alteration the asterisk exists to prevent.
  //
  // Standard COBOL does not allow `Z` and `*` in one picture, so the mask
  // holding an asterisk at all decides this for the whole field.
  //
  // Reference: *Enterprise COBOL for z/OS Language Reference*, PICTURE clause,
  // the `*` symbol and the zero-suppression and replacement rules.
  const suppressionFill = mask.includes("*") ? "*" : " ";

  for (const [index, symbol] of [...mask].entries()) {
    const beforePoint = pointAt < 0 || index < pointAt;
    switch (symbol) {
      case "9": {
        out.push(digits[consumed] ?? "0");
        consumed += 1;
        suppressing = false;
        break;
      }
      case "Z":
      case "-":
      case "+": {
        if (index === 0 && floatingSymbol === symbol) {
          out.push(" ");
          break;
        }
        const digit = digits[consumed] ?? "0";
        consumed += 1;
        if (suppressing && digit === "0" && beforePoint) {
          out.push(" ");
        } else {
          suppressing = false;
          out.push(digit);
        }
        break;
      }
      case ",": {
        out.push(suppressing && beforePoint ? suppressionFill : ",");
        break;
      }
      case ".": {
        out.push(".");
        suppressing = false;
        break;
      }
      case "*": {
        const digit = digits[consumed] ?? "0";
        consumed += 1;
        if (suppressing && digit === "0" && beforePoint) {
          out.push("*");
        } else {
          suppressing = false;
          out.push(digit);
        }
        break;
      }
      default:
        out.push(symbol);
    }
  }

  // The sign goes immediately left of the first character that survived
  // suppression, which is what "floating" means.
  if (floatingSymbol === "-" || floatingSymbol === "+") {
    const sign = negative ? "-" : floatingSymbol === "+" ? "+" : "";
    const first = out.findIndex((char) => char !== " ");
    if (sign !== "" && first > 0) {
      out[first - 1] = sign;
    } else if (sign !== "" && first === 0) {
      out.unshift(sign);
      out.pop();
    }
  }

  return out.join("");
}

/* ------------------------------------------------------------------ *
 * Characters.
 * ------------------------------------------------------------------ */

export function decodeText(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index]!);
  }
  return text;
}

export function encodeText(
  bytes: Uint8Array,
  offset: number,
  length: number,
  text: string,
): void {
  for (let index = 0; index < length; index += 1) {
    bytes[offset + index] = index < text.length ? text.charCodeAt(index) : 0x20;
  }
}
