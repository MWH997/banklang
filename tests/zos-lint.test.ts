import { describe, expect, it } from "vitest";

import {
  formatZosFindings,
  lintZos,
  ZOS_RULES,
} from "../packages/zos-lint/src/index";
import {
  callOperands,
  procedureStatements,
} from "../packages/zos-lint/src/statements";
import { lintZosAll } from "../tools/zos-lint";
import { checked, compileExample, corpus } from "./helpers";

/**
 * The pass that reads emitted COBOL for what z/OS will do with it.
 *
 * Two halves, like the conformance linter's tests. The rules are checked
 * against the programs this compiler actually shipped — reproduced here from
 * the 2026-08-07 audit, because the emitter no longer produces either shape and
 * a rule whose failing case is hypothetical is a rule that might be inert. Then
 * the whole corpus is read, because a lane that reports nothing and a lane that
 * reads nothing look identical from the outside.
 */

/**
 * `examples/mq-request-reply` as it was emitted before A1.
 *
 * Two queues on `CSQ1`, a connect paired with each open, and a completion-code
 * test that treats `MQCC_WARNING` as failure. On z/OS the second `MQCONN`
 * returns the first call's handle with reason 2002, this test aborts the step
 * with RC 12, and no message is ever read.
 */
const PAIRED_CONNECTS = `       PROCEDURE DIVISION.
       DRAIN-PAYMENTS-BODY.
           MOVE "CSQ1" TO BANK-MQ-1-MGRNAME
           CALL "MQCONN" USING BANK-MQ-1-MGRNAME, BANK-MQ-1-HCONN,
               PAYMENT-IN-COMPCODE, PAYMENT-IN-REASON
           IF PAYMENT-IN-COMPCODE NOT = MQCC-OK
               MOVE 12 TO BANK-RETURN-CODE
           END-IF
           MOVE "CSQ1" TO BANK-MQ-2-MGRNAME
           CALL "MQCONN" USING BANK-MQ-2-MGRNAME, BANK-MQ-2-HCONN,
               PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON
           IF PAYMENT-OUT-COMPCODE NOT = MQCC-OK
               MOVE 12 TO BANK-RETURN-CODE
           END-IF
           GOBACK.
`;

/**
 * `examples/online-enquiry` as it was emitted before A2.
 *
 * The transaction reads the commarea into `ENQUIRY-REQUEST`, computes into
 * `BALANCE-REPLY`, and moves `ENQUIRY-REQUEST` back — so the caller is handed
 * the question it asked. Every line of it is valid Enterprise COBOL.
 */
const UNANSWERED_COMMAREA = `       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  LK-ACCOUNT-ID  PIC X(16).

       PROCEDURE DIVISION.
       ACCOUNT-ENQUIRY.
           MOVE DFHCOMMAREA TO ENQUIRY-REQUEST
           MOVE ACCOUNT-ID OF ENQUIRY-REQUEST TO FETCH-ACCOUNT-H1
           IF ACCOUNT-ID OF ENQUIRY-REQUEST NOT = SPACES
               MOVE 100 TO BALANCE OF BALANCE-REPLY
           END-IF
           MOVE ENQUIRY-REQUEST TO DFHCOMMAREA
           CONTINUE.
`;

describe("what the pass refuses", () => {
  it("a second connection to a queue manager already connected", () => {
    const findings = lintZos("x.cbl", PAIRED_CONNECTS);

    expect(findings.map((finding) => finding.rule)).toContain(
      "mq-connection-per-manager",
    );
    const report = formatZosFindings(findings);
    expect(report).toContain("CSQ1");
    expect(report).toContain("BANK-MQ-2-HCONN");
    expect(report).toContain('MQ, "MQCONN", usage note 3');
  });

  it("an MQCONN test that treats MQRC_ALREADY_CONNECTED as failure", () => {
    const findings = lintZos("x.cbl", PAIRED_CONNECTS).filter(
      (finding) => finding.rule === "mq-already-connected",
    );

    expect(findings).toHaveLength(2);
    // The line of the test, not of the call: the test is what has to change.
    expect(PAIRED_CONNECTS.split("\n")[findings[0]!.line - 1]).toContain("IF");
  });

  it("a commarea returned with nothing written into it", () => {
    const findings = lintZos("y.cbl", UNANSWERED_COMMAREA);

    expect(findings.map((finding) => finding.rule)).toEqual([
      "cics-commarea-answered",
    ]);
    expect(formatZosFindings(findings)).toContain("ENQUIRY-REQUEST");
  });
});

