import { describe, expect, it } from "vitest";

import { renderCopybook } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import { inspectGeneratedCopybook } from "../packages/copybook/src/index";
import { flowed } from "./helpers";

/**
 * `JUSTIFIED RIGHT` and `BLANK WHEN ZERO`, and the copybook that has to carry
 * them.
 *
 * Both are how a report column is described in the record rather than in the
 * code that fills it. The copybook matters more than either: under
 * `copybookMode: "copy"` the program's storage *is* the copybook, so a clause
 * the copybook omits is a clause the program does not have.
 */

const PREAMBLE = `module Clauses;

type GBP = currency<"GBP", 18, 2>;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function withRecord(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record StatementLine {
${body}
  idempotencyKey: string<36>;
}

entry transaction render(line: StatementLine) {
  audit("RENDERED", line.idempotencyKey);
}`);
}

describe("justified", () => {
  /**
   * COBOL moves an alphanumeric value left-aligned and pads on the right.
   * JUSTIFIED reverses that, which is how a code lands in the right of a fixed
   * column without the program counting spaces itself.
   */
  it("right-aligns an alphanumeric field", () => {
    const result = withRecord("  reference: string<12> justified;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "05  REFERENCE-FLD        PIC X(12) JUSTIFIED RIGHT.",
    );
  });

  /** A number's alignment is decided by its picture, so COBOL rejects it. */
  it("is rejected on a number", () => {
    expect(ids(withRecord("  counter: binary<9> justified;"))).toContain(
      "BANK-COPY-005",
    );
  });
});

describe("blankWhenZero", () => {
  /** A statement line with no movement should be blank, not 0.00. */
  it("blanks a zero amount", () => {
    const result = withRecord(
      '  movement: edited<GBP, "grouped"> blankWhenZero;',
    );

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(flowed("BLANK WHEN ZERO."));
  });

  it("applies to a plain amount too", () => {
    expect(
      withRecord("  balance: decimal<18, 2> blankWhenZero;").diagnostics,
    ).toEqual([]);
  });

  /** There has to be a number to be zero. */
  it("is rejected on text", () => {
    expect(ids(withRecord("  label: string<8> blankWhenZero;"))).toContain(
      "BANK-COPY-005",
    );
  });
});

describe("clause order", () => {
  /**
   * The flag clauses are matched in a loop, so their order does not matter. A
   * language that accepted only one order would be a trap and nothing else.
   */
  it("does not matter", () => {
    const one = withRecord("  counter: binary<9> sync blankWhenZero;");
    const other = withRecord("  counter: binary<9> blankWhenZero sync;");

    expect(one.diagnostics).toEqual([]);
    expect(other.diagnostics).toEqual([]);
    expect(one.cobol).toBe(other.cobol);
  });
});

/**
 * The copybook is the record's own declaration, not a summary of it.
 *
 * It was a flat list of pictures, which dropped `REDEFINES`, `OCCURS`,
 * `SYNCHRONIZED`, the nested groups, and the 88-levels. Under
 * `copybookMode: "copy"` the program's storage is the copybook, so those
 * omissions were not cosmetic: a redefining field took storage of its own and
 * pushed every later field along, a table collapsed to a single element, and an
 * aligned field lost the slack bytes the layout report accounts for.
 */
