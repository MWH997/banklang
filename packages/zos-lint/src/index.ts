/**
 * A checker that reads generated artifacts and asks what z/OS will do with them.
 *
 * This is a different question from the one `packages/conformance-lint` asks,
 * and the 2026-08-07 audit exists because nothing was asking it. Every check
 * this repository had answers "will the toolchain accept this": the conformance
 * linter reads house style and the Language Reference's limits, `cobc` reads
 * syntax, and the differential runtime reads arithmetic. All three pass on a
 * program that compiles cleanly, binds cleanly, and then aborts on its second
 * `MQCONN` — or computes a balance and returns the caller's own request
 * unchanged.
 *
 * Both of those shipped. Neither was a syntax error, a style violation or a
 * wrong number; each was a correct-looking program that does something other
 * than what its source says, on a platform this repository cannot run. So the
 * rules here are about **behaviour on the target**, they cite the manual that
 * describes that behaviour, and they read the emitted text rather than the
 * emitter — because a check written from the same belief as the emitter agrees
 * with the emitter, including where the emitter is wrong.
 *
 * Seeded with the two defects the audit found and meant to grow. A rule arrives
 * here when something is discovered that runs, and is wrong.
 *
 * Manuals, as extracted in `vendor-docs/`:
 *   MQ     IBM MQ for z/OS Application Programming Reference
 *   CICS   CICS TS for z/OS: Developing CICS Applications
 */

import {
  callOperands,
  calledProgram,
  procedureStatements,
  verbOf,
  withoutLiterals,
  type Statement,
} from "./statements";

/**
 * Every rule this pass can report, as a list rather than as whatever the source
 * happens to contain.
 *
 * Exported for the same reason `CONFORMANCE_RULES` is: a rule is a promise, and
 * `docs/target-conformance.md` names one against each behaviour it documents.
 * A page naming a rule that does not exist reads as a check and is nothing.
 */
export const ZOS_RULES = [
  "mq-connection-per-manager",
  "mq-already-connected",
  "cics-commarea-answered",
] as const;

export type ZosRule = (typeof ZOS_RULES)[number];

export interface ZosFinding {
  /** Artifact the finding is in, as the caller named it. */
  file: string;
  /** 1-based line, so an editor and a compiler listing agree. */
  line: number;
  rule: ZosRule;
  message: string;
  /** Manual and section the behaviour comes from. */
  citation: string;
}

/**
 * Read one artifact.
 *
 * COBOL only. A copybook is a record layout with no procedure division and JCL
 * is not a program, so neither can hold any of these defects; a `.jcl` is
 * handed to the conformance linter, which has rules for it.
 */
export function lintZos(file: string, text: string): ZosFinding[] {
  if (!file.endsWith(".cbl")) {
    return [];
  }
  const statements = procedureStatements(text);
  if (statements.length === 0) {
    return [];
  }
  return [
    ...mqConnections(file, statements),
    ...cicsCommareaAnswered(file, text, statements),
  ];
}

/** One MQI connect, and what the program does around it. */
interface MqConnect {
  statement: Statement;
  /** The field holding the queue manager name, which is operand 1. */
  managerField: string;
  /** The connection handle the call fills in, which is operand 2. */
  handle: string;
  /** The completion code the call sets, which is operand 3. */
  compCode: string;
  /** The name moved into `managerField` before the call, if it is a literal. */
  manager: string | null;
}

/**
 * Two rules about `MQCONN`, both from the same usage note.
 *
 * IBM's Application Programming Reference, MQCONN, usage note 3: "If an
 * application is not sure whether it is connected to the queue manager, the
 * application can safely issue an MQCONN call to obtain a connection handle. If
 * the application is already connected, the handle returned is the same as that
 * returned by the previous MQCONN call, but with completion code MQCC_WARNING
 * and reason code MQRC_ALREADY_CONNECTED."
 *
 * Two things follow, and this compiler got both wrong. A second connection to
 * one queue manager does not exist — the handle you are given back is the one
 * you already had — so a program that keeps two handles for one manager is
 * keeping the same handle twice and will disconnect the first while the second
 * is still in use. And a completion-code test that treats `MQCC_WARNING` as
 * failure aborts a program that is connected and working, which is what
 * `examples/mq-request-reply` did on its second queue: RC 12 before it read a
 * message.
 */