describe("what the pass accepts", () => {
  /**
   * The shape A1 replaced the paired connects with: one handle for the
   * manager, a count of what is open on it, and a connect that runs only when
   * nothing is.
   */
  it("one handle per queue manager, connected once", () => {
    const findings = lintZos(
      "x.cbl",
      `       PROCEDURE DIVISION.
       DRAIN-PAYMENTS-BODY.
           IF BANK-MQM-1-OPENS = 0
               MOVE "CSQ1" TO BANK-MQM-1-MGRNAME
               CALL "MQCONN" USING BANK-MQM-1-MGRNAME, BANK-MQM-1-HCONN,
                   IN-COMPCODE, IN-REASON
               IF IN-COMPCODE NOT = MQCC-OK AND
                   IN-REASON NOT = MQRC-ALREADY-CONNECTED
                   MOVE 12 TO BANK-RETURN-CODE
               END-IF
           END-IF
           ADD 1 TO BANK-MQM-1-OPENS
           IF BANK-MQM-1-OPENS = 0
               MOVE "CSQ1" TO BANK-MQM-1-MGRNAME
               CALL "MQCONN" USING BANK-MQM-1-MGRNAME, BANK-MQM-1-HCONN,
                   OUT-COMPCODE, OUT-REASON
               IF OUT-COMPCODE NOT = MQCC-OK AND
                   OUT-REASON NOT = MQRC-ALREADY-CONNECTED
                   MOVE 12 TO BANK-RETURN-CODE
               END-IF
           END-IF
           GOBACK.
`,
    );

    expect(formatZosFindings(findings)).toBe("No z/OS semantics findings.\n");
  });

  /** Two managers are two connections, which is what IBM asks for. */
  it("one connection each to two queue managers", () => {
    const findings = lintZos(
      "x.cbl",
      `       PROCEDURE DIVISION.
       BANK-MAIN.
           MOVE "CSQ1" TO BANK-MQM-1-MGRNAME
           CALL "MQCONN" USING BANK-MQM-1-MGRNAME, BANK-MQM-1-HCONN,
               IN-COMPCODE, IN-REASON
           IF IN-COMPCODE NOT = MQCC-OK AND
               IN-REASON NOT = MQRC-ALREADY-CONNECTED
               MOVE 12 TO BANK-RETURN-CODE
           END-IF
           MOVE "CSQ2" TO BANK-MQM-2-MGRNAME
           CALL "MQCONN" USING BANK-MQM-2-MGRNAME, BANK-MQM-2-HCONN,
               OUT-COMPCODE, OUT-REASON
           IF OUT-COMPCODE NOT = MQCC-OK AND
               OUT-REASON NOT = MQRC-ALREADY-CONNECTED
               MOVE 12 TO BANK-RETURN-CODE
           END-IF
           GOBACK.
`,
    );

    expect(findings).toEqual([]);
  });

  /**
   * The four shapes a transaction can answer the commarea in. Each is one
   * statement away from the finding above, which is what the rule has to be
   * able to tell apart.
   */
  it.each([
    ["a MOVE into a field of it", "MOVE 100 TO BALANCE OF ENQUIRY-COMMAREA"],
    ["a condition set on it", "SET OUTCOME-FOUND OF ENQUIRY-COMMAREA TO TRUE"],
    ["a COMPUTE into it", "COMPUTE BALANCE OF ENQUIRY-COMMAREA = 1 + 2"],
    [
      "an SQL fetch into it",
      "EXEC SQL SELECT BALANCE INTO :BALANCE OF ENQUIRY-COMMAREA FROM ACCOUNT END-EXEC",
    ],
  ])("%s", (_name, statement) => {
    const findings = lintZos(
      "y.cbl",
      `       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  LK-BALANCE  PIC S9(9).

       PROCEDURE DIVISION.
       ACCOUNT-ENQUIRY.
           MOVE DFHCOMMAREA TO ENQUIRY-COMMAREA
           ${statement}
           MOVE ENQUIRY-COMMAREA TO DFHCOMMAREA
           CONTINUE.
`,
    );

    expect(formatZosFindings(findings)).toBe("No z/OS semantics findings.\n");
  });

  /**
   * A transaction that answers through a queue, a file or a `RETURN TRANSID`
   * writes no commarea and is not this rule's business. Reporting it would be
   * reporting the language for having more than one way out.
   */
  it("a transaction that never writes the commarea back", () => {
    const findings = lintZos(
      "y.cbl",
      `       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  LK-BALANCE  PIC S9(9).

       PROCEDURE DIVISION.
       ACCOUNT-ENQUIRY.
           MOVE DFHCOMMAREA TO ENQUIRY-COMMAREA
           EXEC CICS RETURN TRANSID("ENQ2") COMMAREA(NEXT-STEP) END-EXEC
           CONTINUE.
`,
    );

    expect(findings).toEqual([]);
  });

  /** A batch program has no commarea and no queue manager. */
  it("a program with neither", () => {
    const { emit } = compileExample("examples/account-transfer");
    expect(lintZos("x.cbl", emit.cobol)).toEqual([]);
  });

  /** A copybook is a layout. It cannot hold a defect about run-time behaviour. */
  it("a copybook, whatever is in it", () => {
    expect(lintZos("x.cpy", UNANSWERED_COMMAREA)).toEqual([]);
  });
});

