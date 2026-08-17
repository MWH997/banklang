import { describe, expect, it } from "vitest";

import { compareExactBytes } from "../packages/verifier/src/index";

/**
 * The comparison behind "the same input always produces byte-identical output".
 *
 * Twenty-three lines, one function, and it scored **0%** in the tools mutation
 * lane with all twelve of its mutants uncovered, because the only suite that
 * exercises it is `tests/determinism.test.ts`, which the lane excludes for
 * spawning a build. So the check that decides whether two compilations agree
 * was itself unchecked, and any of the twelve ways of getting it wrong would
 * have reported two different outputs as identical.
 *
 * The differences are placed at the first byte, in the middle and at the last,
 * because a comparison that stops early or starts late passes a test that only
 * ever differs in one position.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("comparing two compilations byte for byte", () => {
  it("calls identical bytes identical, and counts them", () => {
    const result = compareExactBytes(bytes(1, 2, 3), bytes(1, 2, 3));
    expect(result.identical).toBe(true);
    expect(result.leftBytes).toBe(3);
    expect(result.rightBytes).toBe(3);
  });

  it("calls two empty outputs identical", () => {
    expect(compareExactBytes(bytes(), bytes())).toEqual({
      identical: true,
      leftBytes: 0,
      rightBytes: 0,
    });
  });

  it("refuses outputs of different length", () => {
    // A prefix is the case that matters: everything compared so far agreed.
    expect(compareExactBytes(bytes(1, 2), bytes(1, 2, 3)).identical).toBe(
      false,
    );
    expect(compareExactBytes(bytes(1, 2, 3), bytes(1, 2)).identical).toBe(
      false,
    );
    expect(compareExactBytes(bytes(), bytes(0)).identical).toBe(false);
  });

  it("reports each side's size even when they disagree", () => {
    const result = compareExactBytes(bytes(1, 2), bytes(1, 2, 3, 4, 5));
    expect(result.leftBytes).toBe(2);
    expect(result.rightBytes).toBe(5);
  });

  it("finds a difference wherever it is", () => {
    const positions: [string, Uint8Array][] = [
      ["first", bytes(9, 2, 3, 4)],
      ["middle", bytes(1, 9, 3, 4)],
      ["last", bytes(1, 2, 3, 9)],
    ];
    for (const [where, right] of positions) {
      expect(
        compareExactBytes(bytes(1, 2, 3, 4), right).identical,
        `a difference in the ${where} byte was not noticed`,
      ).toBe(false);
    }
  });

  it("does not call outputs identical because some bytes match", () => {
    // `every`, not `some`: three of four agreeing is not agreement.
    expect(
      compareExactBytes(bytes(1, 2, 3, 4), bytes(1, 2, 3, 5)).identical,
    ).toBe(false);
  });

  it("does not treat a zero byte as absent", () => {
    // `left.every` skips holes in sparse arrays, and 0 is falsy, so neither is a
    // reason to consider two outputs equal.
    expect(compareExactBytes(bytes(0, 0), bytes(0, 0)).identical).toBe(true);
    expect(compareExactBytes(bytes(0, 0), bytes(0, 1)).identical).toBe(false);
  });
});