function mqConnections(file: string, statements: Statement[]): ZosFinding[] {
  const connects = mqConnects(statements);
  if (connects.length === 0) {
    return [];
  }

  const findings: ZosFinding[] = [];
  const handles = new Map<string, string>();

  for (const connect of connects) {
    if (connect.manager !== null) {
      const first = handles.get(connect.manager);
      if (first === undefined) {
        handles.set(connect.manager, connect.handle);
      } else if (first !== connect.handle) {
        findings.push({
          file,
          line: connect.statement.line,
          rule: "mq-connection-per-manager",
          message: `MQCONN opens ${connect.handle} on queue manager ${connect.manager}, which is already held by ${first}. A second connection to one queue manager returns the handle the first call returned, so these are one handle under two names — and the first MQDISC ends both.`,
          citation: 'MQ, "MQCONN", usage note 3',
        });
      }
    }

    const test = compCodeTest(statements, connect);
    if (test && !/\bMQRC-ALREADY-CONNECTED\b/.test(test.text)) {
      findings.push({
        file,
        line: test.line,
        rule: "mq-already-connected",
        message: `The test after MQCONN treats every completion code but MQCC-OK as failure. A caller that has already connected gets MQCC-WARNING with MQRC-ALREADY-CONNECTED and a working handle, so this stops a program that is connected.`,
        citation: 'MQ, "MQCONN", usage note 3',
      });
    }
  }

  return findings;
}

/**
 * Every `CALL "MQCONN"` in the artifact, with the queue manager it names.
 *
 * The name is a field rather than a literal — `MQCONN` takes an `MQCHAR48` — so
 * it is resolved back to the last literal moved into that field before the
 * call. A field with no literal move before it is left null: a manager name
 * read from a parameter is a program this rule cannot answer for, and guessing
 * would report the shape rather than the defect.
 */
function mqConnects(statements: Statement[]): MqConnect[] {
  const connects: MqConnect[] = [];

  statements.forEach((statement, index) => {
    if (calledProgram(statement) !== "MQCONN") {
      return;
    }
    const operands = callOperands(statement);
    if (operands.length < 3) {
      return;
    }
    connects.push({
      statement,
      managerField: operands[0]!,
      handle: operands[1]!,
      compCode: operands[2]!,
      manager: literalMovedTo(statements, index, operands[0]!),
    });
  });

  return connects;
}

/** The last literal moved into a field before a statement, if there is one. */
function literalMovedTo(
  statements: Statement[],
  before: number,
  field: string,
): string | null {
  const move = new RegExp(
    `^MOVE\\s+"([^"]*)"\\s+TO\\s+${escape(field)}\\s*\\.?$`,
  );
  for (let index = before - 1; index >= 0; index -= 1) {
    const match = move.exec(statements[index]!.text);
    if (match) {
      return match[1]!;
    }
  }
  return null;
}

/**
 * How far after an `MQCONN` its completion code may be tested.
 *
 * The emitter writes the test immediately, with at most a status field moved
 * out of the way first. A window rather than "the next statement" so that an
 * extra `MOVE` does not silence the rule, and bounded so that a test belonging
 * to a later call is not read as this one's.
 */
const COMPCODE_WINDOW = 4;

/** The statement that tests an `MQCONN`'s completion code, if one does. */
function compCodeTest(
  statements: Statement[],
  connect: MqConnect,
): Statement | null {
  const at = statements.indexOf(connect.statement);
  const field = new RegExp(`\\b${escape(connect.compCode)}\\b`);
  for (
    let index = at + 1;
    index < Math.min(at + 1 + COMPCODE_WINDOW, statements.length);
    index += 1
  ) {
    const statement = statements[index]!;
    if (
      verbOf(statement) === "IF" &&
      field.test(statement.text) &&
      /\bMQCC-OK\b/.test(statement.text)
    ) {
      return statement;
    }
  }
  return null;
}

/**
 * A CICS transaction has to answer through the communication area it was given.
 *
 * The CICS Developing Applications guide, "Passing data to other programs by
 * using COMMAREA": "When a communication area is passed by using a LINK
 * command, the invoked program is passed a pointer to the communication area
 * itself. Any changes made to the contents of the data area in the invoked
 * program are available to the invoking program, when control returns to it."
 *
 * That storage is the only thing the caller gets back, and the audit found
 * `examples/online-enquiry` returning it untouched: the transaction computed a
 * balance into a second record, moved the record it had been *given* back into
 * `DFHCOMMAREA`, and the balance never left working storage. It compiled, it
 * bound, it ran, and the enquiry answered with the question.
 *
 * `BANK-CICS-005` refuses that shape in the source. This is the same rule read
 * off the artifact, which is what catches it arriving by some other route —
 * from a copybook-imported layout, or from a future emitter that picks the
 * record differently.
 *
 * **Only the record that goes back is checked.** A transaction that answers
 * through a file, a queue or a `RETURN TRANSID` commarea writes no
 * `MOVE … TO DFHCOMMAREA` and is not this rule's business.
 *
 * **The early exit is not a finding.** A generated transaction jumps to its
 * exit paragraph when a called paragraph sets the failure code, which skips the
 * write-back — and that path ends in `EXEC CICS ABEND`, where the task is
 * ending and the caller reads nothing. Reporting it would be reporting the
 * abend path for not filling in an answer nobody receives.
 */
