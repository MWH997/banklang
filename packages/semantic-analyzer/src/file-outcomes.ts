/**
 * Whether a program handled what its file operations actually did.
 *
 * Every generated I/O statement is already followed by a test of the file
 * status, and a status outside class 0 stops the step. That covers the failures
 * — a dataset that is not there, a full volume — and deliberately does not
 * cover the statuses a program is *written* to produce: end of file on a read,
 * a key that was not there on a keyed read or a browse, a duplicate key on a
 * write to a KSDS. Those say the request found nothing rather than that the
 * file is broken, so the generated check lets them through for the program to
 * branch on.
 *
 * The gap is what happens when the program does not. A sequential `read` at end
 * of file leaves the record area holding the record before it, and a program
 * that carries on posts the last transaction twice. That is not a hypothetical:
 * it is the defect family OpenCBS records five times over, and it is invisible
 * in the job log because the return code is zero.
 *
 * ## The property
 *
 * An operation whose expected statuses are non-empty leaves an **unhandled
 * outcome** on its file. The fact is discharged by looking: a condition that
 * reads that file's status — an `if`, a `while`, a `switch` subject — tells the
 * program which of the outcomes happened. The fact is a defect if, while it is
 * still outstanding, the program
 *
 * - uses the record the operation filled, or
 * - performs another operation on the same file, or
 * - reaches the end of the routine.
 *
 * Deliberately not "tested immediately". The idiomatic drain loop tests the
 * status in the loop condition, which is a test and discharges the fact —
 * requiring an `if` after every `read` would reject the form the language
 * reference itself teaches. Equally deliberately, a mere *mention* of the
 * status is not enough on its own: it has to be in a condition, because
 * `log "STATUS " feedStatus;` observes nothing.
 *
 * ## Why a walk and not a scan
 *
 * The other checks in this package flatten the statement tree and look at the
 * list. That cannot answer this question: `read` then `if status` is safe and
 * `if status` then `read` is not, and both flatten to the same two statements.
 * BankTS has no `goto`, so its control flow is a tree — an `if` with two
 * branches, a `while` whose body may run zero times — and a recursive walk that
 * merges the states at each join is a sound flow analysis over it without an
 * explicit graph. The merge is the conservative one: a fact is discharged after
 * a branch only if every path through it discharged it.
 */

