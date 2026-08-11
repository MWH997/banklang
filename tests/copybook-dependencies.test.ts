import { describe, expect, it } from "vitest";

import {
  analyseCobol,
  buildCopybookDependencyGraph,
  parseCopyReferences,
  renderCopybookDependencyGraph,
  type CopybookGraphSource,
} from "../packages/migration-analysis/src/index";

describe("COPY reference parsing", () => {
  it("ignores comments and literals in fixed and free source", () => {
    const fixed = `000100* COPY COMMENTED.
000200  IDENTIFICATION DIVISION.
000300  PROGRAM-ID. FIXED.
000400      DISPLAY 'COPY IN-SINGLE-QUOTES.'
000500      DISPLAY "COPY IN-DOUBLE-QUOTES. *> STILL-A-LITERAL"
000600      COPY FIXED-REAL. *> COPY INLINE-COMMENT.
000700/ COPY PAGE-COMMENT.
`;
    const free = `*> COPY COMMENTED.
DISPLAY "COPY IN-A-LITERAL.".
DISPLAY '*> COPY ALSO-IN-A-LITERAL.'.
COPY free-real. *> COPY INLINE-COMMENT.
`;

    expect(parseCopyReferences(fixed)).toEqual([
      { member: "FIXED-REAL", line: 6, replacing: false },
    ]);
    expect(parseCopyReferences(free)).toEqual([
      { member: "FREE-REAL", line: 4, replacing: false },
    ]);
  });

  it("reads multiline members and records REPLACING without applying it", () => {
    const references = parseCopyReferences(`identification division.
copy
  "customer.cpy"
  replacing
    ==COPY NOT-A-REFERENCE.== by ==COPY NEITHER.==.
copy plain-member.
`);

    expect(references).toEqual([
      { member: "CUSTOMER", line: 2, replacing: true },
      { member: "PLAIN-MEMBER", line: 6, replacing: false },
    ]);
  });

  it("does not mistake embedded SQL, CICS or DL/I text for COBOL", () => {
    const references = parseCopyReferences(`       EXEC SQL
           COPY SQL-HIDDEN.
       END-EXEC.
       EXEC CICS COPY CICS-HIDDEN END-EXEC.
       EXEC DLI
           COPY DLI-HIDDEN.
       END-EXEC.
       EXEC OTHER.
       COPY visible.
`);

    expect(references).toEqual([
      { member: "VISIBLE", line: 9, replacing: false },
    ]);
  });

  it("joins fixed-format word and quoted-member continuations", () => {
    const references = parseCopyReferences(`000100  COPY ACCOUNT-
000200-     RECORD.
000300  COPY "CUSTOMER-
000400-     "DETAIL.cpy".
000500  COPY CUSTO
000600-     MER.
`);

    expect(references).toEqual([
      { member: "ACCOUNT-RECORD", line: 1, replacing: false },
      { member: "CUSTOMER-DETAIL", line: 3, replacing: false },
      { member: "CUSTOMER", line: 5, replacing: false },
    ]);
  });

  it("keeps analyseCobol's copybook list on the shared parser", () => {
    const analysis = analyseCobol(
      `       IDENTIFICATION DIVISION.
       PROGRAM-ID. SHARED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
           DISPLAY 'COPY FALSE-POSITIVE.'.
       EXEC SQL
           /* COPY SQL-FALSE-POSITIVE. */
       END-EXEC.
       COPY
           real-member
           REPLACING ==OLD== BY ==NEW==.
`,
      "SHARED.cbl",
    );

    expect(analysis.copybooks).toEqual(["REAL-MEMBER"]);
  });
});

const source = (
  kind: "program" | "copybook",
  artifact: string,
  text: string,
  member?: string,
): CopybookGraphSource =>
  kind === "program"
    ? { kind, artifact, text }
    : { kind, artifact, member: member ?? artifact, text };

