import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * `report` — COBOL's Report Writer.
 *
 * `page ... footing ...` on a file paginates, but the program still writes
 * every line itself and counts nothing. A report declares the shape and lets
 * the compiler run it: headings repeated on each page, a footing at each change
 * of a control field, and totals that accumulate without a variable to forget
 * to clear.
 *
 * That last part is the reason to have it. A hand-written subtotal reset in the
 * wrong place is a report that is wrong and still balances, which is the kind of
 * defect that survives review.
 */

const PREAMBLE = `module Statements;

record StatementLine {
  branch: string<6>;
  amount: decimal<9, 2>;
  idempotencyKey: string<36>;
}

file statementFile sequential output record StatementLine status reportStatus;
`;

const REPORT = `report branchSummary on statementFile control branch
  page 20 heading 1 firstDetail 4 lastDetail 15 {
  pageHeading {
    line 1 {
      column 1 "BRANCH SUMMARY";
      column 40 "PAGE ";
      column 46 pageNumber;
    }
  }
  detail lineDetail {
    line next {
      column 1 branch;
      column 10 amount;
    }
  }
  controlFooting branch {
    line next {
      column 1 "SUBTOTAL:";
      column 10 sum amount;
    }
  }
  controlFooting {
    line next {
      column 1 "TOTAL:";
      column 10 sum amount;
    }
  }
}`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(report: string, body = "  generate lineDetail;"): string {
  return `${PREAMBLE}
${report}

entry transaction render(line: StatementLine) {
  open statementFile;
  initiate branchSummary;
${body}
  terminate branchSummary;
  close statementFile;
  audit("RENDERED", line.idempotencyKey);
}`;
}

describe("the report description", () => {
  const result = compile(program(REPORT));

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /** The FD names the report, and the RD in the REPORT SECTION describes it. */
  it("puts the report on the file", () => {
    expect(result.cobol).toContain(
      "FD  STATEMENT-FILE-FILE REPORT IS BRANCH-SUMMARY.",
    );
    expect(result.cobol).toContain("REPORT SECTION.");
    expect(result.cobol).toContain("RD  BRANCH-SUMMARY");
  });

  /**
   * Outermost first, with FINAL in front: a change in an outer control breaks
   * every inner one, and the final total comes last of all.
   */
  it("writes the control hierarchy", () => {
    expect(result.cobol).toContain(
      "CONTROLS ARE FINAL BRANCH OF STATEMENT-LINE",
    );
  });

  it("writes the page margins", () => {
    expect(result.cobol).toContain(
      "PAGE LIMIT 20 LINES HEADING 1 FIRST DETAIL 4 LAST DETAIL 15",
    );
  });

  it("writes each group with its type", () => {
    expect(result.cobol).toContain("TYPE IS PAGE HEADING");
    expect(result.cobol).toContain("LINE-DETAIL TYPE IS DETAIL");
    expect(result.cobol).toContain(
      "TYPE IS CONTROL FOOTING BRANCH OF STATEMENT-LINE",
    );
    expect(result.cobol).toContain("TYPE IS CONTROL FOOTING FINAL");
  });

  /**
   * The same record is emitted in working storage and again inside any FD that
   * holds it, so an unqualified field name is ambiguous exactly when a report
   * is useful.
   */
  it("qualifies every field it reads", () => {
    expect(result.cobol).toContain("SOURCE BRANCH OF STATEMENT-LINE");
    expect(flowed(result.cobol)).toContain(
      flowed("SUM AMOUNT OF STATEMENT-LINE"),
    );
  });

  /**
   * A COMP-3 balance cannot be printed. The edited picture comes from the
   * field's own precision and scale rather than being counted out by hand.
   */
  it("prints an amount in its edited form", () => {
    expect(result.cobol).toContain("PIC Z,ZZZ,ZZ9.99 SOURCE AMOUNT");
  });

  it("emits the three statements", () => {
    expect(result.cobol).toContain("INITIATE BRANCH-SUMMARY");
    expect(result.cobol).toContain("GENERATE LINE-DETAIL");
    expect(result.cobol).toContain("TERMINATE BRANCH-SUMMARY");
  });
});

