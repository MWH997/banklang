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
    const main = ACCTUPDT.paragraphs[0]!;
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

/**
 * What first contact with somebody else's COBOL found.
 *
 * G4 asked for a benchmark corpus of third-party COBOL. Before any of it could
 * be converted, the analyser was run over one — AWS's CardDemo, Apache-2.0,
 * thirty-one CICS and batch programs — and it got two things wrong on code
 * nobody here had written. Both are shapes that never occur in this
 * repository's own conversions, which is exactly why they survived: every
 * original in `conversions/` was written by the author of the reader.
 *
 * The fragments below are the shapes, rewritten. Neither is CardDemo's text.
 */
describe("COBOL written by somebody else", () => {
  /**
   * A COBOL clause continues across lines, so `PROGRAM-ID.` and the name it
   * introduces need not share one. Nine of CardDemo's thirty-one programs
   * write the name underneath, and all nine came out of the report with no
   * name at all — an estate inventory where a third of the rows say `?`.
   */
  it("finds a program name written on the line after PROGRAM-ID", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID.
            COACCTUP.
       PROCEDURE DIVISION.
       MAIN-PARA.
           GOBACK.
`,
      "COACCTUP.cbl",
    );

    expect(analysis.programId).toBe("COACCTUP");
  });

  it("still finds one written on the same line", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID.    CBACT04C.
       PROCEDURE DIVISION.
       MAIN-PARA.
           GOBACK.
`,
      "CBACT04C.cbl",
    );

    expect(analysis.programId).toBe("CBACT04C");
  });

  /**
   * A hyphen is a word boundary to a regular expression and a letter to COBOL,
   * so `\bSELECT` matched inside `WS-EDIT-SELECT`; and `SELECT` inside a
   * message is not a file either. The report claimed two files called `PIC`
   * and `ONLY`, and then that neither declared a `FILE STATUS`.
   *
   * An invented finding is worse than a missed one. It is the kind a reader
   * checks, does not find, and stops trusting the rest of the page over.
   */
  it("does not read a data name ending in -SELECT as a file", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. COCRDLIS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-EDIT-FLAGS.
           05 WS-EDIT-SELECT             PIC X(1).
           05 WS-MESSAGE                 PIC X(48)
              VALUE 'PLEASE SELECT ONLY ONE RECORD TO VIEW'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           GOBACK.
`,
      "COCRDLIS.cbl",
    );

    expect(analysis.files).toEqual([]);
  });

  it("still reads a real one, and still says it has no FILE STATUS", () => {
    // `CBSTM03A` genuinely declares two files with no status field, which is
    // the finding that has to survive the fix.
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CBSTMT03.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT STMT-FILE ASSIGN TO STMTFILE.
           SELECT HTML-FILE ASSIGN TO HTMLFILE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-EDIT-SELECT                PIC X(1).
       PROCEDURE DIVISION.
       MAIN-PARA.
           GOBACK.
`,
      "CBSTMT03.cbl",
    );

    expect(analysis.files.map((file) => file.name)).toEqual([
      "STMT-FILE",
      "HTML-FILE",
    ]);
    expect(analysis.files.every((file) => !file.statusChecked)).toBe(true);
  });
});

/**
 * The reachability analysis, asked directly.
 *
 * Every test above runs against the conversions' originals, on the stated
 * doctrine that a reader which works on a fragment and not on a program works
 * on nothing. That doctrine is right and it is why this section exists: five
 * real programs do not contain every shape, so the tools mutation lane found
 * `packages/migration-analysis/src/index.ts` at **36.05%** with 202 surviving
 * mutants, most of them on the branches below.
 *
 * These are fragments on purpose, and they do not replace the whole-program
 * tests — they pin the individual decisions those programs happen not to make.
 * The property that matters is the one the header names: a live paragraph must
 * never be reported dead, because that is the defect that gets code deleted.
 */
