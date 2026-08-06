import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol } from "./helpers";

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

  /**
   * Report Writer sizes the accumulator from the picture on the SUM entry, not
   * from the field being totalled, whenever that field lives outside the REPORT
   * SECTION — which here it always does. Giving a total the row's own picture
   * therefore sizes it for a single row, and the high-order digit of every
   * subtotal is dropped without a diagnostic, a return code, or a line that
   * fails to balance.
   */
  it("gives a total more digits than the row it totals", () => {
    expect(result.cobol).toContain("PIC Z,ZZZ,ZZ9.99 SOURCE AMOUNT");
    expect(flowed(result.cobol)).toContain(
      flowed("PIC Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99 SUM AMOUNT OF STATEMENT-LINE"),
    );
  });

  it("emits the three statements", () => {
    expect(result.cobol).toContain("INITIATE BRANCH-SUMMARY");
    expect(result.cobol).toContain("GENERATE LINE-DETAIL");
    expect(result.cobol).toContain("TERMINATE BRANCH-SUMMARY");
  });
});

/**
 * Report Writer is not part of Enterprise COBOL.
 *
 * The Language Reference says so plainly: the Report Writer module of the
 * standard "is supported with the optional IBM COBOL Report Writer Precompiler
 * and Libraries (5798-DYR)", and it lists `RD`, `PAGE LIMIT`, `CONTROL
 * HEADING`, `PAGE FOOTING`, `SUM`, `COLUMN` and report description entries as
 * features that precompiler supplies. A REPORT SECTION handed straight to
 * IGYCRCTL does not compile, and the job the compiler wrote did exactly that —
 * everything below is what the Installation and Operation manual's own sample
 * JCL says the job needs.
 *
 * GnuCOBOL implements Report Writer natively, which is why the executed tests
 * below pass and this went unnoticed: the local target needs no such step.
 */
describe("the job a report needs", () => {
  const result = compile(program(REPORT), { emitJcl: true });

  it("names the precompiler as a backend requirement", () => {
    expect(result.backendRequirements).toContain("report-writer-precompiler");
  });

  it("runs the stand-alone precompiler before the compiler", () => {
    const jcl = result.jcl ?? "";

    expect(jcl).toContain("//RWPRE    EXEC PGM=SPCRWCOB");
    // SYSIN in, RWWORK for working space, SYSINS out — and the compile step
    // reads what it wrote rather than the original source.
    expect(jcl).toContain("//RWWORK   DD UNIT=SYSALLDA");
    expect(jcl).toContain("//SYSINS   DD DSN=&&RWOUT");
    // A step ahead of the compiler is what forces the expanded form: a
    // cataloged procedure has nowhere to put one.
    expect(jcl).toContain("//COBOL    EXEC PGM=IGYCRCTL,REGION=0M,COND=(4,LT)");
    expect(jcl).not.toContain("//COMPILE  EXEC IGYWCL");
    expect(jcl).toContain("//SYSIN    DD DSN=&&RWOUT,DISP=(OLD,DELETE)");
    expect(jcl.indexOf("PGM=SPCRWCOB")).toBeLessThan(
      jcl.indexOf("PGM=IGYCRCTL"),
    );
  });

  /**
   * The expansion calls the Report Writer run time routines, so the link-edit
   * has to resolve them. Without the library the load module is short of every
   * routine the precompiler generated a reference to.
   */
  it("links against the run time library", () => {
    const jcl = result.jcl ?? "";
    const linkStep = jcl.slice(jcl.indexOf("//LKED"));

    expect(linkStep).toContain("//         DD DISP=SHR,DSN=RW.SCXRRUN");
  });

  it("leaves a program with no report alone", () => {
    const plain = compile(
      `module Plain;

record Row { rowId: string<16>; idempotencyKey: string<36>; }

entry transaction t(row: Row) { audit("A", row.idempotencyKey); }`,
      { emitJcl: true },
    );

    expect(plain.backendRequirements).toEqual([]);
    expect(plain.jcl ?? "").not.toContain("SPCRWCOB");
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

  /** Compile a report program, run it, and return the lines it printed. */
  function render(source: string): string[] {
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-report-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );

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

    return readFileSync(join(dir, "STATEMEN"), "utf8")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  }

  it.skipIf(!available)("paginates and breaks on a change of control", () => {
    const printed = render(
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

    // The heading is printed once, by the compiler, at the top of the page.
    expect(printed[0]).toContain("BRANCH SUMMARY");
    expect(printed[0]).toMatch(/PAGE\s+1$/);

    // A footing at each change of branch and one more at the end, in order,
    // with nothing in the source deciding where any of them goes.
    expect(printed).toContain("LONDON          42.50");
    expect(printed).toContain("LEEDS           42.50");
    expect(printed.filter((line) => line.startsWith("SUBTOTAL:"))).toHaveLength(
      2,
    );
    expect(printed[printed.length - 1]).toMatch(/^TOTAL:/);
  });

  /**
   * The totals themselves, over a `zoned` amount.
   *
   * The amounts are chosen so that the branch subtotal needs one more digit
   * than any single row: 9,999,999.99 twice is 19,999,999.98, which a total
   * sized from the row's own picture cannot hold. Before the total field was
   * widened this printed 9,999,999.98 — a report that is wrong, still adds up
   * down the page, and returns zero.
   *
   * It is `zoned` rather than the packed `decimal` a real amount would be
   * because GnuCOBOL cannot total a packed field at all; see the test below.
   */
  it.skipIf(!available)("carries a total wider than any one row", () => {
    const printed = render(
      program(
        REPORT,
        `  line.branch = "LONDON";
  line.amount = 9999999.99;
  generate lineDetail;
  generate lineDetail;
  line.branch = "LEEDS";
  generate lineDetail;`,
      ).replace("amount: decimal<9, 2>;", "amount: zoned<9, 2>;"),
    );

    expect(printed).toContain("LONDON   9,999,999.99");
    expect(printed.join("\n")).toContain("19,999,999.98");
    expect(printed.join("\n")).toContain("29,999,999.97");
  });

  /**
   * A divergence, pinned so it cannot be mistaken for working.
   *
   * GnuCOBOL 3.2.0's Report Writer reads a `COMP-3` operand of a SUM clause
   * from the wrong place — it picks up only the low-order digits, so an amount
   * of 1,000,000.00 totals as zero while the same value printed by SOURCE on
   * the line above is correct. Money in a generated program is `COMP-3`, so
   * every total in every report is affected under the local validator and none
   * of it says anything about z/OS.
   *
   * This is why the pagination test above asserts the shape of the report and
   * not its figures: with a packed amount those figures are GnuCOBOL's, and
   * small values pass only because they survive the truncation. `zos/README.md`
   * records it, and this test fails if GnuCOBOL ever fixes it.
   */
  it.skipIf(!available)("does not total a packed amount under GnuCOBOL", () => {
    const printed = render(
      program(
        REPORT,
        `  line.branch = "LONDON";
  line.amount = 1000000.00;
  generate lineDetail;`,
      ),
    );

    // The detail line reads the same field correctly.
    expect(printed).toContain("LONDON   1,000,000.00");
    // The totals over it do not.
    expect(printed.some((line) => line.startsWith("SUBTOTAL:"))).toBe(true);
    for (const line of printed.filter(
      (entry) => entry.startsWith("SUBTOTAL:") || entry.startsWith("TOTAL:"),
    )) {
      expect(line).toMatch(/\s0\.00$/);
    }
  });
});
