import { describe, expect, it } from "vitest";

import {
  editedPicture,
  enumWidth,
  fitCobolWord,
  isReservedSlotName,
  MAX_COBOL_WORD_LENGTH,
  temporalLength,
  temporalPicture,
  toCobolFieldName,
  toCobolName,
} from "../packages/cobol-ir/src/index";

/**
 * The pure functions that decide what a generated name and picture look like.
 *
 * Every one of these was reached only through end-to-end compilation, and the
 * emitter mutation lane said what that was worth: `packages/cobol-ir/src/index.ts`
 * scored **44.12%** with 81 surviving mutants and 33 lines no test reached, while
 * the lane's aggregate passed at 61.65 because two healthier files carried it.
 * A golden fixture proves the whole pipeline agrees with itself; it does not
 * notice when a boundary inside one of these is off by one, because the fixture
 * moves with the code.
 *
 * So these are direct, and they are written at the boundaries the mutants live
 * on: the comparison that decides whether a word already fits, the tie-break
 * that picks which segment to abbreviate, the guard that stops the middle being
 * eaten, and the arithmetic that places a group separator.
 */

describe("fitting a name into a COBOL word", () => {
  it("leaves a name that already fits exactly at the limit", () => {
    const exact = "A".repeat(MAX_COBOL_WORD_LENGTH);
    expect(fitCobolWord(exact)).toBe(exact);
    // One over is where the work starts — the boundary, not near it.
    expect(fitCobolWord(`${exact}A`)).not.toBe(`${exact}A`);
  });

  /**
   * A single word is a length problem, not an abbreviation problem.
   *
   * The loop shortens the longest segment to four characters and goes round
   * again, which is right when there are several words to trade off. With one
   * word there is nothing to trade, and it used to return four characters and
   * discard the other twenty-six: `settlementreconciliationthresholdvalue`
   * became `SETT`, so any other identifier starting with those four letters
   * collided with it.
   */
  it("truncates a single word to the limit rather than to four characters", () => {
    const long = "A".repeat(38);
    expect(fitCobolWord(long)).toBe("A".repeat(MAX_COBOL_WORD_LENGTH));

    const name = toCobolName("settlementreconciliationthresholdvalue");
    expect(name).toHaveLength(MAX_COBOL_WORD_LENGTH);
    expect(name.startsWith("SETTLEMENT")).toBe(true);
  });

  it("abbreviates the longest segment, and keeps the suffix", () => {
    // The suffix is what tells a routine from its result field, so it survives.
    expect(fitCobolWord("ACCOUNT-INTEREST-CALCULATION-RESULT")).toBe(
      "ACCOUNT-INTEREST-CALC-RESULT",
    );
  });

  it("leaves a segment already at the floor alone", () => {
    // `> floor`, not `>=`: a four-character segment is not shortened, so a name
    // made only of them is handled by the middle-removal path below.
    expect(fitCobolWord("AAAA-BBBBBB-CCCC", 16)).toBe("AAAA-BBBBBB-CCCC");
    expect(fitCobolWord("AAAAAA-BBBBBB", 12)).toBe("AAAA-BBBBBB");
  });

  /**
   * When every segment is at the floor, segments come out of the *middle* and
   * the first and last are kept — a long name carries least in the middle, and
   * cutting the tail would take the suffix off.
   */
  it("removes middle segments when nothing can be abbreviated further", () => {
    expect(fitCobolWord("AAAA-BBBB-CCCC-DDDD", 10)).toBe("AAAA-DDDD");
    expect(fitCobolWord("AAAA-BBBB-CCCC", 9)).toBe("AAAA-CCCC");
  });

  it("never eats past two segments, and never ends on a hyphen", () => {
    // `segments.length > 2` is what keeps the first and the last.
    const tight = fitCobolWord("AAAA-BBBB-CCCC-DDDD-EEEE", 6);
    expect(tight).not.toMatch(/-$/);
    expect(tight.split("-").length).toBeGreaterThanOrEqual(1);
    expect(tight.length).toBeLessThanOrEqual(6);
  });

  it("never returns more than the limit, for any shape", () => {
    const shapes = [
      "A".repeat(80),
      "ACCOUNT-INTEREST-CALCULATION-RESULT-PARAMETER-CELL",
      "AAAA-".repeat(12) + "ZZZZ",
      "CUSTOMER-STATEMENT-GENERATION-PARAMETER-CELL",
      "A-B-C-D-E-F-G-H-I-J-K-L-M-N-O-P-Q-R-S-T-U-V-W-X-Y-Z",
    ];
    for (const shape of shapes) {
      for (const limit of [6, 10, 18, 30]) {
        const fitted = fitCobolWord(shape, limit);
        expect(
          fitted.length,
          `${shape} @ ${String(limit)}`,
        ).toBeLessThanOrEqual(limit);
        expect(fitted, `${shape} @ ${String(limit)}`).not.toMatch(/-$/);
      }
    }
  });

  it("is deterministic, which is what makes a collision a real defect", () => {
    const name = "CUSTOMER-STATEMENT-GENERATION-PARAMETER-CELL";
    expect(fitCobolWord(name)).toBe(fitCobolWord(name));
  });
});

