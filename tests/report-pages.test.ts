import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `LINAGE`, `AFTER ADVANCING`, and `AT END-OF-PAGE`.
 *
 * This is how a COBOL report paginates. Without it a statement run is one
 * unbroken column of text: the program has no way to say where a page ends, so
 * it has no place to put a heading or a carried-forward total.
 */

const PREAMBLE = `module Report;

type GBP = currency<"GBP", 18, 2>;

record ReportLine {
  narrative: string<40>;
  amount: edited<GBP, "grouped"> blankWhenZero;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(files: string, body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
${files}

entry transaction render(line: ReportLine) {
  open statementReport;
${body}
  close statementReport;
  audit("RENDERED", line.idempotencyKey);
}`);
}

const REPORT = `file statementReport sequential output record ReportLine
  page 60 footing 55 top 3 bottom 3 status reportStatus;`;

const PLAIN = `file statementReport sequential output record ReportLine status reportStatus;`;

describe("page depth", () => {
  it("emits LINAGE on the FD", () => {
    const result = program(REPORT, "");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("LINAGE IS 60 LINES");
    expect(result.cobol).toContain("WITH FOOTING AT 55");
    expect(result.cobol).toContain("LINES AT TOP 3");
    expect(result.cobol).toContain("LINES AT BOTTOM 3");
  });

  /** The margins are optional; a page depth alone is a page. */
  it("emits only what was declared", () => {
    const result = program(
      "file statementReport sequential output record ReportLine page 60 status reportStatus;",
      "",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("LINAGE IS 60 LINES");
    expect(result.cobol).not.toContain("WITH FOOTING");
  });

  it("leaves an ordinary file alone", () => {
    expect(program(PLAIN, "").cobol).not.toContain("LINAGE");
  });

  /** A page depth describes a print file, which is what COBOL allows it on. */
  it("is rejected on a file that is read", () => {
    const result = compile(`${PREAMBLE}
file statementReport sequential input record ReportLine page 60 status reportStatus;

entry transaction render(line: ReportLine) {
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-007");
  });

  /** Past the end of the page, the footing would never be reached. */
  it("rejects a footing beyond the page", () => {
    const result = compile(`${PREAMBLE}
file statementReport sequential output record ReportLine page 60 footing 70 status reportStatus;

entry transaction render(line: ReportLine) {
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-007");
  });
});

describe("advancing", () => {
  /** A report line is written after spacing, not on top of the last one. */
  it("spaces before the line", () => {
    const result = program(
      REPORT,
      "  write statementReport from line advancing 1;",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "WRITE STATEMENT-REPORT-RECORD AFTER ADVANCING 1 LINES",
    );
  });

  it("starts a new page", () => {
    const result = program(
      REPORT,
      "  write statementReport from line advancing page;",
    );

    expect(result.cobol).toContain(
      "WRITE STATEMENT-REPORT-RECORD AFTER ADVANCING PAGE",
    );
  });

  it("is optional", () => {
    const result = program(REPORT, "  write statementReport from line;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("WRITE STATEMENT-REPORT-RECORD\n");
  });

  /** A keyed file has records, not lines to space. */
  it("is rejected on an indexed file", () => {
    const result = compile(`${PREAMBLE}
file accountMaster indexed output record ReportLine key narrative status masterStatus;

entry transaction render(line: ReportLine) {
  open accountMaster;
  write accountMaster from line advancing 1;
  close accountMaster;
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-007");
  });
});

describe("on page", () => {
  /**
   * COBOL signals it when the write reaches the footing line, which is where a
   * report writes its totals and the next page's heading.
   */
  it("becomes AT END-OF-PAGE", () => {
    const result = program(
      REPORT,
      `  write statementReport from line advancing 1 on page {
    write statementReport from line advancing page;
  };`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("AT END-OF-PAGE");
    expect(result.cobol).toContain("END-WRITE");
  });

  /** Without a declared depth there is no page for a write to reach the end of. */
  it("needs a page depth", () => {
    const result = program(
      PLAIN,
      `  write statementReport from line on page {
    write statementReport from line;
  };`,
    );

    expect(ids(result)).toContain("BANK-FILE-007");
  });

  /** The body is ordinary code, so the banking checks have to see into it. */
  it("is not a blind spot for the analyzer", () => {
    const result = compile(`${PREAMBLE}
${REPORT}

entry transaction render(line: ReportLine) {
  open statementReport;
  write statementReport from line advancing 1 on page {
    debit("SUSPENSE", 1.00);
  };
  close statementReport;
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-LED-001");
  });
});
