import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  analyseCobol,
  describeLimits,
  renderInventory,
  renderParagraphGraph,
} from "../packages/migration-analysis/src/index";
import { runBankc } from "../packages/bankc-cli/src/index";

/**
 * Reading COBOL that already exists.
 *
 * The 2026-08-05 audit's §4.4, and the only thing on its missing list that
 * generates nothing. The tests are written against the conversions' originals
 * rather than against fragments, because a reader that works on a fragment and
 * not on a program is a reader that works on nothing.
 *
 * Two properties matter more than the counts: it must not report a live
 * paragraph as dead, and it must say what it does not know. The first is a
 * defect that gets code deleted; the second is what stops a count becoming an
 * estimate.
 */

const ACCTUPDT = analyseCobol(
  readFileSync(
    "conversions/01-sequential-update/original/ACCTUPDT.cbl",
    "utf8",
  ),
  "ACCTUPDT.cbl",
);

const ACCTENQ = analyseCobol(
  readFileSync(
    "conversions/02-cics-commarea-enquiry/original/ACCTENQ.cbl",
    "utf8",
  ),
  "ACCTENQ.cbl",
);

const BRACCR = analyseCobol(
  readFileSync("conversions/03-db2-cursor-batch/original/BRACCR.cbl", "utf8"),
  "BRACCR.cbl",
);

describe("a sequential update", () => {
  it("finds the program and its paragraphs", () => {
    expect(ACCTUPDT.programId).toBe("ACCTUPDT");
    expect(ACCTUPDT.paragraphs.map((entry) => entry.name)).toEqual([
      "0000-MAIN",
      "1000-READ-TRANS",
      "2000-PROCESS",
      "2900-REJECT",
      "2999-EXIT",
    ]);
  });

  /**
   * A paragraph name may start with a digit — `1000-READ-TRANS` is the house
   * style on half the estates there are — so `PERFORM 1000-READ-TRANS` must
   * not be read as the `PERFORM n TIMES` form.
   */
  it("reads a performed paragraph whose name starts with a digit", () => {
    const main = ACCTUPDT.paragraphs[0];
    expect(main.performs).toContain("1000-READ-TRANS");
    expect(main.performs).toContain("2000-PROCESS");
  });

  it("counts the jumps that are not returns", () => {
    expect(ACCTUPDT.jumps).toBe(3);
  });

  it("finds the files and says none has a status field", () => {
    expect(ACCTUPDT.files.map((file) => file.name)).toEqual([
      "TRANS-FILE",
      "MASTER-IN",
      "MASTER-OUT",
      "REJECT-FILE",
    ]);
    expect(ACCTUPDT.files.every((file) => file.statusChecked)).toBe(false);
  });

  /** Every paragraph here is reached, and reporting one dead deletes code. */
  it("reports nothing dead in a program with nothing dead", () => {
    expect(ACCTUPDT.unreachable).toEqual([]);
  });
});

describe("a CICS enquiry", () => {
  it("finds the commands and whether each captures a response", () => {
    expect(ACCTENQ.cics.map((use) => use.command)).toEqual([
      "ABEND",
      "WRITEQ",
      "RETURN",
    ]);
    expect(
      ACCTENQ.cics.find((use) => use.command === "WRITEQ")?.respCaptured,
    ).toBe(true);
    expect(
      ACCTENQ.cics.find((use) => use.command === "ABEND")?.respCaptured,
    ).toBe(false);
  });

  it("finds the SQL and the table it names", () => {
    expect(ACCTENQ.sql.map((use) => use.verb)).toContain("SELECT");
    expect(ACCTENQ.sql.flatMap((use) => use.names)).toContain("ACCOUNT");
  });
});

describe("a Db2 cursor batch", () => {
  it("finds the cursor declaration and the fetch", () => {
    const verbs = BRACCR.sql.map((use) => use.verb);
    expect(verbs).toContain("DECLARE");
    expect(verbs).toContain("FETCH");
    expect(verbs).toContain("OPEN");
    expect(verbs).toContain("CLOSE");
  });

  it("finds the program it calls", () => {
    expect(BRACCR.calls).toContain("BANKLEDG");
  });
});