/**
 * The reconstruction the rules stand on.
 *
 * Every rule here asks a question that spans a wrap, so a bug in the statement
 * reader makes each of them quietly answer about half a statement. Asserted
 * against the emitter's real output rather than against a fixture written to
 * fit, because the wrap column is the emitter's decision and not this file's.
 */
describe("reading emitted COBOL as statements", () => {
  const { emit } = compileExample("examples/mq-request-reply");
  const statements = procedureStatements(emit.cobol);

  it("joins a wrapped CALL back into one statement", () => {
    const connects = statements.filter((statement) =>
      statement.text.startsWith('CALL "MQCONN"'),
    );
    checked(connects.length, 2, "MQCONN calls");
    for (const connect of connects) {
      // Four operands, and the emitter wraps before the last two.
      expect(callOperands(connect)).toHaveLength(4);
    }
  });

  it("joins a wrapped condition back into one statement", () => {
    const tolerant = statements.filter(
      (statement) =>
        statement.text.startsWith("IF ") &&
        statement.text.includes("MQRC-ALREADY-CONNECTED"),
    );
    checked(tolerant.length, 2, "tolerant MQCONN tests");
    for (const test of tolerant) {
      expect(test.text).toContain("MQCC-OK");
    }
  });

  it("keeps an EXEC block whole", () => {
    const { emit: enquiry } = compileExample("examples/online-enquiry");
    const sql = procedureStatements(enquiry.cobol).filter((statement) =>
      statement.text.startsWith("EXEC SQL SELECT"),
    );
    checked(sql.length, 1, "SQL statements");
    expect(sql[0]!.text).toContain("END-EXEC");
    expect(sql[0]!.text).toContain("WHERE");
  });
});

describe("everything this repository ships", () => {
  it("does what it says on z/OS", () => {
    const findings = lintZosAll(process.cwd());

    expect(formatZosFindings(findings)).toBe("No z/OS semantics findings.\n");
  });

  /**
   * The lane reads what it claims to read. Reporting nothing because there is
   * nothing wrong and reporting nothing because the artifacts never arrived
   * are the same output, and only one of them is a check.
   */
  it("reads a procedure division in every program", () => {
    let programs = 0;
    for (const { example, cobol } of corpus()) {
      const statements = procedureStatements(cobol);
      expect(statements.length, `${example} has no statements`).toBeGreaterThan(
        5,
      );
      programs += 1;
    }
    checked(programs, 19, "generated programs");
  });
});

describe("the rule list", () => {
  it("has an entry for every rule the pass can report", () => {
    const findings = [
      ...lintZos("x.cbl", PAIRED_CONNECTS),
      ...lintZos("y.cbl", UNANSWERED_COMMAREA),
    ];

    expect(new Set(findings.map((finding) => finding.rule))).toEqual(
      new Set(ZOS_RULES),
    );
  });
});
