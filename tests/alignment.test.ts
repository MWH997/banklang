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

/**
 * A `sync`ed binary inside a table, which forces slack twice over.
 *
 * Once before the item, as anywhere else. And once at the end of every
 * occurrence: IBM divides the group's size by the largest boundary anything
 * inside it demanded and pads the difference, so that occurrence two starts on
 * the same boundary as occurrence one. Without that the table is ragged and
 * every element after the first has its fields somewhere else.
 *
 * The fixture is IBM's own worked example from the Language Reference, so the
 * expected numbers are theirs rather than this compiler's:
 *
 *     01 WORK-RECORD.
 *        05 WORK-CODE  PIC X.
 *        05 COMP-TABLE OCCURS 10 TIMES.
 *            10 COMP-TYPE  PIC X.
 *           [10 SLACK      PIC XX   inserted by compiler]
 *            10 COMP-PAY   PIC S9(4)V99 COMP SYNC.
 *            10 COMP-HOURS PIC S9(3) COMP SYNC.
 *            10 COMP-NAME  PIC X(5).
 *
 * Fourteen bytes of content, largest boundary four, so each occurrence is
 * sixteen and the record is 1 + 160.
 */
describe("a table holding a synchronized item", () => {
  const report = compile(`module Work;

record CompEntry {
  compType: string<1>;
  compPay: binary<6> sync;
  compHours: binary<3> sync;
  compName: string<5>;
}

record WorkRecord {
  workCode: string<1>;
  compTable: CompEntry[10];
  idempotencyKey: string<36>;
}

entry transaction touch1(work: WorkRecord) {
  audit("TOUCHED", work.idempotencyKey);
}`).layout?.reports.find((entry) => entry.recordName === "WorkRecord");

  const entry = (path: string) =>
    report?.entries.find((item) => item.path === path);

  it("pads each occurrence to the boundary the group demands", () => {
    expect(entry("WORK-RECORD.COMP-TABLE")?.bytes).toBe(160);
  });

  it("puts the field after the table where IBM puts it", () => {
    expect(entry("WORK-RECORD.IDEMPOTENCY-KEY")?.offset).toBe(161);
  });

  /**
   * The slack inside the group is measured from the start of the record, not
   * the group, so the same group is a different length in a different place.
   * Here one byte precedes the table, so two bytes of slack reach the fullword.
   */
  it("counts the slack inside the occurrence", () => {
    const packed = compile(`module Work;

record Band {
  code: string<1>;
  pay: binary<6> sync;
  name: string<5>;
}

record Book {
  lead: string<1>;
  bands: Band[10];
  idempotencyKey: string<36>;
}

entry transaction touch1(book: Book) {
  audit("TOUCHED", book.idempotencyKey);
}`).layout?.reports.find((item) => item.recordName === "Book");

    // 1 code + 2 slack + 4 pay + 5 name = 12, already a multiple of 4.
    expect(
      packed?.entries.find((item) => item.path === "BOOK.BANDS")?.bytes,
    ).toBe(120);
    expect(packed?.totalLength).toBe(157);
  });
});