describe("which paragraphs are unreachable", () => {
  const program = (body: string) =>
    analyseCobol(
      `       IDENTIFICATION DIVISION.\n       PROGRAM-ID. T1.\n       PROCEDURE DIVISION.\n${body}`,
      "T1.cbl",
    );

  it("reports a paragraph nothing reaches after a GO TO", () => {
    const analysis = program(`       A-START.
           GO TO C-END.
       B-DEAD.
           DISPLAY "B".
       C-END.
           DISPLAY "C".`);
    expect(analysis.unreachable).toEqual(["B-DEAD"]);
  });

  it("does not report a paragraph reached by falling into it", () => {
    // The paragraph above does not leave, so control arrives here.
    const analysis = program(`       A-START.
           DISPLAY "A".
       B-LIVE.
           DISPLAY "B".`);
    expect(analysis.unreachable).toEqual([]);
  });

  it("never reports the entry point, which nothing performs", () => {
    const analysis = program(`       A-START.
           GO TO A-START.`);
    expect(analysis.unreachable).toEqual([]);
  });

  /**
   * `PERFORM x THRU y` reaches every paragraph between them, not just the two
   * it names. Reading only the endpoints reports the middle as dead.
   */
  it("keeps the whole of a PERFORM THRU range live", () => {
    const analysis = program(`       A-START.
           PERFORM B-ONE THRU B-THREE.
           GO TO Z-END.
       B-ONE.
           DISPLAY "1".
       B-TWO.
           DISPLAY "2".
       B-THREE.
           DISPLAY "3".
       Z-END.
           DISPLAY "Z".`);
    expect(analysis.unreachable).toEqual([]);
  });

  it("says nothing rather than something wrong when THRU names a paragraph that is not there", () => {
    // An unresolvable range is skipped: reporting the range dead on the
    // strength of a name the program does not define is the deleting defect.
    const analysis = program(`       A-START.
           PERFORM B-ONE THRU NOWHERE.
           GO TO Z-END.
       B-ONE.
           DISPLAY "1".
       Z-END.
           DISPLAY "Z".`);
    expect(analysis.unreachable).toEqual([]);
  });

  it("does not report a declarative, which the runtime enters", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. T2.
       PROCEDURE DIVISION.
       DECLARATIVES.
       ERR-SECTION SECTION.
           USE AFTER STANDARD ERROR PROCEDURE ON MASTER.
       ERR-HANDLER.
           DISPLAY "E".
       END DECLARATIVES.
       MAIN-SECTION SECTION.
       A-START.
           GO TO C-END.
       B-DEAD.
           DISPLAY "B".
       C-END.
           DISPLAY "C".`,
      "T2.cbl",
    );
    expect(analysis.unreachable).toEqual(["B-DEAD"]);
    expect(analysis.unreachable).not.toContain("ERR-HANDLER");
  });

  /**
   * A section header with no statements of its own falls into its first
   * paragraph. Reading an empty paragraph as one that leaves had the entry
   * point of every generated program reported as dead code.
   */
  it("does not report the first paragraph of a section as dead", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. T3.
       PROCEDURE DIVISION.
       FIRST-SECTION SECTION.
       A-START.
           DISPLAY "A".
       SECOND-SECTION SECTION.
       B-FIRST.
           DISPLAY "B".`,
      "T3.cbl",
    );
    expect(analysis.unreachable).toEqual([]);
  });

  it("counts the jumps it found", () => {
    expect(
      program(`       A-START.
           GO TO C-END.
       C-END.
           DISPLAY "C".`).jumps,
    ).toBe(1);
    expect(
      program(`       A-START.
           DISPLAY "A".`).jumps,
    ).toBe(0);
  });
});

/**
 * The risk report, at both extremes and on its one threshold.
 *
 * `describeRisks` is six guards over an analysis, reached through
 * `renderInventory`, and the conversions' originals exercise some of them and
 * never the others — so the mutation lane found each guard surviving in both
 * directions. A guard that cannot be observed to fire is a risk the report may
 * silently stop naming.
 *
 * The pairing is what makes these worth writing: a program that trips every one
 * and a program that trips none. Asserting only the first would pass while the
 * report named every risk unconditionally.
 */
