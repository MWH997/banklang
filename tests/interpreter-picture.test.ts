import { describe, expect, it } from "vitest";

import { CobolUnsupportedError } from "../packages/cobol-runtime/src/source";
import {
  expandPicture,
  parsePicture,
  signIsSeparate,
  storageLength,
} from "../packages/cobol-runtime/src/picture";

/**
 * PICTURE clauses, read as the storage layouts they are.
 *
 * `packages/cobol-runtime/src/picture.ts` scored 51.56% the first time anything
 * measured it, and no test called `parsePicture` or `storageLength` directly at
 * all. What reached them reached them through whole programs, which exercises
 * the handful of pictures the emitter generates and none of the rest.
 *
 * The rest matters because this file decides how many bytes a field is and where
 * its digits sit. `tests/cobol-runtime-differential.test.ts` compares this
 * interpreter against `cobc` byte for byte, so a picture read one byte short
 * moves every field after it and the comparison fails somewhere else entirely,
 * which is exactly what happened when `SIGN IS LEADING SEPARATE` was ignored and
 * every PARM parameter after the first amount was read from the wrong offset.
 */

describe("expanding a repetition count", () => {
  it("expands a count into that many symbols", () => {
    expect(expandPicture("X(4)")).toBe("XXXX");
    expect(expandPicture("S9(4)V99")).toBe("S9999V99");
  });

  it("leaves a picture with no repetition alone", () => {
    expect(expandPicture("999V99")).toBe("999V99");
  });

  /**
   * `CR` and `DB` are single symbols spelled with two characters, and each
   * occupies two positions. Read one character at a time, the `R` of `CR` would
   * be taken for a repetition target and the credit symbol would vanish.
   */
  it("keeps CR and DB together as one symbol", () => {
    expect(expandPicture("9(3)CR")).toBe("999CR");
    expect(expandPicture("9(3)DB")).toBe("999DB");
  });

  it("refuses an unclosed repetition", () => {
    expect(() => expandPicture("9(4")).toThrow(CobolUnsupportedError);
    expect(() => expandPicture("9(4")).toThrow(/Unclosed repetition/);
  });

  /**
   * A count that is not a positive whole number describes no storage. Letting
   * `9(0)` through would produce a zero-length field, and every field after it
   * would sit at the wrong offset.
   */
  it("refuses a repetition count that is not a positive integer", () => {
    for (const bad of ["9(0)", "9(-1)", "9(x)", "9(1.5)"]) {
      expect(() => expandPicture(bad)).toThrow(CobolUnsupportedError);
      expect(() => expandPicture(bad)).toThrow(/Bad repetition count/);
    }
  });
});

describe("the category a picture describes", () => {
  /**
   * One case per arm, because the arms are ordered and each shadows the next.
   * `XX99` is alphanumeric-edited only because the alphanumeric arm above it
   * refuses to claim a mask that also holds a digit position.
   */
  const categories: [picture: string, category: string][] = [
    ["AAA", "alphabetic"],
    ["XXX", "alphanumeric"],
    ["XXXAAA", "alphanumeric"],
    ["XX99", "alphanumeric-edited"],
    ["999", "numeric"],
    ["S9(4)V99", "numeric"],
    ["ZZ,ZZ9.99", "numeric-edited"],
    ["9(3)CR", "numeric-edited"],
  ];

  for (const [picture, category] of categories) {
    it(`reads ${picture} as ${category}`, () => {
      expect(parsePicture(picture).category).toBe(category);
    });
  }

  it("counts digits and scale on an unedited numeric", () => {
    const picture = parsePicture("S9(4)V99");
    expect(picture.digits).toBe(6);
    expect(picture.scale).toBe(2);
    expect(picture.signed).toBe(true);
  });

  /**
   * On an edited picture the decimal point is a real character, so it occupies
   * a byte and does not count as a digit, unlike the assumed `V` above.
   */
  it("counts digits and scale on a numeric-edited picture", () => {
    const picture = parsePicture("ZZ,ZZ9.99");
    expect(picture.digits).toBe(7);
    expect(picture.scale).toBe(2);
  });

  /**
   * A floating sign string of n symbols supplies n-1 digit positions: one of
   * them is spent on the sign itself. `---9` is therefore three digits, not
   * four: the `9`, plus two of the three dashes.
   */
  it("credits a floating sign string with all but one of its symbols", () => {
    expect(parsePicture("---9").digits).toBe(3);
    expect(parsePicture("+++9").digits).toBe(3);
  });

  /**
   * A floating currency symbol floats the same way and is not a sign. `$$$9`
   * has the same three digit positions and is unsigned, which is what keeps a
   * currency-edited field from being read as though it could go negative.
   */
  it("floats a currency symbol without making the item signed", () => {
    const picture = parsePicture("$$$9");
    expect(picture.digits).toBe(3);
    expect(picture.signed).toBe(false);
  });

  it("treats CR and DB as a sign", () => {
    expect(parsePicture("9(3)CR").signed).toBe(true);
    expect(parsePicture("9(3)DB").signed).toBe(true);
    expect(parsePicture("ZZ9").signed).toBe(false);
  });

  /**
   * A mask with no digit position describes nothing that can hold a number.
   * Accepting it would produce a zero-digit numeric field.
   */
  it("refuses a picture with no digit position", () => {
    expect(() => parsePicture(".")).toThrow(CobolUnsupportedError);
    expect(() => parsePicture(".")).toThrow(/describes no digit position/);
  });
});

describe("the bytes a picture and usage need", () => {
  /** One nibble per digit plus a sign nibble, rounded up to whole bytes. */
  it("sizes a packed item at half a byte per digit plus the sign", () => {
    expect(storageLength(parsePicture("9(4)"), "packed")).toBe(3);
    expect(storageLength(parsePicture("S9(16)V99"), "packed")).toBe(10);
  });

  /**
   * Binary items come in three widths and the boundaries are exact: nine digits
   * fit in four bytes and ten do not.
   */
  const binaries: [digits: string, bytes: number][] = [
    ["9(4)", 2],
    ["9(5)", 4],
    ["9(9)", 4],
    ["9(10)", 8],
    ["9(18)", 8],
  ];

  for (const [digits, bytes] of binaries) {
    it(`sizes a binary ${digits} at ${String(bytes)} bytes`, () => {
      expect(storageLength(parsePicture(digits), "binary")).toBe(bytes);
    });
  }

  it("refuses a binary item wider than eighteen digits", () => {
    expect(() => storageLength(parsePicture("9(19)"), "binary")).toThrow(
      CobolUnsupportedError,
    );
  });

  it("sizes a display numeric at one byte per digit", () => {
    expect(storageLength(parsePicture("9(4)"), "display")).toBe(4);
  });

  /**
   * A separate sign spends a byte of its own, so the item is one wider than its
   * digits. This is the clause that sized every PARM parameter one byte short.
   */
  it("adds a byte for a separate sign", () => {
    const embedded = parsePicture("S9(4)");
    expect(storageLength(embedded, "display")).toBe(4);

    const separate = { ...embedded, sign: "leading-separate" as const };
    expect(signIsSeparate(separate)).toBe(true);
    expect(storageLength(separate, "display")).toBe(5);
  });

  it("does not call an unsigned item's sign separate", () => {
    expect(signIsSeparate(parsePicture("9(4)"))).toBe(false);
  });
});
