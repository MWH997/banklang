/**
 * PICTURE clauses, and the bytes they describe.
 *
 * A picture is not a type annotation. It is a storage layout: `PIC S9(16)V99
 * COMP-3` says ten bytes of packed decimal holding eighteen digits with two
 * after an assumed decimal point and a sign nibble, and every one of those
 * decisions changes what a `MOVE` does. Getting the layout right is what lets
 * this interpreter and a real COBOL compiler agree on the bytes a program
 * writes, which is the only way the agreement can be checked.
 *
 * Reference: *Enterprise COBOL for z/OS Language Reference*, "PICTURE clause"
 * and "USAGE clause". The packed-decimal encoding is the one z/Architecture
 * implements and GnuCOBOL reproduces: one digit per nibble, low-order nibble a
 * sign of `C` (positive), `D` (negative) or `F` (unsigned).
 */

import { CobolUnsupportedError } from "./source";

export type Usage = "display" | "packed" | "binary";

export type Category =
  | "alphanumeric"
  | "alphabetic"
  | "numeric"
  | "numeric-edited"
  | "alphanumeric-edited";

/**
 * Where a signed `DISPLAY` item keeps its sign.
 *
 * `embedded` is the default and the only one a picture string can express on
 * its own: the sign is overpunched onto a digit. The other two come from the
 * `SIGN IS [LEADING|TRAILING] SEPARATE` clause, which spends a whole byte on a
 * `+` or `-` — and so makes the item one byte longer than its digits.
 *
 * This matters beyond arithmetic. The compiler declares every numeric PARM
 * parameter `SIGN IS LEADING SEPARATE`, because a PARM is characters somebody
 * types on an EXEC statement and nobody types an overpunch. Ignoring the clause
 * sized those fields one byte short, so every parameter after the first
 * amount in the linkage group was read from the wrong offset.
 */
export type SignMode = "embedded" | "leading-separate" | "trailing-separate";

export interface Picture {
  category: Category;
  /** Digit positions, excluding the assumed decimal point. */
  digits: number;
  /** Digit positions after the decimal point. */
  scale: number;
  signed: boolean;
  /** Where the sign lives. Meaningful only when `signed`. */
  sign: SignMode;
  /** The expanded symbol string, one character per position. */
  mask: string;
}

/** True when the sign occupies a byte of its own. */
export function signIsSeparate(picture: Picture): boolean {
  return picture.signed && picture.sign !== "embedded";
}

/**
 * Expands `X(16)` into sixteen `X`s, and `S9(4)V99` into `S9999V99`.
 *
 * Repetition counts are the only compression COBOL's picture strings have, and
 * every rule below is written against the expanded form because that is what
 * the storage layout is counted from.
 */
export function expandPicture(text: string): string {
  let expanded = "";
  let index = 0;
  while (index < text.length) {
    const symbol = text[index]!;
    index += 1;
    // `CR` and `DB` are two-character symbols and each occupies two positions.
    if (
      (symbol === "C" || symbol === "D") &&
      (text[index] === "R" || text[index] === "B")
    ) {
      expanded += symbol + text[index]!;
      index += 1;
      continue;
    }
    if (text[index] !== "(") {
      expanded += symbol;
      continue;
    }
    const close = text.indexOf(")", index);
    if (close < 0) {
      throw new CobolUnsupportedError(`Unclosed repetition in PIC ${text}.`);
    }
    const count = Number(text.slice(index + 1, close));
    if (!Number.isInteger(count) || count < 1) {
      throw new CobolUnsupportedError(`Bad repetition count in PIC ${text}.`);
    }
    expanded += symbol.repeat(count);
    index = close + 1;
  }
  return expanded;
}

/** Symbols that stand for a digit position in an edited picture. */
const EDITED_DIGIT = new Set(["9", "Z", "*"]);

export function parsePicture(text: string): Picture {
  const mask = expandPicture(text.toUpperCase());

  const alphabetic = /^A+$/.test(mask);
  if (alphabetic) {
    return {
      category: "alphabetic",
      digits: 0,
      scale: 0,
      signed: false,
      sign: "embedded",
      mask,
    };
  }

  // Anything holding X or A alongside anything else is a character item.
  if (/[XA]/.test(mask) && !/[9Z*]/.test(mask)) {
    return {
      category: "alphanumeric",
      digits: 0,
      scale: 0,
      signed: false,
      sign: "embedded",
      mask,
    };
  }
  if (/[XA]/.test(mask)) {
    return {
      category: "alphanumeric-edited",
      digits: 0,
      scale: 0,
      signed: false,
      sign: "embedded",
      mask,
    };
  }

  const signed = mask.includes("S");
  const body = mask.replace(/S/g, "");

  // An unedited numeric picture is `9`s with at most one `V`.
  if (/^9*V?9*$/.test(body) && body.replace(/V/g, "").length > 0) {
    const [whole, fraction = ""] = body.split("V");
    return {
      category: "numeric",
      digits: (whole ?? "").length + fraction.length,
      scale: fraction.length,
      signed,
      sign: "embedded",
      mask,
    };
  }

  // Everything else with a digit position in it is numeric-edited: `-(16)9.99`,
  // `ZZ,ZZ9.99`, `+9999`. The decimal point is a real character here, unlike the
  // assumed `V` above, so it occupies a byte and does not count as a digit.
  const digitPositions = [...body].filter((symbol) =>
    EDITED_DIGIT.has(symbol),
  ).length;
  // A floating sign string of n symbols supplies n-1 digit positions.
  const floating = /^([-+$])\1+/.exec(body);
  const floatDigits = floating ? floating[0].length - 1 : 0;
  const dot = body.indexOf(".");
  const scale =
    dot < 0
      ? 0
      : [...body.slice(dot + 1)].filter((symbol) => EDITED_DIGIT.has(symbol))
          .length;

  if (digitPositions + floatDigits === 0) {
    throw new CobolUnsupportedError(`PIC ${text} describes no digit position.`);
  }

  return {
    category: "numeric-edited",
    digits: digitPositions + floatDigits,
    scale,
    signed: /[-+]|CR|DB/.test(body),
    sign: "embedded",
    mask,
  };
}

/** Bytes of storage a picture and usage need together. */
export function storageLength(picture: Picture, usage: Usage): number {
  switch (usage) {
    case "packed":
      // One nibble per digit, plus one for the sign, rounded up to a byte.
      return Math.floor(picture.digits / 2) + 1;
    case "binary":
      if (picture.digits <= 4) {
        return 2;
      }
      if (picture.digits <= 9) {
        return 4;
      }
      if (picture.digits <= 18) {
        return 8;
      }
      throw new CobolUnsupportedError(
        `A binary item cannot hold ${String(picture.digits)} digits.`,
      );
    case "display":
      if (picture.category === "numeric") {
        // A separate sign is a character of its own, so the item is one byte
        // wider than the digits it holds.
        return picture.digits + (signIsSeparate(picture) ? 1 : 0);
      }
      // Every symbol of an edited or character picture is one byte. `V` is the
      // assumed point and occupies none, and it cannot appear in either.
      return picture.mask.replace(/[SV]/g, "").length;
  }
}