import {
  createDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import type {
  IRBlock,
  IRExpression,
  IRFile,
  IRFileStatement,
  IRProgram,
  IRStatement,
} from "../../ir/src/index";

/** What a file's last operation left behind. */
type Outcome =
  | { kind: "clean" }
  | {
      kind: "pending";
      /** The operation, for the message. */
      operation: string;
      /** The record it filled, whose use before the test is the defect. */
      recordName: string | null;
      /** Statuses the program is expected to branch on. */
      expected: string[];
      span: SourceSpan;
    };

const CLEAN: Outcome = { kind: "clean" };

/** File state at a point in the program, by file name. */
type State = Map<string, Outcome>;

/**
 * The statuses an operation produces that the generated check lets through.
 *
 * The same table the backend emits its check from, read the same way: an
 * operation with an empty list has no outcome the program is left to handle,
 * because anything other than success already stopped the step.
 */
export function programHandledStatuses(statement: IRFileStatement): string[] {
  const indexed = statement.fileOrganization === "indexed";
  switch (statement.operation) {
    case "read":
    case "readNext":
      return [indexed ? "23" : "10"];
    case "start":
      return ["23"];
    case "write":
      return indexed ? ["22"] : [];
    case "rewrite":
      return indexed ? ["23"] : [];
    case "delete":
      return ["23"];
    case "open":
    case "close":
      return [];
  }
}

function describeStatuses(expected: string[]): string {
  const meaning: Record<string, string> = {
    "10": "end of file",
    "22": "a duplicate key",
    "23": "no such record",
  };
  return expected
    .map((code) => `${code} (${meaning[code] ?? "an expected outcome"})`)
    .join(" or ");
}

/**
 * Every name a condition reads, so a test of a status can be recognised.
 *
 * Names rather than a resolved symbol: a file status is a declared field whose
 * name is unique in the program, which is what `BANK-FILE-012` and
 * `BANK-FILE-016` between them keep true.
 */
function namesIn(expression: IRExpression, into: Set<string>): void {
  switch (expression.kind) {
    case "Identifier":
      into.add(expression.name);
      return;
    case "MemberAccess":
      into.add(expression.member);
      into.add(expression.targetName);
      return;
    case "BinaryComparison":
    case "BinaryArithmetic":
    case "Logical":
      namesIn(expression.left, into);
      namesIn(expression.right, into);
      return;
    case "Not":
    case "Rounded":
    case "NullableCheck":
      namesIn(expression.operand, into);
      return;
    case "IndexAccess":
      namesIn(expression.target, into);
      namesIn(expression.index, into);
      return;
    case "TemporalCall":
    case "NumericCall":
    case "StringCall":
    case "Call":
      for (const argument of expression.args) {
        namesIn(argument, into);
      }
      return;
    default:
      return;
  }
}

function names(expression: IRExpression | null | undefined): Set<string> {
  const found = new Set<string>();
  if (expression) {
    namesIn(expression, found);
  }
  return found;
}

/**
 * Names that appear as an operand of a comparison.
 *
 * A status is *tested* when it is compared with something, and merely mentioned
 * when it is not: `log "STATUS " feedStatus;` observes nothing and must not
 * discharge an outcome, or the check would be satisfied by printing the answer
 * and ignoring it. `let ok = feedStatus == "00";` is a test wherever it is
 * written, which is why this looks for the comparison rather than for an `if`.
 */
function comparedNames(
  expression: IRExpression | null | undefined,
  into = new Set<string>(),
): Set<string> {
  if (!expression) {
    return into;
  }
  if (expression.kind === "BinaryComparison") {
    namesIn(expression.left, into);
    namesIn(expression.right, into);
    return into;
  }
  if (expression.kind === "NullableCheck") {
    namesIn(expression.operand, into);
    return into;
  }
  for (const child of childrenOf(expression)) {
    comparedNames(child, into);
  }
  return into;
}

function childrenOf(expression: IRExpression): IRExpression[] {
  switch (expression.kind) {
    case "BinaryComparison":
    case "BinaryArithmetic":
    case "Logical":
      return [expression.left, expression.right];
    case "Not":
    case "Rounded":
    case "NullableCheck":
      return [expression.operand];
    case "IndexAccess":
      return [expression.target, expression.index];
    case "TemporalCall":
    case "NumericCall":
    case "StringCall":
    case "Call":
      return expression.args;
    default:
      return [];
  }
}

/** The expressions one statement evaluates itself, not counting its blocks. */
function ownExpressions(statement: IRStatement): IRExpression[] {
  switch (statement.kind) {
    case "AssignStatement":
      return [statement.target, statement.expression];
    case "LetStatement":
      return [statement.initializer];
    case "ReturnStatement":
      return [statement.expression];
    case "ExpressionStatement":
      return [statement.expression];
    case "LedgerStatement":
      return [statement.account, statement.amount];
    case "AuditStatement":
      return [statement.eventName, statement.correlation];
    case "ConsoleStatement":
      // A `log` of the status is a mention rather than a test, so it does not
      // discharge anything. It is still a *use*, and a log of the record a read
      // left behind is as wrong as posting it.
      return [
        ...statement.values,
        ...(statement.target ? [statement.target] : []),
      ];
    case "FileStatement":
      return statement.key ? [statement.key] : [];
    case "SplitStatement":
      return [statement.source, statement.delimiter, ...statement.targets];
    default:
      return [];
  }
}

interface Walk {
  program: IRProgram;
  files: Map<string, IRFile>;
  /** Files with a declared status, which is the only kind this can reason about. */
  statuses: Map<string, string>;
  diagnostics: Diagnostic[];
  /** One report per operation, so a loop body is not reported twice. */
  reported: Set<SourceSpan>;
}

function report(
  walk: Walk,
  file: string,
  outcome: Extract<Outcome, { kind: "pending" }>,
  what: string,
  span: SourceSpan,
): void {
  if (walk.reported.has(outcome.span)) {
    return;
  }
  walk.reported.add(outcome.span);
  const status = walk.statuses.get(file) ?? "the file status";
  walk.diagnostics.push(
    createDiagnostic({
      id: "BANK-FILE-017",
      severity: "error",
      message: `${outcome.operation} ${file} can end with status ${describeStatuses(outcome.expected)}, and ${what} without testing ${status}.`,
      span,
      hint: `Branch on ${status} — \`if ${status} == "00" { ... }\`, or a loop whose condition reads it — before using what the ${outcome.operation} left behind.`,
      backendProfile: null,
    }),
  );
}

/** Merges the states two paths arrive with: pending unless both discharged it. */
function merge(left: State, right: State): State {
  const merged: State = new Map(left);
  for (const [file, outcome] of right) {
    const existing = merged.get(file);
    if (!existing || existing.kind === "clean") {
      merged.set(file, outcome);
    }
  }
  return merged;
}

function clone(state: State): State {
  return new Map(state);
}

/**
 * Applies one expression to the state: what it tests, and what it uses.
 *
 * Both at once, because a condition can do both — `if feedStatus == "00" AND
 * account.balance > 0` tests the status and reads the record it filled, and
 * that is safe. So the test is applied first and only a use with no
 * accompanying test is reported.
 */
function observe(
  walk: Walk,
  state: State,
  expression: IRExpression | null | undefined,
  span: SourceSpan,
  what: string,
): void {
  if (!expression) {
    return;
  }
  const read = names(expression);
  const tested = comparedNames(expression);
  for (const [file, outcome] of state) {
    const statusName = walk.statuses.get(file);
    if (statusName !== undefined && tested.has(statusName)) {
      state.set(file, CLEAN);
      continue;
    }
    if (
      outcome.kind === "pending" &&
      outcome.recordName !== null &&
      read.has(outcome.recordName)
    ) {
      report(walk, file, outcome, what, span);
      state.set(file, CLEAN);
    }
  }
}

/**
 * Walks one block, in order, updating the state as it goes.
 *
 * Returns the state at the end of the block. A `raise` or a `return` ends the
 * path, and the state it ends with is the caller's business — an outcome
 * pending at a `raise` is not a defect, because the transaction is abandoning
 * its work rather than carrying on with a stale record.
 */
function walkBlock(walk: Walk, block: IRBlock, incoming: State): State {
  let state = incoming;

  for (const statement of block.statements) {
    // What this statement reads, before it does anything else. Using the
    // record a pending operation filled is the defect the whole check exists
    // for.
    for (const expression of ownExpressions(statement)) {
      observe(
        walk,
        state,
        expression,
        statement.span,
        "the record it read is used",
      );
    }

    switch (statement.kind) {
      case "FileStatement": {
        const outcome = state.get(statement.fileName);
        if (outcome?.kind === "pending") {
          // Any operation on the file overwrites its status, `close` included:
          // COBOL sets the key on every I/O statement, so a test written after
          // the close reads the close's answer rather than the read's.
          report(
            walk,
            statement.fileName,
            outcome,
            statement.operation === "close"
              ? "the file is closed, which overwrites the status"
              : `another ${statement.operation} on the same file follows`,
            statement.span,
          );
        }
        const expected = programHandledStatuses(statement);
        state.set(
          statement.fileName,
          expected.length === 0 || !walk.statuses.has(statement.fileName)
            ? CLEAN
            : {
                kind: "pending",
                operation: statement.operation,
                recordName: statement.recordName,
                expected,
                span: statement.span,
              },
        );
        break;
      }

      case "IfStatement": {
        // The condition is a test. Whatever it reads is discharged on both
        // paths, because the program has looked at it before choosing one —
        // and a condition that reads the *record* without reading the status
        // is the defect, which is why this goes through `observe`.
        observe(
          walk,
          state,
          statement.condition,
          statement.span,
          "the record it read decides a branch",
        );
        const thenState = walkBlock(walk, statement.thenBranch, clone(state));
        const elseState = statement.elseBranch
          ? walkBlock(walk, statement.elseBranch, clone(state))
          : clone(state);
        state = merge(thenState, elseState);
        break;
      }

      case "WhileStatement": {
        observe(
          walk,
          state,
          statement.condition,
          statement.span,
          "the record it read decides a loop",
        );
        // The body may run zero times, so the state after the loop is the
        // merge of "skipped it" and "went round once". Once is enough: a
        // second pass would re-report the same statements.
        const looped = walkBlock(walk, statement.body, clone(state));
        observe(
          walk,
          looped,
          statement.condition,
          statement.span,
          "the record it read decides a loop",
        );
        state = merge(clone(state), looped);
        break;
      }

      case "ForEachStatement":
      case "SearchStatement":
      case "CursorLoopStatement":
      case "UnitOfWorkStatement":
      case "RestartStatement":
      case "QueueStatement":
      case "SortStatement":
      case "SerializeStatement":
      case "XmlParseStatement":
      case "ProgramCallStatement":
      case "SwitchStatement": {
        if (statement.kind === "SwitchStatement") {
          observe(
            walk,
            state,
            statement.subject,
            statement.span,
            "the record it read decides a branch",
          );
        }
        // Every nested block, each from the state at the head, merged after.
        let after: State | null = null;
        for (const nested of nestedBlocks(statement)) {
          const branch = walkBlock(walk, nested, clone(state));
          after = after === null ? branch : merge(after, branch);
        }
        state = after === null ? state : merge(clone(state), after);
        break;
      }

      case "RaiseStatement":
      case "ReturnStatement":
        // The path ends. Nothing that was pending is used after it.
        return new Map();

      default:
        break;
    }
  }

  return state;
}

/** The blocks a statement runs, for the kinds walked as a group above. */
function nestedBlocks(statement: IRStatement): IRBlock[] {
  const blocks: IRBlock[] = [];
  const record = statement as unknown as Record<string, unknown>;
  for (const key of [
    "body",
    "notFound",
    "resumed",
    "fresh",
    "otherwise",
    "onError",
    "atEndOfPage",
  ]) {
    const value = record[key];
    if (value && typeof value === "object" && "statements" in value) {
      blocks.push(value as IRBlock);
    }
  }
  const cases = record["cases"];
  if (Array.isArray(cases)) {
    for (const entry of cases as { body?: IRBlock }[]) {
      if (entry.body) {
        blocks.push(entry.body);
      }
    }
  }
  const inputProcedure = record["inputProcedure"] as { body?: IRBlock } | null;
  const outputProcedure = record["outputProcedure"] as {
    body?: IRBlock;
  } | null;
  if (inputProcedure?.body) {
    blocks.push(inputProcedure.body);
  }
  if (outputProcedure?.body) {
    blocks.push(outputProcedure.body);
  }
  return blocks;
}

/**
 * Reports every file operation whose outcome the program did not handle.
 *
 * Per routine, because a file status is program-wide storage but the reasoning
 * is not: a transaction that reads and tests is not made safe by another one
 * that tests.
 */
export function checkFileOutcomes(program: IRProgram): Diagnostic[] {
  const statuses = new Map<string, string>();
  const files = new Map<string, IRFile>();
  for (const file of program.files) {
    files.set(file.name, file);
    if (file.statusName) {
      statuses.set(file.name, file.statusName);
    }
  }
  if (statuses.size === 0) {
    return [];
  }

  const walk: Walk = {
    program,
    files,
    statuses,
    diagnostics: [],
    reported: new Set<SourceSpan>(),
  };

  for (const routine of [...program.transactions, ...program.functions]) {
    const end = walkBlock(walk, routine.body, new Map());
    for (const [file, outcome] of end) {
      if (outcome.kind === "pending") {
        report(walk, file, outcome, `${routine.name} ends`, outcome.span);
      }
    }
  }

  // A file error handler is a `USE AFTER STANDARD ERROR` declarative, which
  // COBOL runs only when the statement had no phrase of its own — and every
  // one of these outcomes has one. So a handler does not discharge them, and
  // its own body is walked like any other routine would be.
  for (const handler of program.fileErrorHandlers) {
    walkBlock(walk, handler.body, new Map());
  }

  return walk.diagnostics;
}