function cicsCommareaAnswered(
  file: string,
  text: string,
  statements: Statement[],
): ZosFinding[] {
  if (!/^\s+01\s+DFHCOMMAREA\b/m.test(text)) {
    return [];
  }

  const findings: ZosFinding[] = [];
  for (const statement of statements) {
    const back = /^MOVE\s+([A-Z0-9-]+)\s+TO\s+DFHCOMMAREA\s*\.?$/.exec(
      statement.text,
    );
    if (!back) {
      continue;
    }
    const record = back[1]!;
    if (statements.some((other) => writes(other, record))) {
      continue;
    }
    findings.push({
      file,
      line: statement.line,
      rule: "cics-commarea-answered",
      message: `${record} goes back through DFHCOMMAREA and nothing in this program writes to it, so the caller is returned the communication area it passed in. Whatever this transaction computed stays in working storage.`,
      citation: 'CICS, "Passing data to other programs by using COMMAREA"',
    });
  }
  return findings;
}

/** True where a statement stores into `record` or into a field of it. */
function writes(statement: Statement, record: string): boolean {
  // The inbound copy, which is how the record got its value in the first place
  // and is not the transaction answering.
  if (
    new RegExp(`^MOVE\\s+DFHCOMMAREA\\s+TO\\s+${escape(record)}\\b`).test(
      statement.text,
    )
  ) {
    return false;
  }
  return new RegExp(`\\b${escape(record)}\\b`).test(receiving(statement));
}

/**
 * The part of a statement holding the items it stores into.
 *
 * A substring rather than a list of names, because every rule here asks only
 * whether one particular record is among them, and splitting `CA-BALANCE OF
 * ENQUIRY-COMMAREA, CA-OUTCOME OF ENQUIRY-COMMAREA` into operands correctly is
 * work that buys nothing.
 *
 * A verb that is not here contributes nothing, which makes an unrecognised
 * statement read as though it stores nowhere. That is the direction to fail in:
 * the rules above report when they find no write, so a verb this table misses
 * produces a finding somebody reads rather than a silence nobody does.
 */
function receiving(statement: Statement): string {
  const text = withoutLiterals(statement.text);
  const rest = text.slice(verbOf(statement).length);

  switch (verbOf(statement)) {
    case "MOVE":
      return after(rest, /\bTO\b/);
    // `SET x TO TRUE` and `SET index TO n` both store into what precedes TO.
    case "SET":
      return before(rest, /\bTO\b/);
    case "COMPUTE":
      return before(rest, /=/);
    case "ADD":
      return after(rest, /\bGIVING\b/) || after(rest, /\bTO\b/);
    case "SUBTRACT":
      return after(rest, /\bGIVING\b/) || after(rest, /\bFROM\b/);
    case "MULTIPLY":
      return after(rest, /\bGIVING\b/) || after(rest, /\bBY\b/);
    case "DIVIDE":
      return after(rest, /\bGIVING\b/) || after(rest, /\bINTO\b/);
    case "INITIALIZE":
      return rest;
    case "STRING":
    case "UNSTRING":
    case "READ":
    case "RETURN":
    case "XML":
    case "JSON":
      return after(rest, /\bINTO\b/);
    case "INSPECT":
      return before(rest, /\b(?:TALLYING|REPLACING|CONVERTING)\b/);
    case "ACCEPT":
      return before(rest, /\bFROM\b/);
    // Every operand is BY REFERENCE unless the call says otherwise, so a
    // called program may store into any of them.
    case "CALL":
      return after(rest, /\bUSING\b/);
    case "PERFORM":
      return before(after(rest, /\bVARYING\b/), /\bFROM\b/);
    // SQL stores through `INTO :host-variable`; CICS through `INTO`, `SET`,
    // `RESP` and the commarea of a LINK. Neither is COBOL and neither is worth
    // parsing here: an EXEC block names few enough items that reading all of
    // them as stored-into costs one rule its precision on a shape the emitter
    // does not produce.
    case "EXEC":
      return rest;
    default:
      return "";
  }
}

/** The text after the first match, or "" where there is none. */
function after(text: string, marker: RegExp): string {
  const match = marker.exec(text);
  return match ? text.slice(match.index + match[0].length) : "";
}

/** The text before the first match, or all of it where there is none. */
function before(text: string, marker: RegExp): string {
  const match = marker.exec(text);
  return match ? text.slice(0, match.index) : text;
}

/** A COBOL name as a literal inside a regular expression. */
function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Findings as a report, in the shape the conformance linter's takes. */
export function formatZosFindings(findings: readonly ZosFinding[]): string {
  if (findings.length === 0) {
    return "No z/OS semantics findings.\n";
  }
  return `${findings
    .map(
      (finding) =>
        `${finding.file}:${String(finding.line)}: ${finding.rule}: ${finding.message} [${finding.citation}]`,
    )
    .join("\n")}\n`;
}