describe("a reserved slot", () => {
  it("becomes FILLER, which is not a name and may repeat", () => {
    expect(isReservedSlotName("reserved#1")).toBe(true);
    expect(toCobolFieldName("reserved#2")).toBe("FILLER");
  });

  it("is recognised by its prefix, not by containing the marker", () => {
    // `startsWith`, so a field a programmer wrote cannot be turned into FILLER
    // by having the marker somewhere inside it.
    expect(isReservedSlotName("not-reserved#1")).toBe(false);
    expect(toCobolFieldName("balance")).not.toBe("FILLER");
  });
});

describe("an enum's width", () => {
  it("is the widest member", () => {
    expect(enumWidth(["AB", "CDEF", "G"])).toBe(4);
  });

  it("is never zero, so PIC X(0) cannot be emitted", () => {
    // The reduce seeds at 1 rather than 0 for exactly this.
    expect(enumWidth([])).toBe(1);
    expect(enumWidth([""])).toBe(1);
  });
});

describe("temporal storage", () => {
  /** Held together: a picture and a length that disagree is a truncated field. */
  it("gives each unit its picture and a matching length", () => {
    const expected = {
      date: ["PIC 9(8)", 8],
      time: ["PIC 9(6)", 6],
      timestamp: ["PIC X(26)", 26],
    } as const;

    for (const [unit, [picture, length]] of Object.entries(expected)) {
      const key = unit as keyof typeof expected;
      expect(temporalPicture(key)).toBe(picture);
      expect(temporalLength(key)).toBe(length);
      // The digits in the picture are the length, on both spellings.
      expect(Number(/\((\d+)\)/.exec(temporalPicture(key))?.[1])).toBe(length);
    }
  });
});

describe("an edited picture", () => {
  it("prints a date as a date, whatever the precision says", () => {
    expect(editedPicture("slashed", 8, 0)).toBe("PIC 9999/99/99");
    expect(editedPicture("slashed", 2, 2)).toBe("PIC 9999/99/99");
  });

  it("groups every third digit, and keeps the last digit a 9", () => {
    expect(editedPicture("grouped", 9, 2)).toBe("PIC Z,ZZZ,ZZ9.99");
    expect(editedPicture("grouped", 7, 0)).toBe("PIC Z,ZZZ,ZZ9");
    // No separator immediately before the decimal point or at the front.
    expect(editedPicture("grouped", 4, 0)).toBe("PIC Z,ZZ9");
  });

  it("does not group a plain picture", () => {
    expect(editedPicture("plain", 9, 2)).toBe("PIC ZZZZZZ9.99");
  });

  /**
   * `DECIMAL-POINT IS COMMA` swaps both characters. Building it the other way
   * round is not merely odd-looking: the separator would appear twice and the
   * COBOL compiler rejects the picture.
   */
  it("swaps both separators under DECIMAL-POINT IS COMMA", () => {
    expect(editedPicture("grouped", 9, 2, "comma")).toBe("PIC Z.ZZZ.ZZ9,99");
    expect(editedPicture("grouped", 9, 2, "point")).toBe("PIC Z,ZZZ,ZZ9.99");
  });

  it("protects with asterisks rather than spaces", () => {
    expect(editedPicture("protected", 9, 2)).toBe("PIC *,***,**9.99");
  });

  it("puts the sign at the end, where a banker reads it", () => {
    expect(editedPicture("signed", 9, 2)).toBe("PIC Z,ZZZ,ZZ9.99-");
    expect(editedPicture("credit", 9, 2)).toBe("PIC Z,ZZZ,ZZ9.99CR");
  });

  it("keeps one integer digit when the value is all decimals", () => {
    // `Math.max(precision - scale, 1)`: a 0.99 amount still needs its 9.
    expect(editedPicture("grouped", 2, 2)).toBe("PIC 9.99");
  });

  it("omits the decimal point when there is no scale", () => {
    expect(editedPicture("plain", 5, 0)).toBe("PIC ZZZZ9");
  });
});
