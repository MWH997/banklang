import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { unpadded } from "./helpers";

/**
 * `redefines` and `depending on` — the two clauses a real copybook is built on.
 *
 * The variant record is how a legacy layout says "this area means different
 * things depending on the record type", and `OCCURS ... DEPENDING ON` is what
 * makes a variable-length record variable. A compiler that cannot express
 * either cannot describe most of an existing estate's data.
 */

const PREAMBLE = `module Variant;

record Entry {
  entryKind: string<6>;
  amount: decimal<18, 2>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function withRecord(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record LegacyRecord {
  idempotencyKey: string<36>;
${body}
}

entry transaction load1(legacy: LegacyRecord) {
  audit("LOADED", legacy.idempotencyKey);
}`);
}

// The idempotency key comes first because a table whose length depends on a
// count has to be last in its record: everything after it is variably located.
const VARIANT = `  recordType: string<2>;
  personalName: string<40>;
  companyName: string<40> redefines personalName;
  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;`;

describe("redefines", () => {
  it("emits the REDEFINES clause on the field", () => {
    const result = withRecord(VARIANT);

    expect(result.diagnostics).toEqual([]);
    expect(unpadded(result.cobol)).toContain(
      "05 COMPANY-NAME REDEFINES PERSONAL-NAME PIC X(40).",
    );
  });

  /**
   * A redefining field is a second reading of storage that already exists, so
   * it reports the offset of what it redefines and adds nothing to the record.
   * Advancing past it would push every later field along by forty bytes.
   */
  it("shares the offset and costs no storage", () => {
    const layout = withRecord(VARIANT).layout?.reports.find(
      (report) => report.recordName === "LegacyRecord",
    );
    const offsetOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(offsetOf("LEGACY-RECORD.PERSONAL-NAME")).toBe(38);
    expect(offsetOf("LEGACY-RECORD.COMPANY-NAME")).toBe(38);
    expect(offsetOf("LEGACY-RECORD.LINE-COUNT")).toBe(78);
  });

  /**
   * COBOL lets the redefinition be longer, and then the area is as long as the
   * longest reading of it. Refusing this rejected layouts a real estate has.
   */
  it("accepts a longer redefinition and extends the record by the overhang", () => {
    const result = withRecord(
      VARIANT.replace("companyName: string<40>", "companyName: string<50>"),
    );
    const layout = result.layout?.reports.find(
      (report) => report.recordName === "LegacyRecord",
    );
    const offsetOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(result.diagnostics).toEqual([]);
    expect(offsetOf("LEGACY-RECORD.COMPANY-NAME")).toBe(38);
    // Ten bytes past the forty personalName occupies, so the count that used to
    // sit at 78 sits at 88 and every field after it moves with it.
    expect(offsetOf("LEGACY-RECORD.LINE-COUNT")).toBe(88);
  });

  it("rejects redefining a field declared later", () => {
    const result = withRecord(
      VARIANT.replace("redefines personalName", "redefines idempotencyKey"),
    );

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  /**
   * COBOL requires the redefinitions of an area to follow its description with
   * nothing in between that takes storage of its own — "REDEFINES must follow
   * the original definition", as GnuCOBOL puts it, and the Language Reference
   * says the same. The compiler used to accept it and lay the redefinition out
   * at the intervening field's offset, so the emitted program did not compile
   * and the copybook described the alternate reading in the wrong place.
   */
  it("rejects a redefines separated from what it redefines", () => {
    const result = withRecord(`  personalName: string<40>;
  branch: string<3>;
  companyName: string<40> redefines personalName;`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  /** Naming the redefinition before it is how a third reading is written. */
  it("accepts a redefinition of the redefinition", () => {
    const result = withRecord(`  personalName: string<40>;
  companyName: string<40> redefines personalName;
  tradingName: string<40> redefines companyName;`);
    const layout = result.layout?.reports.find(
      (report) => report.recordName === "LegacyRecord",
    );
    const offsetOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(result.diagnostics).toEqual([]);
    expect(offsetOf("LEGACY-RECORD.TRADING-NAME")).toBe(36);
  });

  /**
   * A table is a repetition of an area rather than one area, so there is no
   * single run of bytes for a redefinition to name. COBOL forbids OCCURS on a
   * redefined item outright.
   */
  it("rejects redefining a table", () => {
    const result = withRecord(`  rows: Entry[3];
  flat: string<72> redefines rows;`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  /**
   * Neither end of a redefinition may vary in length — the area's size has to
   * be known to lay out what follows. The compiler used to emit
   * `REDEFINES ... OCCURS 1 TO n DEPENDING ON`, which GnuCOBOL rejects as
   * "cannot be variable length" and no COBOL accepts.
   */
  it("rejects a redefines that also depends on a count", () => {
    const result = withRecord(`  lineCount: binary<4>;
  area: string<72>;
  rows: Entry[3] redefines area depending on lineCount;`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });
});

describe("occurs depending on", () => {
  /**
   * The fixed bound stays as the maximum, because the storage still has to be
   * reserved; the clause says how much of it this record uses.
   */
  it("emits OCCURS 1 TO n DEPENDING ON", () => {
    const result = withRecord(VARIANT);

    expect(result.diagnostics).toEqual([]);
    expect(unpadded(result.cobol)).toContain(
      "05 LINES-FLD OCCURS 1 TO 100 TIMES DEPENDING ON LINE-COUNT",
    );
  });

  /** COBOL reads the count to decide the length, so it has to come first. */
  it("rejects a count declared after the table", () => {
    const result = withRecord(`  lineCount2: binary<4>;
  lines: Entry[100] depending on lateCount;
  lateCount: binary<4>;`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  it("rejects a count that is not a whole number", () => {
    const result = withRecord(
      VARIANT.replace("lineCount: binary<4>;", "lineCount: string<4>;"),
    );

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  it("rejects a depending clause on something that is not a table", () => {
    const result = withRecord(
      VARIANT.replace(
        "lines: Entry[100] depending on lineCount;",
        "lines: string<4> depending on lineCount;",
      ),
    );

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  /**
   * A field after a varying table is *variably located*: its position is the
   * start of the table plus the count times the entry, so it moves every time
   * the count does. The copybook can only state the offset it has when the
   * table is full — an offset no other record has — and the layout report said
   * exactly that, with nothing to say it was one value of many.
   *
   * IBM calls this complex ODO and permits it. GnuCOBOL refuses it outright, so
   * a program built this way could not be executed locally either.
   */
  it("rejects a field declared after the varying table", () => {
    const result = compile(`${PREAMBLE}
record LegacyRecord {
  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;
  idempotencyKey: string<36>;
}

entry transaction load1(legacy: LegacyRecord) {
  audit("LOADED", legacy.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  /** A redefinition of the table's own storage takes no new position. */
  it("accepts the varying table being the last field that takes storage", () => {
    const result = withRecord(VARIANT);

    expect(result.diagnostics).toEqual([]);
  });
});

/**
 * Where a redefining field is reported.
 *
 * It re-reads the bytes the field it redefines occupies, so it starts where
 * that field starts. The layout report put it at the running offset — after the
 * storage it shares — so a copybook checked against a real dataset had the
 * redefinition pointing at the field beyond it.
 */
describe("the offset a redefines is reported at", () => {
  it("is the start of what it redefines, not the byte after it", () => {
    const result = compile(`module Variant;

record Master {
  a: string<6>;
  b: string<4> redefines a;
  tail: string<4>;
  idempotencyKey: string<36>;
}

entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`);

    const layout = result.layout?.reports.find(
      (entry) => entry.recordName === "Master",
    );
    const at = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(at("MASTER.A")).toBe(0);
    expect(at("MASTER.B")).toBe(0);
    expect(at("MASTER.TAIL")).toBe(6);
  });

  /**
   * The same rule one level down.
   *
   * The layout walker carried the anchor for a record's own fields and not for
   * the fields of a group inside it, so a redefines nested in a group was
   * reported forty bytes past the storage it aliases while its neighbours were
   * right — the shape that gets read as a plausible layout rather than a bug.
   */
  it("is the start of what it redefines when the redefines is inside a group", () => {
    const result = compile(`module Variant;

record Names {
  personalName: string<40>;
  companyName: string<40> redefines personalName;
  branch: string<3>;
}

record Master {
  head: string<2>;
  names: Names;
  idempotencyKey: string<36>;
}

entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`);

    const layout = result.layout?.reports.find(
      (entry) => entry.recordName === "Master",
    );
    const at = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(at("MASTER.NAMES.PERSONAL-NAME")).toBe(2);
    expect(at("MASTER.NAMES.COMPANY-NAME")).toBe(2);
    expect(at("MASTER.NAMES.BRANCH")).toBe(42);
    expect(layout?.totalLength).toBe(81);
  });
});
