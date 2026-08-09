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
 *
 * ## Why the accounting is by kind and not by key
 *
 * Two questions decide every report: which names does this statement read, and
 * which blocks does it run. The first version answered the second by looking up
 * `body`, `notFound`, `onError` and four more names on the statement object,
 * and answered the first for the nine statement kinds that had come up. Both
 * are the same mistake, and mutation testing found it from the other end: a
 * statement kind nobody thought of is silently a statement with no blocks and
 * no uses, and the rule quietly stops applying to it.
 *
 * It had stopped applying to five. `write trail from line` — the stale record
 * posted straight back out, which is the defect this whole check exists for —
 * was not a use. Neither was `release line` into a sort, `put feedQueue from
 * line` onto a queue, `call "SUB" using line`, nor the `on page` block of a
 * write, which was not walked at all.
 *
 * So the blocks come from `childBlocks`, the IR's own exhaustive accounting of
 * them, and what a statement reads comes from `expressionsOf` and
 * `namesUsedBy` — exhaustive switches over `IRStatement` with no `default`. A
 * new statement kind does not compile until somebody has said what it reads.
 */

import {
  createDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import { childBlocks } from "../../ir/src/index";
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

function names(expression: IRExpression): Set<string> {
  const found = new Set<string>();
  namesIn(expression, found);
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
  expression: IRExpression,
  into = new Set<string>(),
): Set<string> {
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

/**
 * The expressions one statement evaluates itself, not counting its blocks.
 *
 * Exhaustive over `IRStatement`, with no `default`: the return type is not
 * nullable, so a kind nobody has classified does not compile. That is the point
 * — the version with a `default` silently exempted `serialize`, `call using`
 * and every cursor argument from a rule that is supposed to hold everywhere.
 */
function expressionsOf(statement: IRStatement): IRExpression[] {
  switch (statement.kind) {
    case "AssignStatement":
      return [statement.target, statement.expression];
    case "LetStatement":
      return [statement.initializer];
    case "ReturnStatement":
      return [statement.expression];
    case "ExpressionStatement":
      return [statement.expression];
    case "ReturnCodeStatement":
      return [statement.value];
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
    case "DliStatement":
    case "CicsStatement":
      return statement.key ? [statement.key] : [];
    case "SplitStatement":
      return [statement.source, statement.delimiter, ...statement.targets];
    case "SerializeStatement":
      // `source` is what is being written out, `target` where it lands, and a
      // JSON GENERATE of the record a read left behind publishes it.
      return [
        statement.target,
        statement.source,
        ...(statement.count ? [statement.count] : []),
      ];
    case "XmlParseStatement":
      return [
        statement.source,
        ...statement.bindings.map((binding) => binding.target),
      ];
    case "ProgramCallStatement":
      // `using` hands the record to another program, which is the same defect
      // one call frame further away.
      return [statement.program, ...(statement.using ? [statement.using] : [])];
    case "SqlStatement":
      return statement.args;
    case "CursorLoopStatement":
      return [...statement.args, ...(statement.start ? [statement.start] : [])];
    case "SearchStatement":
      return [statement.condition];
    case "IfStatement":
    case "WhileStatement":
      // Walked by their own cases, which have the branch and loop merges.
      return [];
    case "SwitchStatement":
      // The subject, likewise: its case observes it before the branches.
      return [];
    case "ForEachStatement":
    case "UnitOfWorkStatement":
    case "ReportStatement":
    case "QueueStatement":
    case "SortStatement":
    case "ReleaseStatement":
    case "CheckpointStatement":
    case "RestartStatement":
    case "ResetStatement":
    case "RaiseStatement":
      return [];
  }
}

/**
 * Records a statement reads *by name* rather than through an expression.
 *
 * COBOL moves whole records around by naming them, and BankTS keeps that: a
 * `write` says which record it is writing, a `release` says which one it is
 * handing to the sort. None of those is an expression, so none of them was
 * seen — and `read feedIn into line; write trail from line;` is the exact
 * shape of the defect the rule was written for. It reported nothing.
 *
 * Only the ones that genuinely *read* the record. A `read ... into line` and a
 * `get` from a queue fill it, and calling that a use would refuse the idiom
 * that replaces the stale bytes rather than trusting them.
 */
function namesUsedBy(statement: IRStatement): string[] {
  switch (statement.kind) {
    case "FileStatement":
      return (statement.operation === "write" ||
        statement.operation === "rewrite") &&
        statement.recordName
        ? [statement.recordName]
        : [];
    case "QueueStatement":
      return statement.operation === "put" && statement.recordName
        ? [statement.recordName]
        : [];
    case "DliStatement":
      return (statement.operation === "insertSegment" ||
        statement.operation === "replaceSegment") &&
        statement.recordName
        ? [statement.recordName]
        : [];
    case "CicsStatement":
      // `link` passes the commarea to the linked program and gets it back;
      // the write commands send it. A `readFile` or `readQueue` fills it.
      return (statement.operation === "link" ||
        statement.operation === "writeFile" ||
        statement.operation === "rewriteFile" ||
        statement.operation === "writeQueue") &&
        statement.commarea
        ? [statement.commarea]
        : [];
    case "ReleaseStatement":
      return [statement.recordName];
    case "CheckpointStatement":
      return [statement.recordName];
    case "ForEachStatement":
    case "SearchStatement":
      // The table being walked lives in a record, and walking the one a read
      // left behind reads it. `arrayTargetName` rather than `arrayRecordName`:
      // the second is the record's *type*, which is what the generated COBOL
      // qualifies by and is never the name the program used.
      return [statement.arrayTargetName];
    case "SqlStatement":
      // `intoRecord` is filled by the fetch, not read by it.
      return [];
    case "RestartStatement":
    case "ResetStatement":
      // Both fill the record rather than read it.
      return [];
    case "AssignStatement":
    case "LetStatement":
    case "ReturnStatement":
    case "ExpressionStatement":
    case "ReturnCodeStatement":
    case "LedgerStatement":
    case "AuditStatement":
    case "ConsoleStatement":
    case "SplitStatement":
    case "SerializeStatement":
    case "XmlParseStatement":
    case "ProgramCallStatement":
    case "CursorLoopStatement":
    case "IfStatement":
    case "WhileStatement":
    case "SwitchStatement":
    case "UnitOfWorkStatement":
    case "ReportStatement":
    case "SortStatement":
    case "RaiseStatement":
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
  expression: IRExpression,
  span: SourceSpan,
  what: string,
): void {
  apply(walk, state, names(expression), comparedNames(expression), span, what);
}

/**
 * The same, for a record a statement names rather than evaluates.
 *
 * `write trail from line` reads `line` and tests nothing, so it can only ever
 * report.
 */
function observeNames(
  walk: Walk,
  state: State,
  used: string[],
  span: SourceSpan,
  what: string,
): void {
  if (used.length > 0) {
    apply(walk, state, new Set(used), new Set(), span, what);
  }
}

function apply(
  walk: Walk,
  state: State,
  read: Set<string>,
  tested: Set<string>,
  span: SourceSpan,
  what: string,
): void {
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
    for (const expression of expressionsOf(statement)) {
      observe(
        walk,
        state,
        expression,
        statement.span,
        "the record it read is used",
      );
    }
    observeNames(
      walk,
      state,
      namesUsedBy(statement),
      statement.span,
      "the record it read is written out",
    );

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
        // `on page { ... }` runs when the write crossed the footing line, so
        // it is a block that may or may not run and merges like one.
        state = walkNested(walk, state, childBlocks(statement));
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

      case "SwitchStatement": {
        observe(
          walk,
          state,
          statement.subject,
          statement.span,
          "the record it read decides a branch",
        );
        state = walkNested(walk, state, childBlocks(statement));
        break;
      }

      case "RaiseStatement":
      case "ReturnStatement":
        // The path ends. Nothing that was pending is used after it.
        return new Map();

      default:
        state = walkNested(walk, state, childBlocks(statement));
        break;
    }
  }

  return state;
}

/**
 * Walks blocks that may or may not run, from the state at the head.
 *
 * Each from the same incoming state, because they are alternatives rather than
 * a sequence, and the result merged back into the head state — a `for each`
 * body may run zero times and a `not found` branch may not be taken, so
 * anything the head still owed is still owed afterwards.
 */
function walkNested(walk: Walk, state: State, blocks: IRBlock[]): State {
  let after: State | null = null;
  for (const nested of blocks) {
    const branch = walkBlock(walk, nested, clone(state));
    after = after === null ? branch : merge(after, branch);
  }
  return after === null ? state : merge(clone(state), after);
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

  const routine = (name: string, body: IRBlock): void => {
    const end = walkBlock(walk, body, new Map());
    for (const [file, outcome] of end) {
      if (outcome.kind === "pending") {
        report(walk, file, outcome, `${name} ends`, outcome.span);
      }
    }
  };

  for (const transaction of program.transactions) {
    routine(transaction.name, transaction.body);
    // The recovery path, which the body's own walk never reaches: control
    // arrives from a `raise` anywhere inside it, so nothing the body owed is
    // known here and nothing it discharged is either. Walked from scratch, for
    // the operations the handler itself performs — a handler that reads a file
    // and posts what it found owes the same answer the body would.
    if (transaction.failureHandler) {
      routine(
        `${transaction.name}'s failure handler`,
        transaction.failureHandler,
      );
    }
  }

  for (const fn of program.functions) {
    routine(fn.name, fn.body);
  }

  // A file error handler is a `USE AFTER STANDARD ERROR` declarative, which
  // COBOL runs only when the statement had no phrase of its own — and every
  // one of these outcomes has one. So a handler does not discharge them, and
  // its own body is walked like any other routine would be.
  for (const handler of program.fileErrorHandlers) {
    routine(`the ${handler.fileName} error handler`, handler.body);
  }

  return walk.diagnostics;
}
