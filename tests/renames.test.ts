import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `RENAMES`, the level-66 regrouping.
 *
 * A legacy copybook splits a date into year, month, and day and then wants to
 * move all three at once. `RENAMES` gives that run of fields a second name
 * without a second copy of the storage — which is what distinguishes it from
 * `redefines`, which is a new *reading* of the same bytes.
 */

const PREAMBLE = `module Legacy;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function withRecord(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record LegacyDate {
  yearPart: zoned<4, 0>;
  monthPart: zoned<2, 0>;
  dayPart: zoned<2, 0>;
  branchId: string<8>;
  idempotencyKey: string<36>;
${body}
}

entry transaction load(legacy: LegacyDate) {
  audit("LOADED", legacy.idempotencyKey);
}`);
}

const WHOLE = "  wholeDate renames yearPart through dayPart;";

describe("declaring one", () => {
  /** COBOL requires the 66 to follow every entry it names. */
  it("emits a level 66 after the fields", () => {
    const cobol = withRecord(WHOLE).cobol ?? "";

    expect(withRecord(WHOLE).diagnostics).toEqual([]);
    expect(cobol).toContain(
      "66  WHOLE-DATE RENAMES YEAR-PART OF LEGACY-DATE THRU DAY-PART OF LEGACY-DATE.",
    );
    expect(cobol.indexOf("05  DAY-PART")).toBeLessThan(
      cobol.indexOf("66  WHOLE-DATE"),
    );
  });

  /**
   * Both ends are qualified, because the same record is emitted in working
   * storage and again inside every FD that holds it: an unqualified field name
   * is ambiguous across them, and GnuCOBOL says so.
   */
  it("qualifies both ends by the group", () => {
    const result = compile(`${PREAMBLE}
record LegacyDate {
  yearPart: zoned<4, 0>;
  dayPart: zoned<2, 0>;
  idempotencyKey: string<36>;

  wholeDate renames yearPart through dayPart;
}

file legacyFeed sequential input record LegacyDate status feedStatus;

entry transaction load(legacy: LegacyDate) {
  audit("LOADED", legacy.idempotencyKey);
}`);

    expect(result.cobol).toContain("RENAMES YEAR-PART OF LEGACY-FEED-RECORD");
    expect(result.cobol).toContain("RENAMES YEAR-PART OF LEGACY-DATE");
  });

  /** It is a second name for storage already there, so it adds none. */
  it("costs no storage", () => {
    const withIt = withRecord(WHOLE).layout?.reports[0];
    const without = withRecord("").layout?.reports[0];

    expect(withIt?.totalLength).toBe(without?.totalLength);
  });
});

describe("using one", () => {
  /**
   * A group move treats the run as alphanumeric whatever the pictures inside
   * it are, so that is the type the name carries.
   */
  it("reads as the alphanumeric span it covers", () => {
    const result = compile(`${PREAMBLE}
record LegacyDate {
  yearPart: zoned<4, 0>;
  monthPart: zoned<2, 0>;
  dayPart: zoned<2, 0>;
  idempotencyKey: string<36>;

  wholeDate renames yearPart through dayPart;
}

record Archive {
  archivedDate: string<11>;
  idempotencyKey: string<36>;
}

entry transaction load(legacy: LegacyDate, archive: Archive) {
  archive.archivedDate = legacy.wholeDate;
  audit("LOADED", legacy.idempotencyKey);
}`);

    // Zoned decimal is a byte per digit plus one for the separate sign: 5+3+3.
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE WHOLE-DATE OF LEGACY-DATE TO ARCHIVED-DATE OF ARCHIVE",
    );
  });

  /** Mapping it as well would move the same bytes a second time. */
  it("is left out of a read's field mapping", () => {
    const result = compile(`${PREAMBLE}
record LegacyDate {
  yearPart: zoned<4, 0>;
  dayPart: zoned<2, 0>;
  idempotencyKey: string<36>;

  wholeDate renames yearPart through dayPart;
}

file legacyFeed sequential input record LegacyDate status feedStatus;

entry transaction load(legacy: LegacyDate) {
  open legacyFeed;
  read legacyFeed into legacy;
  close legacyFeed;
  audit("LOADED", legacy.idempotencyKey);
}`);

    expect(result.cobol).not.toContain("MOVE WHOLE-DATE OF LEGACY-FEED-RECORD");
  });
});

describe("what it may name", () => {
  it("rejects a field that is not there", () => {
    expect(
      ids(withRecord("  wholeDate renames nowhere through dayPart;")),
    ).toContain("BANK-COPY-004");
  });

  it("rejects a run that runs backwards", () => {
    expect(
      ids(withRecord("  wholeDate renames dayPart through yearPart;")),
    ).toContain("BANK-COPY-004");
  });

  /**
   * A 66 has no length of its own, so the run it names has to be fixed. COBOL
   * forbids renaming across a variable-occurrence item for the same reason.
   */
  it("rejects a run whose length depends on a count", () => {
    const result = compile(`${PREAMBLE}
record Entry {
  amount: decimal<9, 2>;
}

record LegacyDate {
  lineCount: binary<4>;
  lines: Entry[10] depending on lineCount;
  trailer: string<4>;
  idempotencyKey: string<36>;

  everything renames lineCount through trailer;
}

entry transaction load(legacy: LegacyDate) {
  audit("LOADED", legacy.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });
});