describe("the risks a program is reported to carry", () => {
  const CLEAN = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CLEANP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT MASTER ASSIGN TO MASTER
               FILE STATUS IS WS-MASTER-STATUS.
       PROCEDURE DIVISION.
       A-START.
           DISPLAY "A".`;

  const gotos = Array.from(
    { length: 12 },
    (_unused, index) => `           GO TO P-${String(index)}.`,
  ).join("\n");
  const paragraphs = Array.from(
    { length: 12 },
    (_unused, index) =>
      `       P-${String(index)}.\n           DISPLAY "${String(index)}".`,
  ).join("\n");

  const RISKY = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. RISKYP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT LEDGER ASSIGN TO LEDGER.
       PROCEDURE DIVISION.
       A-START.
           ALTER B-SWITCH TO PROCEED TO P-1.
           CALL WS-PROGRAM-NAME.
           EXEC CICS LINK PROGRAM('SUB') END-EXEC.
${gotos}
       B-SWITCH.
           GO TO P-0.
${paragraphs}`;

  /**
   * Risk lines only. Every report also carries `describeLimits()`, which is a
   * bulleted list too — filtering on the bullet alone counted "what this tool
   * does not know" as a risk the program carries.
   */
  const risksOf = (source: string, artifact: string) =>
    renderInventory([analyseCobol(source, artifact)])
      .split("\n")
      .filter(
        (line) =>
          line.trimStart().startsWith("- `") && line.includes(`(${artifact})`),
      );

  it("names every risk the program actually carries", () => {
    const reported = risksOf(RISKY, "risky.cbl").join("\n");
    expect(reported).toContain("uses `ALTER`");
    expect(reported).toContain("dynamic `CALL`");
    expect(reported).toContain("`GO TO`s to somewhere that is not an exit");
    expect(reported).toContain("paragraphs nothing reaches");
    expect(reported).toContain("declares no `FILE STATUS`");
    expect(reported).toContain("CICS command(s) with no `RESP`");
  });

  it("names none of them for a program that carries none", () => {
    // A report that always warns is a report nobody reads.
    expect(risksOf(CLEAN, "clean.cbl")).toEqual([]);
  });

  /**
   * The one number in the report: more than ten `GO TO`s is called out, ten is
   * not. A threshold nothing pins drifts, and `>=` reads the same as `>` on
   * every program that is not sitting exactly on it.
   */
  it("calls out more than ten jumps, and not ten", () => {
    const withJumps = (count: number) => {
      const jumps = Array.from(
        { length: count },
        (_unused, index) => `           GO TO Q-${String(index)}.`,
      ).join("\n");
      const targets = Array.from(
        { length: count },
        (_unused, index) =>
          `       Q-${String(index)}.\n           DISPLAY "x".`,
      ).join("\n");
      return `       IDENTIFICATION DIVISION.
       PROGRAM-ID. JUMPY.
       PROCEDURE DIVISION.
       A-START.
${jumps}
${targets}`;
    };

    const sentence = "`GO TO`s to somewhere that is not an exit";
    expect(analyseCobol(withJumps(10), "j.cbl").jumps).toBe(10);
    expect(risksOf(withJumps(10), "j.cbl").join("\n")).not.toContain(sentence);
    expect(risksOf(withJumps(11), "j.cbl").join("\n")).toContain(sentence);
  });
});

/**
 * Which CICS commands are expected to report a response, and which are not.
 *
 * `RETURN` and `ABEND` do not come back, so there is nothing for a response to
 * be reported into and no branch that could read one. Every other command that
 * omits `RESP` abends the task with nothing said about it, which is the risk
 * worth naming.
 *
 * Both halves matter. A rule that flagged `RETURN` would put a finding on every
 * CICS program ever written; one that flagged nothing would be silent on the
 * command that actually fails. The mutation lane found the exclusion list and
 * the `respCaptured` test surviving in both directions.
 */
