import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `sync` and `native<n>`.
 *
 * `SYNCHRONIZED` is the one layout clause that moves every later field without
 * appearing in any field's own length: the compiler inserts slack bytes to
 * reach the boundary. A copybook that uses it and a reader that ignores it
 * disagree *silently*, which is what makes it worth more than its size.
 */

const PREAMBLE = `module Aligned;

record Master {
  flag: string<1>;
  counter: binary<9> sync;
  code1: string<2>;
  total: native<18> sync;
  idempotencyKey: string<36>;
}
`;

function compiled(): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`);
}

function layout() {
  return compiled().layout?.reports.find(
    (report) => report.recordName === "Master",
  );
}

describe("native binary", () => {
  /**
   * COMP-5 holds the full range the storage can express rather than truncating
   * to the picture's decimal digits, which is what an interface to something
   * outside COBOL needs.
   */
  it("emits COMP-5", () => {
    expect(compiled().cobol).toContain("PIC S9(18) COMP-5");
  });

  it("takes the same storage as COMP", () => {
    const total = layout()?.entries.find(
      (entry) => entry.path === "MASTER.TOTAL",
    );

    expect(total?.bytes).toBe(8);
  });
});

describe("synchronized alignment", () => {
  it("emits the SYNCHRONIZED clause", () => {
    const cobol = compiled().cobol ?? "";

    expect(cobol).toContain("PIC S9(9) COMP SYNCHRONIZED.");
    expect(cobol).toContain("PIC S9(18) COMP-5 SYNCHRONIZED.");
  });

  /**
   * The offsets are the whole point. A one-byte flag, then a fullword aligned
   * counter: the counter starts at 4, not at 1, and the three bytes between
   * belong to the record even though no field claims them.
   */
  it("inserts slack to reach the boundary", () => {
    const offsets = Object.fromEntries(
      (layout()?.entries ?? []).map((entry) => [entry.path, entry.offset]),
    );

    expect(offsets["MASTER.FLAG"]).toBe(0);
    // Fullword: 4-byte boundary, so three bytes of slack after the flag.
    expect(offsets["MASTER.COUNTER"]).toBe(4);
    expect(offsets["MASTER.CODE1"]).toBe(8);
    // Still a fullword. IBM's slack-byte algorithm divides by 2 for a binary
    // item of four digits or fewer and by 4 for one of five or more — there is
    // no eight for binary, which belongs to COMPUTATIONAL-2. So an eighteen
    // digit item takes eight bytes and aligns on four: two bytes of slack after
    // the code, not six.
    expect(offsets["MASTER.TOTAL"]).toBe(12);
    expect(offsets["MASTER.IDEMPOTENCY-KEY"]).toBe(20);
  });

  it("counts the slack in the record's length", () => {
    expect(layout()?.totalLength).toBe(56);
  });

  /**
   * Without the clause the same fields pack tight. This is the difference a
   * reader that ignores SYNC would not see, and every field after the first
   * aligned one would be read from the wrong place.
   */
  it("packs tight without it", () => {
    const unaligned = compile(`${PREAMBLE.replace(/ sync/g, "")}
entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`).layout?.reports.find((report) => report.recordName === "Master");

    expect(
      unaligned?.entries.find((entry) => entry.path === "MASTER.COUNTER")
        ?.offset,
    ).toBe(1);
    expect(unaligned?.totalLength).toBe(51);
  });
});

/**
 * The boundary itself, which is not the item's own width.
 *
 * IBM's slack-byte algorithm divides the bytes so far by m, where m is 2 for a
 * binary item of four digits or fewer and 4 for one of five digits or more.
 * There is no m of 8 for a binary item — that is `COMPUTATIONAL-2`. So a
 * doubleword binary occupies eight bytes and still aligns on a fullword.
 *
 * Aligning it to eight inserts slack Enterprise COBOL does not, and every field
 * after it sits four bytes further along than the dataset has it. Nothing
 * locally would show that: GnuCOBOL is not being asked where IBM puts a field.
 */
describe("the boundary a binary item aligns on", () => {
  const boundary = (digits: number): number => {
    const report = compile(`module Aligned;

record Master {
  flag: string<1>;
  amount: binary<${digits}> sync;
  idempotencyKey: string<36>;
}

entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`).layout?.reports.find((entry) => entry.recordName === "Master");

    return (
      report?.entries.find((entry) => entry.path === "MASTER.AMOUNT")?.offset ??
      -1
    );
  };

  it("is a halfword up to four digits", () => {
    expect(boundary(4)).toBe(2);
  });

  it("is a fullword from five digits", () => {
    expect(boundary(5)).toBe(4);
    expect(boundary(9)).toBe(4);
  });

  /** Eight bytes of storage, four bytes of alignment. */
  it("is still a fullword at eighteen", () => {
    expect(boundary(10)).toBe(4);
    expect(boundary(18)).toBe(4);
  });
});