describe("a paragraph inside DECLARATIVES", () => {
  /**
   * Nothing performs a declarative and nothing falls into one: the runtime
   * enters it when the condition happens. Counting one as dead code would have
   * somebody delete the program's error handling — and reading the entry point
   * as the first paragraph in the division rather than the first after
   * `END DECLARATIVES` reported the entry point itself as dead.
   */
  const withDeclaratives = analyseCobol(
    `       IDENTIFICATION DIVISION.
       PROGRAM-ID.    DECLTEST.
       PROCEDURE DIVISION.
       DECLARATIVES.
       IN-ERROR SECTION.
           USE AFTER STANDARD ERROR PROCEDURE ON ACCT-FILE.
       IN-ERROR-BODY.
           DISPLAY 'FAILED'.
       END DECLARATIVES.
       MAIN SECTION.
       0000-MAIN.
           PERFORM 1000-WORK.
           GOBACK.
       1000-WORK.
           DISPLAY 'WORKING'.
       9999-ORPHAN.
           DISPLAY 'NOBODY CALLS ME'.
`,
    "DECLTEST.cbl",
  );

  it("does not report the error handler as dead", () => {
    expect(withDeclaratives.unreachable).not.toContain("IN-ERROR");
    expect(withDeclaratives.unreachable).not.toContain("IN-ERROR-BODY");
  });

  it("does not report the entry point as dead", () => {
    expect(withDeclaratives.unreachable).not.toContain("0000-MAIN");
    expect(withDeclaratives.unreachable).not.toContain("MAIN");
  });

  it("marks the declaratives as declaratives", () => {
    const handler = withDeclaratives.paragraphs.find(
      (entry) => entry.name === "IN-ERROR-BODY",
    );
    expect(handler?.declarative).toBe(true);
  });
});

describe("the risks it names", () => {
  it("says what ALTER costs", () => {
    const altered = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID.    ALTERED.
       PROCEDURE DIVISION.
       0000-MAIN.
           ALTER 1000-SWITCH TO PROCEED TO 2000-OTHER.
           GOBACK.
       1000-SWITCH.
           GO TO 2000-OTHER.
       2000-OTHER.
           DISPLAY 'HERE'.
`,
      "ALTERED.cbl",
    );

    expect(altered.alters).toBe(1);
    expect(renderInventory([altered])).toContain("ALTER");
  });

  it("says what a dynamic CALL costs", () => {
    const dynamic = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID.    DYNCALL.
       PROCEDURE DIVISION.
       0000-MAIN.
           CALL WS-PROGRAM-NAME.
           GOBACK.
`,
      "DYNCALL.cbl",
    );

    expect(dynamic.dynamicCalls).toBe(1);
    expect(renderInventory([dynamic])).toContain("decided at run time");
  });
});

describe("the report", () => {
  it("prints what it does not know", () => {
    const inventory = renderInventory([ACCTUPDT]);
    for (const limit of describeLimits()) {
      expect(inventory).toContain(limit);
    }
  });

  it("never calls itself an estimate", () => {
    expect(renderInventory([ACCTUPDT])).toContain(
      "Nothing here is a conversion estimate",
    );
  });

  it("draws a performed edge and a jumped edge differently", () => {
    const graph = renderParagraphGraph(ACCTUPDT);
    expect(graph).toContain("```mermaid");
    // `0000-MAIN` performs `1000-READ-TRANS`, and `2000-PROCESS` jumps.
    expect(graph).toMatch(/p0 --> p\d/);
    expect(graph).toMatch(/p2 ==> p\d/);
  });

  it("draws one edge for a target named three times", () => {
    const graph = renderParagraphGraph(ACCTUPDT);
    const jumps = graph.split("\n").filter((line) => line.includes("==>"));
    expect(new Set(jumps).size).toBe(jumps.length);
  });
});

describe("bankc analyse", () => {
  it("reads a directory of members", () => {
    const result = runBankc(["analyse", "conversions/01-sequential-update"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# COBOL inventory");
    expect(result.stdout).toContain("ACCTUPDT");
  });

  it("says so when there is nothing to read", () => {
    const result = runBankc(["analyse", "docs"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No .cbl or .cob members");
  });
});