describe("the copybook carries every clause", () => {
  const VARIANT = `  code: string<4>;
  counter: binary<9> sync;
  personal: string<20>;
  company: string<20> redefines personal;
  rows: string<6>[3];
  reference: string<12> justified;`;

  function copybook(): string {
    const result = withRecord(VARIANT);
    if (!result.program) {
      throw new Error("Expected the record to compile.");
    }
    return renderCopybook(result.program.records[0]!);
  }

  it("keeps REDEFINES", () => {
    expect(copybook()).toContain("05  COMPANY REDEFINES PERSONAL PIC X(20).");
  });

  it("keeps OCCURS and its index", () => {
    const text = copybook();

    expect(text).toContain("OCCURS 3 TIMES");
    expect(text).toContain("INDEXED BY ROWS-IDX");
  });

  it("keeps SYNCHRONIZED and JUSTIFIED", () => {
    const text = copybook();

    expect(text).toContain("PIC S9(9) COMP SYNCHRONIZED.");
    expect(text).toContain("PIC X(12) JUSTIFIED RIGHT.");
  });

  it("keeps BLANK WHEN ZERO", () => {
    const result = withRecord("  movement: decimal<18, 2> blankWhenZero;");
    if (!result.program) {
      throw new Error("Expected the record to compile.");
    }

    expect(flowed(renderCopybook(result.program.records[0]!))).toContain(
      flowed("BLANK WHEN ZERO."),
    );
  });

  /**
   * The two must agree, because one is what the program compiles against and
   * the other is what anyone reading the layout believes.
   */
  it("agrees with the compiler's own layout report", () => {
    const result = withRecord(VARIANT);
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "StatementLine",
    );
    const inspected = inspectGeneratedCopybook(copybook());

    expect(inspected.totalLength).toBe(report?.totalLength);
    for (const entry of report?.entries ?? []) {
      const name = entry.path.split(".").pop();
      const field = inspected.fields.find((one) => one.cobolName === name);

      expect(field?.offset, `${name} offset`).toBe(entry.offset);
      expect(field?.length, `${name} length`).toBe(entry.length);
    }
  });

  /** An 88-level is not storage, so it must not shift the fields after it. */
  it("does not let an 88-level move anything", () => {
    const result = compile(`${PREAMBLE}
enum Status { OPEN, CLOSED }

record StatementLine {
  status: Status;
  trailing: string<8>;
  idempotencyKey: string<36>;
}

entry transaction render(line: StatementLine) {
  audit("RENDERED", line.idempotencyKey);
}`);
    if (!result.program) {
      throw new Error("Expected the record to compile.");
    }
    const inspected = inspectGeneratedCopybook(
      renderCopybook(result.program.records[0]!),
    );

    expect(inspected.fields.map((field) => field.cobolName)).toEqual([
      "STATUS-FLD",
      "TRAILING-FLD",
      "IDEMPOTENCY-KEY",
    ]);
    expect(
      inspected.fields.find((field) => field.cobolName === "TRAILING-FLD")
        ?.offset,
    ).toBe(6);
  });
});

/**
 * A transaction's record parameters live in working storage, one COBOL group
 * per record *type*. Two parameters of the same type were therefore two names
 * for one piece of storage: `a.value = 1; b.value = 2;` compiled to two writes
 * of the same field, and the program silently disagreed with its source.
 */
describe("two record parameters of one type", () => {
  const source = (parameters: string) => `module Alias;

record Rec {
  value: decimal<9, 0>;
  idempotencyKey: string<36>;
}

record Other {
  otherValue: decimal<9, 0>;
}

entry transaction post(${parameters}) {
  audit("DONE", a.idempotencyKey);
}`;

  it("is reported", () => {
    const result = compile(source("a: Rec, b: Rec"));

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-022",
    );
  });

  it("leaves different types alone", () => {
    expect(compile(source("a: Rec, b: Other")).diagnostics).toEqual([]);
  });

  /**
   * A function's record parameters are LINKAGE cells the caller rebinds, so
   * each addresses its own argument and two of a type are fine.
   */
  it("does not apply to a function", () => {
    const result = compile(`module Alias;

record Rec {
  value: decimal<9, 0>;
  idempotencyKey: string<36>;
}

function total(a: Rec, b: Rec): decimal<9, 0> {
  return a.value + b.value;
}

entry transaction post(one: Rec) {
  audit("DONE", one.idempotencyKey);
}`);

    expect(result.diagnostics.map((entry) => entry.id)).not.toContain(
      "BANK-TYPE-022",
    );
  });
});