describe("a CICS command with no RESP", () => {
  const program = (body: string) => `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CICSA.
       PROCEDURE DIVISION.
       A-START.
${body}`;

  const flagged = (body: string) =>
    renderInventory([analyseCobol(program(body), "c.cbl")])
      .split("\n")
      .some((line) => line.includes("no `RESP`"));

  it("is not reported for RETURN or ABEND, which do not come back", () => {
    expect(flagged("           EXEC CICS RETURN END-EXEC.")).toBe(false);
    expect(flagged("           EXEC CICS ABEND ABCODE('X999') END-EXEC.")).toBe(
      false,
    );
  });

  it("is reported for a command that can fail and say so", () => {
    expect(flagged("           EXEC CICS LINK PROGRAM('SUB') END-EXEC.")).toBe(
      true,
    );
    expect(flagged("           EXEC CICS READ FILE('ACCT') END-EXEC.")).toBe(
      true,
    );
  });

  it("is not reported when the response is captured", () => {
    expect(
      flagged(
        "           EXEC CICS LINK PROGRAM('SUB') RESP(WS-RESP) END-EXEC.",
      ),
    ).toBe(false);
  });

  it("counts the commands it found either way", () => {
    // The inventory reports the count whether or not it is a risk, so a
    // command that stops being recognised is visible as a count that fell.
    expect(
      analyseCobol(program("           EXEC CICS RETURN END-EXEC."), "c.cbl")
        .cics,
    ).toHaveLength(1);
  });
});

/**
 * What a `SELECT` clause says about a file.
 *
 * Each clause attaches to the file most recently seen, so the parsing is
 * order-dependent in a way nothing was pinning: the mutation lane found the
 * `files.size > 0` guards and the FILE STATUS test surviving.
 */
describe("a file declared in FILE-CONTROL", () => {
  const program = (fileControl: string) => `       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
${fileControl}
       PROCEDURE DIVISION.
       A-START.
           DISPLAY "A".`;

  const filesOf = (fileControl: string) =>
    analyseCobol(program(fileControl), "f.cbl").files;

  it("carries its DD name, organisation and whether a status is checked", () => {
    const [file] = filesOf(`           SELECT MASTER ASSIGN TO UT-S-MASTER
               ORGANIZATION IS INDEXED
               FILE STATUS IS WS-ST.`);
    expect(file?.name).toBe("MASTER");
    expect(file?.organization).toBe("INDEXED");
    expect(file?.statusChecked).toBe(true);
  });

  /**
   * `ASSIGN TO [comment-]...[S-]ddname`. A DD name is one to eight
   * alphanumeric characters and cannot contain a hyphen, so the ddname is the
   * last part — `UT-S-MASTER` is the DD `MASTER`, not `S-MASTER`. The
   * conversions' own originals use bare names, so nothing here saw it.
   */
  it("reads the DD name out of a qualified assignment-name", () => {
    expect(filesOf("           SELECT M ASSIGN TO UT-S-MASTER.")[0]?.dd).toBe(
      "MASTER",
    );
    expect(filesOf("           SELECT M ASSIGN TO S-MASTER.")[0]?.dd).toBe(
      "MASTER",
    );
    expect(filesOf("           SELECT M ASSIGN TO MASTER.")[0]?.dd).toBe(
      "MASTER",
    );
  });

  it("records no status where none is declared", () => {
    const [file] = filesOf(`           SELECT LEDGER ASSIGN TO LEDGER
               ORGANIZATION IS SEQUENTIAL.`);
    expect(file?.statusChecked).toBe(false);
    expect(file?.organization).toBe("SEQUENTIAL");
  });

  it("attaches each clause to the file it follows", () => {
    // The failure worth preventing: one file's FILE STATUS marking another's.
    const files =
      filesOf(`           SELECT ONE ASSIGN TO DD1 FILE STATUS IS S1.
           SELECT TWO ASSIGN TO DD2.`);
    expect(files.map((file) => [file.name, file.statusChecked])).toEqual([
      ["ONE", true],
      ["TWO", false],
    ]);
  });
});
