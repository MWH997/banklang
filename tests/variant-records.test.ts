import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

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
${body}
  idempotencyKey: string<36>;
}

entry transaction load1(legacy: LegacyRecord) {
  audit("LOADED", legacy.idempotencyKey);
}`);
}

const VARIANT = `  recordType: string<2>;
  personalName: string<40>;
  companyName: string<40> redefines personalName;
  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;`;

describe("redefines", () => {
  it("emits the REDEFINES clause on the field", () => {
    const result = withRecord(VARIANT);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "05  COMPANY-NAME REDEFINES PERSONAL-NAME PIC X(40).",
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

    expect(offsetOf("LEGACY-RECORD.PERSONAL-NAME")).toBe(2);
    expect(offsetOf("LEGACY-RECORD.COMPANY-NAME")).toBe(2);
    expect(offsetOf("LEGACY-RECORD.LINE-COUNT")).toBe(42);
  });

  /** No storage of its own means a longer one reads past the end. */
  it("rejects a redefining field longer than what it redefines", () => {
    const result = withRecord(
      VARIANT.replace("companyName: string<40>", "companyName: string<50>"),
    );

    expect(ids(result)).toContain("BANK-COPY-004");
  });

  it("rejects redefining a field declared later", () => {
    const result = withRecord(
      VARIANT.replace("redefines personalName", "redefines idempotencyKey"),
    );

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
    expect(result.cobol).toContain(
      "05  LINES-FLD OCCURS 1 TO 100 TIMES DEPENDING ON LINE-COUNT",
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
});