describe("what it will take", () => {
  const withReport = (report: string) => compile(program(report));

  it("needs a file that exists", () => {
    expect(
      ids(
        withReport(`report branchSummary on missingFile {
  detail lineDetail { line next { column 1 branch; } }
}`),
      ),
    ).toContain("BANK-FILE-002");
  });

  /** A report is printed, so its file is sequential output. */
  it("needs a file that is written", () => {
    const result = compile(`module Statements;

record StatementLine {
  branch: string<6>;
  amount: decimal<9, 2>;
  idempotencyKey: string<36>;
}

file statementFile sequential input record StatementLine status reportStatus;

report branchSummary on statementFile {
  detail lineDetail { line next { column 1 branch; } }
}

entry transaction render(line: StatementLine) {
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-007");
  });

  /** Both decide where the page ends, and COBOL rejects the FD that says so twice. */
  it("will not sit on a file that also declares a page depth", () => {
    const result = compile(`module Statements;

record StatementLine {
  branch: string<6>;
  amount: decimal<9, 2>;
  idempotencyKey: string<36>;
}

file statementFile sequential output record StatementLine page 60 status reportStatus;

report branchSummary on statementFile {
  detail lineDetail { line next { column 1 branch; } }
}

entry transaction render(line: StatementLine) {
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-007");
  });

  it("controls on a field of the record", () => {
    expect(
      ids(
        withReport(`report branchSummary on statementFile control nowhere {
  detail lineDetail { line next { column 1 branch; } }
}`),
      ),
    ).toContain("BANK-FILE-008");
  });

  it("names a control it breaks on", () => {
    expect(
      ids(
        withReport(`report branchSummary on statementFile {
  detail lineDetail { line next { column 1 branch; } }
  controlFooting branch { line next { column 1 sum amount; } }
}`),
      ),
    ).toContain("BANK-FILE-008");
  });

  /** A report with nothing to generate prints its headings and stops. */
  it("needs a detail group", () => {
    expect(
      ids(
        withReport(`report branchSummary on statementFile {
  pageHeading { line 1 { column 1 "TITLE"; } }
}`),
      ),
    ).toContain("BANK-FILE-008");
  });

  /** `sum` accumulates across the details a group covers. */
  it("only totals where something has been counted", () => {
    expect(
      ids(
        withReport(`report branchSummary on statementFile {
  pageHeading { line 1 { column 1 sum amount; } }
  detail lineDetail { line next { column 1 branch; } }
}`),
      ),
    ).toContain("BANK-FILE-008");
  });

  it("generates a detail group, not the report", () => {
    expect(
      ids(compile(program(REPORT, "  generate branchSummary;"))),
    ).toContain("BANK-FILE-008");
  });

  it("initiates the report, not a group", () => {
    const result = compile(`${PREAMBLE}
${REPORT}

entry transaction render(line: StatementLine) {
  open statementFile;
  initiate lineDetail;
  close statementFile;
  audit("RENDERED", line.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-008");
  });
});

/**
 * The description above says what was emitted. It does not say the report
 * paginates, breaks, or adds up, which is the whole reason to hand the work to
 * COBOL rather than write it — so this one is run.
 *
 * `-fassign-clause=external` is a local harness flag, not something the
 * generated program depends on: GnuCOBOL's default resolves an unquoted
 * `ASSIGN TO <name>` on a file carrying `REPORT IS` to report-section storage
 * rather than to the DD name, so the output lands in a file named after a
 * printed value. On z/OS the DD comes from the JCL and the question does not
 * arise. `zos/README.md` records it.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("paginates, breaks, and adds up", () => {
    const result = compile(
      program(
        REPORT,
        `  line.branch = "LONDON";
  line.amount = 42.50;
  generate lineDetail;
  generate lineDetail;
  line.branch = "LEEDS";
  generate lineDetail;`,
      ),
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-report-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "-fassign-clause=external",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DD_STATEMEN: join(dir, "STATEMEN") },
    });
    expect(ran.status, ran.stderr).toBe(0);

    const printed = readFileSync(join(dir, "STATEMEN"), "utf8")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    // The heading is printed once, by the compiler, at the top of the page.
    expect(printed[0]).toContain("BRANCH SUMMARY");
    expect(printed[0]).toMatch(/PAGE\s+1$/);

    // A subtotal at each change of branch, and a final total over all of them.
    // Nothing in the source adds anything up: 42.50 twice, then once.
    expect(printed).toContain("LONDON          42.50");
    expect(printed).toContain("SUBTOTAL:       85.00");
    expect(printed).toContain("LEEDS           42.50");
    expect(printed).toContain("SUBTOTAL:       42.50");
    expect(printed).toContain("TOTAL:         127.50");
  });
});
