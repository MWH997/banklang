import { describe, expect, it } from "vitest";

import { renderCopybook } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import { inspectGeneratedCopybook } from "../packages/copybook/src/index";

/**
 * `national<n>` — `PIC N(n) USAGE NATIONAL`.
 *
 * This is a storage declaration, and the reason to have it is arithmetic: a
 * national character is two bytes, so a record holding one does not line up if
 * the field is counted as `n`. Every field after it would sit at the wrong
 * offset, which is a copybook that silently disagrees with the mainframe's.
 *
 * It is deliberately not a text type. GnuCOBOL calls its own handling of
 * `USAGE NATIONAL` unfinished and implements neither `NATIONAL-OF` nor
 * `DISPLAY-OF`, so a conversion between an alphanumeric and a national is the
 * one thing this compiler will not emit — the bytes it produced would differ
 * between GnuCOBOL and Enterprise COBOL.
 *
 * It is also the one place the compiler emits a layout its own validator reads
 * differently, which is why every national field carries a warning. See the
 * measurement at the bottom of this file.
 */

const PREAMBLE = `module National;
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/** Every national field warns, so the interesting question is what else did. */
function errors(result: {
  diagnostics: { id: string; severity: string }[];
}): string[] {
  return result.diagnostics
    .filter((entry) => entry.severity !== "warning")
    .map((entry) => entry.id);
}

function withRecord(body: string, statements = ""): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
record CustomerName {
${body}
  idempotencyKey: string<36>;
}

entry transaction store(name: CustomerName) {
${statements}
  audit("STORED", name.idempotencyKey);
}`);
}

describe("declaration", () => {
  it("emits PIC N with USAGE NATIONAL", () => {
    const result = withRecord("  given: national<20>;");

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("PIC N(20) USAGE NATIONAL");
  });

  it("compiles beside an ordinary alphanumeric", () => {
    const result = withRecord(`  given: national<20>;
  branch: string<4>;`);

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("PIC N(20) USAGE NATIONAL");
    expect(result.cobol).toContain("PIC X(4)");
  });

  it("rejects a length of zero", () => {
    expect(ids(withRecord("  given: national<0>;"))).toContain("BANK-TYPE-002");
  });
});

describe("storage", () => {
  /** Two bytes to a character. This is the whole point of the type. */
  it("takes two bytes per character", () => {
    const result = withRecord("  given: national<20>;");
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "CustomerName",
    );
    const field = report?.entries.find((entry) => entry.path.endsWith("GIVEN"));

    expect(field?.length).toBe(40);
  });

  /** A field after a national must not sit two bytes per character too early. */
  it("moves the fields after it along", () => {
    const result = withRecord(`  given: national<20>;
  branch: string<4>;`);
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "CustomerName",
    );

    expect(
      report?.entries.find((entry) => entry.path.endsWith("BRANCH"))?.offset,
    ).toBe(40);
  });

  it("reports NATIONAL as the usage", () => {
    const result = withRecord("  given: national<20>;");
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "CustomerName",
    );

    expect(
      report?.entries.find((entry) => entry.path.endsWith("GIVEN"))?.usage,
    ).toBe("NATIONAL");
  });
});

/**
 * Under `copybookMode: "copy"` the program's storage *is* the copybook, so a
 * width the copybook reads differently from the compiler is a program whose
 * record does not match its own layout report.
 */
describe("the copybook", () => {
  const RECORD = `  given: national<20>;
  branch: string<4>;`;

  function copybook(): string {
    const result = withRecord(RECORD);
    if (!result.program) {
      throw new Error("Expected the record to compile.");
    }
    return renderCopybook(result.program.records[0]);
  }

  it("carries the picture", () => {
    expect(copybook()).toContain("PIC N(20) USAGE NATIONAL.");
  });

  it("agrees with the compiler's own layout report", () => {
    const result = withRecord(RECORD);
    const report = result.layout?.reports.find(
      (entry) => entry.recordName === "CustomerName",
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
});

/**
 * The bytes differ, so the types differ. A compiler that quietly moved one into
 * the other would be emitting a conversion neither it nor GnuCOBOL can perform.
 */
describe("it does not mix with an alphanumeric", () => {
  const assign = (statements: string) =>
    compile(`${PREAMBLE}
record CustomerName {
  given: national<20>;
  branch: string<20>;
  idempotencyKey: string<36>;
}

entry transaction store(name: CustomerName) {
${statements}
  audit("STORED", name.idempotencyKey);
}`);

  it("rejects a literal into a national field", () => {
    expect(ids(assign('  name.given = "SMITH";'))).toContain("BANK-TYPE-003");
  });

  it("rejects an alphanumeric field into a national field", () => {
    expect(ids(assign("  name.given = name.branch;"))).toContain(
      "BANK-TYPE-003",
    );
  });

  it("rejects a national field into an alphanumeric field", () => {
    expect(ids(assign("  name.branch = name.given;"))).toContain(
      "BANK-TYPE-003",
    );
  });

  /** Same characters, same bytes: this is the move that is well defined. */
  it("allows a national into a national of the same length", () => {
    const result = compile(`${PREAMBLE}
record CustomerName {
  given: national<20>;
  family: national<20>;
  idempotencyKey: string<36>;
}

entry transaction store(name: CustomerName) {
  name.family = name.given;
  audit("STORED", name.idempotencyKey);
}`);

    expect(errors(result)).toEqual([]);
    expect(result.cobol).toContain("MOVE GIVEN OF CUSTOMER-NAME");
  });

  /** The names have to say which is which, or the error reads as nonsense. */
  it("names both sides in the message", () => {
    const message = assign('  name.given = "SMITH";').diagnostics.find(
      (entry) => entry.id === "BANK-TYPE-003",
    )?.message;

    expect(message).toContain("national<20>");
  });
});

/**
 * The layout this compiler reports is Enterprise COBOL's, because that is the
 * backend it targets. GnuCOBOL 3.2.0 — the compiler every other feature in this
 * repository is validated against — reads it differently:
 *
 * ```cobol
 * 01  H.
 *     05  A2 PIC N(4) USAGE NATIONAL.
 *     05  C2 PIC X(4).
 * ```
 *
 * `C2` starts at byte 17 there and at byte 9 on z/OS: four bytes to a national
 * character inside a group rather than two. Standalone at the 01 level GnuCOBOL
 * allocates two, which makes it an inconsistency in GnuCOBOL rather than a rule,
 * and it warns on every such line that its handling is unfinished.
 *
 * Byte-exact layout is the only thing this type promises, so a national field is
 * the one thing the compiler emits that its own local validation does not cover.
 * Saying so is the point of the warning: without it the evidence would imply a
 * check that did not happen.
 */
describe("the layout is not locally verifiable", () => {
  it("warns on every national field", () => {
    const warnings = withRecord(`  given: national<20>;
  family: national<20>;`).diagnostics.filter(
      (entry) => entry.id === "BANK-TYPE-024",
    );

    expect(warnings).toHaveLength(2);
    expect(warnings.every((entry) => entry.severity === "warning")).toBe(true);
  });

  it("says which compiler disagrees and by how much", () => {
    const warning = withRecord("  given: national<20>;").diagnostics.find(
      (entry) => entry.id === "BANK-TYPE-024",
    );

    expect(warning?.hint).toContain("GnuCOBOL");
    expect(warning?.hint).toContain("four");
  });

  it("leaves an ordinary alphanumeric record alone", () => {
    expect(ids(withRecord("  branch: string<4>;"))).not.toContain(
      "BANK-TYPE-024",
    );
  });
});