describe("copybook dependency resolution", () => {
  it("reports resolved, missing and ambiguous references", () => {
    const graph = buildCopybookDependencyGraph([
      source(
        "program",
        "programs/MAIN.cbl",
        `       COPY unique.
       COPY absent.
       COPY shared REPLACING ==A== BY ==B==.
`,
      ),
      source("copybook", "lib/UNIQUE.cpy", "", "unique.cpy"),
      source("copybook", "lib-a/SHARED.cpy", "", "shared.cpy"),
      source("copybook", "lib-b/shared.CPY", "", "SHARED"),
    ]);

    expect(graph.edges).toEqual([
      {
        source: "program:programs/MAIN.cbl",
        member: "UNIQUE",
        line: 1,
        replacing: false,
        status: "resolved",
        targets: ["copybook:lib/UNIQUE.cpy"],
      },
      {
        source: "program:programs/MAIN.cbl",
        member: "ABSENT",
        line: 2,
        replacing: false,
        status: "missing",
        targets: [],
      },
      {
        source: "program:programs/MAIN.cbl",
        member: "SHARED",
        line: 3,
        replacing: true,
        status: "ambiguous",
        targets: ["copybook:lib-a/SHARED.cpy", "copybook:lib-b/shared.CPY"],
      },
    ]);

    expect(renderCopybookDependencyGraph(graph)).toContain(
      '  n3 -->|"COPY UNIQUE · line 1"| n2',
    );
    expect(renderCopybookDependencyGraph(graph)).toContain(
      '  n3 -.->|"COPY ABSENT · line 2 · missing"| m0',
    );
    expect(renderCopybookDependencyGraph(graph)).toContain(
      [
        '  n3 -.->|"COPY SHARED REPLACING · line 3 · ambiguous"| n0',
        '  n3 -.->|"COPY SHARED REPLACING · line 3 · ambiguous"| n1',
      ].join("\n"),
    );
  });

  it("follows nested copybooks and reports strongly connected cycle groups", () => {
    const graph = buildCopybookDependencyGraph([
      source("program", "programs/MAIN.cbl", "COPY a."),
      source("copybook", "copy/A.cpy", "COPY b.", "a"),
      source("copybook", "copy/B.cpy", "COPY c.", "B.cpy"),
      source("copybook", "copy/C.cpy", "COPY a.", "c"),
      source("copybook", "copy/SELF.cpy", "COPY self.", "self"),
      source("copybook", "copy/LEAF.cpy", "", "leaf"),
    ]);

    expect(graph.edges.map((edge) => [edge.source, edge.targets[0]])).toEqual([
      ["copybook:copy/A.cpy", "copybook:copy/B.cpy"],
      ["copybook:copy/B.cpy", "copybook:copy/C.cpy"],
      ["copybook:copy/C.cpy", "copybook:copy/A.cpy"],
      ["copybook:copy/SELF.cpy", "copybook:copy/SELF.cpy"],
      ["program:programs/MAIN.cbl", "copybook:copy/A.cpy"],
    ]);
    expect(graph.cycles).toEqual([
      ["copybook:copy/A.cpy", "copybook:copy/B.cpy", "copybook:copy/C.cpy"],
      ["copybook:copy/SELF.cpy"],
    ]);
    expect(renderCopybookDependencyGraph(graph)).toContain(
      "  classDef cycle stroke-width:3px\n  class n0,n1,n2,n4 cycle",
    );
  });

  it("keeps untrusted graph labels inside the Mermaid fence and node", () => {
    const graph = buildCopybookDependencyGraph([
      source(
        "copybook",
        "path\r\n\u0001```\"'<>&[]",
        "",
        "mem\r\n\u0001```\"'<>&[]ber",
      ),
    ]);

    expect(renderCopybookDependencyGraph(graph)).toBe(
      [
        "```mermaid",
        "flowchart LR",
        '  n0["COPYBOOK MEM &#96;&#96;&#96;&quot;&#39;&lt;&gt;&amp;&#91;&#93;BER<br/>path &#96;&#96;&#96;&quot;&#39;&lt;&gt;&amp;&#91;&#93;"]',
        "```",
        "",
        "Resolved references are solid; missing and ambiguous references are dotted.",
        "`COPY REPLACING` is edge metadata only: source is not expanded or rewritten.",
      ].join("\n"),
    );
  });

  it("is deterministic across caller ordering in JSON and Mermaid", () => {
    const sources = [
      source(
        "program",
        "z/PROGRAM.cbl",
        "COPY beta. COPY missing. COPY alpha.",
      ),
      source("copybook", "z/BETA.cpy", "COPY alpha.", "beta"),
      source("copybook", "a/ALPHA.cpy", "", "alpha.cpy"),
    ];

    const forward = buildCopybookDependencyGraph(sources);
    const reverse = buildCopybookDependencyGraph([...sources].reverse());

    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
    expect(renderCopybookDependencyGraph(reverse)).toBe(
      renderCopybookDependencyGraph(forward),
    );
    expect(forward).toMatchObject({
      schemaVersion: 1,
      semanticExpansion: false,
    });

    const markdown = renderCopybookDependencyGraph(forward);
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("MISSING COPYBOOK MISSING");
    expect(markdown).toContain("missing");
    expect(markdown).toContain(
      "`COPY REPLACING` is edge metadata only: source is not expanded or rewritten.",
    );
  });
});
