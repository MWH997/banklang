import {
  createDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import type {
  IRAuditStatement,
  IRExpression,
  IRLedgerStatement,
  IRProgram,
  IRRoundedExpression,
  IRStatement,
  IRTransaction,
  IRType,
  IRFile,
} from "../../ir/src/index";
import { flattenIRStatements } from "../../ir/src/index";
import {
  divisionRemainderShape,
  MAX_COMPAT_DIGITS,
} from "../../cobol-ir/src/index";

const IDEMPOTENCY_KEY_FIELD = "idempotencyKey";

export interface SemanticAnalysisSummary {
  recordCount: number;
  functionCount: number;
  transactionCount: number;
  auditEventCount: number;
  ledgerPostingCount: number;
  fileCount: number;
}

export interface SemanticAnalysisResult {
  diagnostics: Diagnostic[];
  summary: SemanticAnalysisSummary;
}

/**
 * Banking safety analysis over the lowered IR.
 *
 * These checks implement the transaction, ledger, and audit rules in
 * `language-spec.md` sections 10 and 11, using the diagnostic identifiers
 * catalogued in `banking-safety-spec.md`.
 */
export function analyzeProgramSemantics(
  program: IRProgram,
): SemanticAnalysisResult {
  const diagnostics: Diagnostic[] = [];
  let auditEventCount = 0;
  let ledgerPostingCount = 0;

  for (const transaction of program.transactions) {
    const statements = flattenStatements(transaction.body.statements);
    const auditStatements = statements.filter(
      (statement): statement is IRAuditStatement =>
        statement.kind === "AuditStatement",
    );
    const ledgerStatements = statements.filter(
      (statement): statement is IRLedgerStatement =>
        statement.kind === "LedgerStatement",
    );

    auditEventCount += auditStatements.length;
    ledgerPostingCount += ledgerStatements.length;

    diagnostics.push(...checkIdempotencyKey(transaction));
    diagnostics.push(...checkAuditEvents(transaction, auditStatements));
    diagnostics.push(...checkLedgerBalance(transaction, ledgerStatements));
    diagnostics.push(...checkRestartable(transaction));
    diagnostics.push(...checkHeldCursors(transaction, program));
  }

  for (const file of program.files) {
    diagnostics.push(...checkFileStatus(file));
  }

  diagnostics.push(...checkRoundingIsGeneratable(program));

  return {
    diagnostics,
    summary: {
      recordCount: program.records.length,
      functionCount: program.functions.length,
      transactionCount: program.transactions.length,
      auditEventCount,
      ledgerPostingCount,
      fileCount: program.files.length,
    },
  };
}

/**
 * A batch that posts money inside a loop must record where it got to.
 *
 * The rerun is the point. A job that dies halfway is restarted, and without a
 * position written down it starts at the beginning and posts everything twice.
 * A single posting is a different case: rerunning it is the caller's problem,
 * and the idempotency key is what covers it. A loop is not, because the amount
 * of work already done is not something the caller knows.
 */
function checkRestartable(transaction: IRTransaction): Diagnostic[] {
  const statements = flattenStatements(transaction.body.statements);
  const postsInsideLoop = transaction.body.statements.some((statement) =>
    loopPosts(statement),
  );
  const checkpointed = statements.some(
    (statement) => statement.kind === "CheckpointStatement",
  );
  // Both halves, because a position written down and never read back leaves the
  // rerun starting at the beginning exactly as it would with no checkpoint at
  // all. Accepting the checkpoint alone would let this warning be silenced by
  // the half of the mechanism that does not do anything on its own.
  const restarted = statements.some(
    (statement) => statement.kind === "RestartStatement",
  );

  if (!postsInsideLoop || (checkpointed && restarted)) {
    return [];
  }

  // A warning rather than an error: the compiler cannot tell whether the job is
  // rerunnable by other means — a consumed-and-recreated input, a small enough
  // window, an operator procedure. It reports the hazard it can see and leaves
  // the judgement where the knowledge is.
  return [
    createDiagnostic({
      id: "BANK-FILE-003",
      severity: "warning",
      message: checkpointed
        ? `Transaction ${transaction.name} writes a restart position and never reads one back.`
        : `Transaction ${transaction.name} posts to the ledger inside a loop with no checkpoint.`,
      span: transaction.span,
      hint: checkpointed
        ? "The rerun still starts at the beginning. Add `restart <file> into <record> { ... }` before the loop and resume from the position it finds."
        : "A rerun after a mid-stream failure starts again from the beginning. Add `checkpoint <file> from <record> every <n>;` inside the loop and `restart <file> into <record> { ... }` before it, or confirm the job is rerunnable another way.",
      backendProfile: null,
    }),
  ];
}

/**
 * A commit or a rollback inside a cursor loop, over a cursor that will not
 * survive it.
 *
 * The two are not the same and the Application Programming and SQL Guide is
 * exact about the difference: "A ROLLBACK statement closes all open cursors. A
 * COMMIT statement ... closes cursors that are not declared WITH HOLD and
 * leaves open those cursors that are declared WITH HOLD." So `hold` saves a
 * commit and saves nothing from a rollback — and under CICS the manual says the
 * same again, that "SYNCPOINT ROLLBACK closes all cursors".
 *
 * Either way the next `FETCH` answers `-501`, cursor not open, after the loop
 * has already processed and committed part of the result set.
 *
 * An error rather than a warning, because there is no reading under which the
 * program is right: either the statement does not belong in the loop or the
 * cursor needs `hold`, and for a rollback only the first is available.
 */
function checkHeldCursors(
  transaction: IRTransaction,
  program: IRProgram,
): Diagnostic[] {
  const held = new Map(
    program.sql
      .filter((entry) => entry.form === "cursor")
      .map((entry) => [entry.name, entry.hold]),
  );

  return flattenStatements(transaction.body.statements).flatMap((statement) => {
    if (statement.kind !== "CursorLoopStatement") {
      return [];
    }
    const isHeld = held.get(statement.cursorName) === true;
    const closes = flattenStatements(statement.body.statements).find(
      (inner) =>
        inner.kind === "UnitOfWorkStatement" &&
        // A rollback closes every cursor; a commit closes only the ones that
        // are not held.
        (inner.operation === "rollback" || !isHeld),
    );
    if (!closes || closes.kind !== "UnitOfWorkStatement") {
      return [];
    }

    return [
      createDiagnostic({
        id: "BANK-SQL-008",
        severity: "error",
        message: `Cursor ${statement.cursorName} is ${closes.operation === "commit" ? "committed" : "rolled back"} inside its own loop, which closes it.`,
        span: statement.span,
        hint:
          closes.operation === "rollback"
            ? "A ROLLBACK closes every open cursor, held or not, so the next FETCH answers -501. Move the rollback out of the loop; `hold` does not help here."
            : "Db2 closes a cursor that is not held when the unit of work commits, so the next FETCH answers -501. Declare the cursor `hold`, or move the commit out of the loop.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    ];
  });
}

/**
 * True when a statement is a loop whose body posts to the ledger and whose
 * position a rerun could not work out for itself.
 *
 * A drain off a queue is the exception. An MQ get runs under
 * `MQGMO-SYNCPOINT`, so a message read by a unit of work that never committed
 * goes back on the queue and one read by a unit of work that did is gone: the
 * queue holds the position, and writing a second copy of it into a restart
 * record would be a position that can disagree with the one MQ is keeping.
 */
function loopPosts(statement: IRStatement): boolean {
  switch (statement.kind) {
    case "WhileStatement":
    case "ForEachStatement":
    case "CursorLoopStatement": {
      const inner = flattenStatements(statement.body.statements);
      const drainsAQueue = inner.some(
        (nested) =>
          nested.kind === "QueueStatement" && nested.operation === "get",
      );
      return (
        !drainsAQueue &&
        inner.some((nested) => nested.kind === "LedgerStatement")
      );
    }
    // A loop inside a branch counts too: the money still moves repeatedly.
    case "IfStatement":
      return (
        statement.thenBranch.statements.some(loopPosts) ||
        (statement.elseBranch?.statements.some(loopPosts) ?? false)
      );
    default:
      return false;
  }
}

/**
 * `language-spec.md` section 13: file status must be checked. A declaration
 * without a `status` clause gives the generated COBOL no FILE STATUS field, so
 * the operation result would be unobservable.
 */
function checkFileStatus(file: IRFile): Diagnostic[] {
  if (file.statusName) {
    return [];
  }

  return [
    diagnostic(
      "BANK-FILE-001",
      `File ${file.name} declares no file status field.`,
      file.span,
      `Add a status clause, such as: file ${file.name} ${file.organization} ${file.mode} record ${file.record.name} status ${file.name}Status;`,
    ),
  ];
}

/**
 * `language-spec.md` section 10: a transaction must have an idempotency key.
 * The key is satisfied by a parameter named `idempotencyKey` or by a record
 * parameter that declares such a field.
 */
function checkIdempotencyKey(transaction: IRTransaction): Diagnostic[] {
  const hasKey = transaction.parameters.some((parameter) => {
    if (parameter.name === IDEMPOTENCY_KEY_FIELD) {
      return true;
    }

    return (
      parameter.type.kind === "record" &&
      parameter.type.fields.some(
        (field) => field.name === IDEMPOTENCY_KEY_FIELD,
      )
    );
  });

  if (hasKey) {
    return [];
  }

  return [
    diagnostic(
      "BANK-TXN-001",
      `Transaction ${transaction.name} has no idempotency key.`,
      transaction.span,
      `Add an ${IDEMPOTENCY_KEY_FIELD} field to a record parameter, or take an ${IDEMPOTENCY_KEY_FIELD} parameter directly.`,
    ),
  ];
}

/**
 * `language-spec.md` sections 10 and 11: a transaction must emit at least one
 * audit event, and audit event names must be compile-time constants.
 */
function checkAuditEvents(
  transaction: IRTransaction,
  auditStatements: IRAuditStatement[],
): Diagnostic[] {
  if (auditStatements.length === 0) {
    return [
      diagnostic(
        "BANK-AUD-001",
        `Transaction ${transaction.name} does not emit an audit event.`,
        transaction.span,
        "Add an audit(eventName, correlationKey) statement to the transaction body.",
      ),
    ];
  }

  const diagnostics: Diagnostic[] = [];
  for (const statement of auditStatements) {
    if (statement.eventName.kind !== "StringLiteral") {
      diagnostics.push(
        diagnostic(
          "BANK-AUD-003",
          "Audit event name must be a compile-time string constant.",
          statement.eventName.span,
          'Use a literal event name such as audit("TRANSFER_POSTED", key).',
        ),
      );
    }
  }

  return diagnostics;
}

/**
 * `language-spec.md` section 10: debit and credit totals must balance for
 * ledger-posting operations.
 *
 * The current subset has no runtime evaluation, so balance is proven
 * structurally: the multiset of debited amount expressions must equal the
 * multiset of credited amount expressions. Structural equality is conservative,
 * so it reports rather than silently accepts anything it cannot prove.
 */
function checkLedgerBalance(
  transaction: IRTransaction,
  ledgerStatements: IRLedgerStatement[],
): Diagnostic[] {
  if (ledgerStatements.length === 0) {
    return [];
  }

  const debits = ledgerStatements
    .filter((statement) => statement.operation === "debit")
    .map((statement) => canonicalExpression(statement.amount))
    .sort();
  const credits = ledgerStatements
    .filter((statement) => statement.operation === "credit")
    .map((statement) => canonicalExpression(statement.amount))
    .sort();

  if (
    debits.length === credits.length &&
    debits.every((value, index) => value === credits[index])
  ) {
    return [];
  }

  return [
    diagnostic(
      "BANK-LED-001",
      `Transaction ${transaction.name} does not balance: debited ${describeAmounts(debits)} against credited ${describeAmounts(credits)}.`,
      transaction.span,
      "Post the same amount expressions to the debit and credit sides.",
    ),
  ];
}

function describeAmounts(amounts: string[]): string {
  if (amounts.length === 0) {
    return "nothing";
  }

  return amounts.join(" + ");
}

/**
 * Stable textual form of an expression, used to compare posting amounts without
 * evaluating them.
 */
function canonicalExpression(expression: IRExpression): string {
  switch (expression.kind) {
    case "StringCall":
    case "TemporalCall":
    case "NumericCall":
      return `${expression.operation}(${expression.args.map(canonicalExpression).join(", ")})`;
    case "Identifier":
      return expression.name;
    case "DecimalLiteral":
      return expression.text;
    case "BooleanLiteral":
      return String(expression.value);
    case "StringLiteral":
      return JSON.stringify(expression.value);
    case "MemberAccess":
      return `${expression.targetName}.${expression.member}`;
    case "Logical":
    case "BinaryComparison":
    case "BinaryArithmetic":
      return `(${canonicalExpression(expression.left)} ${expression.operator} ${canonicalExpression(expression.right)})`;
    case "Not":
      return `!${canonicalExpression(expression.operand)}`;
    case "Rounded":
      return `round(${canonicalExpression(expression.operand)}, ${expression.mode})`;
    case "Call":
      return `${expression.callee}(${expression.args.map(canonicalExpression).join(", ")})`;
    case "EnumMember":
      return `${expression.enumName}.${expression.member}`;
    case "IndexAccess":
      return `${canonicalExpression(expression.target)}[${canonicalExpression(expression.index)}]`;
    case "NullableCheck":
      return `${expression.operation}(${canonicalExpression(expression.operand)})`;
  }
}

/**
 * Every statement a body contains, however deeply nested.
 *
 * Descending only into `if` left the banking checks blind to anything in a
 * loop or a `switch` branch: a transaction whose only posting was inside a
 * `while` had, as far as the double-entry check could see, no postings at all,
 * and so balanced trivially. Money moving inside a loop is money moving.
 *
 * The descent itself is `flattenIRStatements`, so the list of statement kinds
 * that hold a block lives in one place. Keeping a copy here is how the MQ get
 * came to be missed by every rule in this file.
 */
const flattenStatements = flattenIRStatements;

function diagnostic(
  id: string,
  message: string,
  span: SourceSpan,
  hint: string,
): Diagnostic {
  return createDiagnostic({
    id,
    severity: "error",
    message,
    span,
    hint,
    backendProfile: null,
  });
}

/**
 * Every rounding the backend can actually generate, and only those.
 *
 * Enterprise COBOL has one rounding phrase — `ROUNDED`, which is half up away
 * from zero — and truncation when it is left off. The other five BankTS modes
 * are generated arithmetic, and generated arithmetic has two preconditions the
 * compiler can check before it emits anything:
 *
 * 1. The rounded value has to be the whole value being stored. COBOL attaches
 *    `ROUNDED` to the receiver, so there is no such thing as rounding a
 *    subexpression; the backend used to render `a + round(b, "UP")` as `a + b`
 *    and lose the rounding entirely, with nothing said.
 * 2. A rounded division is generated from `DIVIDE ... REMAINDER`, and the
 *    remainder has to fit a field. When it does not, the tie test would be run
 *    against a truncated remainder — which is exactly the class of silently
 *    wrong answer this compiler exists to refuse.
 */
function checkRoundingIsGeneratable(program: IRProgram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const check = (
    expression: IRExpression,
    receiver: IRType | null,
    isWholeValue: boolean,
  ): void => {
    if (expression.kind === "Rounded") {
      if (!isWholeValue) {
        diagnostics.push(
          diagnostic(
            "BANK-DEC-006",
            "A rounded value must be the whole value being stored.",
            expression.span,
            "COBOL attaches ROUNDED to the receiving field, so a rounding inside a larger expression has nowhere to attach. Bind it first: `let rounded: decimal<n, s> = round(...);`.",
          ),
        );
      } else {
        diagnostics.push(...checkRoundedDivision(expression, receiver));
      }
    }

    for (const child of childExpressions(expression)) {
      check(child, null, false);
    }
  };

  const walk = (statements: IRStatement[], returnType: IRType | null): void => {
    for (const statement of flattenStatements(statements)) {
      switch (statement.kind) {
        case "LetStatement":
          check(statement.initializer, statement.declaredType, true);
          break;
        case "AssignStatement":
          check(statement.expression, statement.target.resolvedType, true);
          break;
        case "ReturnStatement":
          check(statement.expression, returnType, true);
          break;
        case "ExpressionStatement":
          check(statement.expression, null, false);
          break;
        default:
          break;
      }
    }
  };

  for (const fn of program.functions) {
    walk(fn.body.statements, fn.returnType);
  }
  for (const transaction of program.transactions) {
    walk(transaction.body.statements, null);
    if (transaction.failureHandler) {
      walk(transaction.failureHandler.statements, null);
    }
  }

  return diagnostics;
}

/** The remainder field a generated rounded division needs, and whether it fits. */
function checkRoundedDivision(
  expression: IRRoundedExpression,
  receiver: IRType | null,
): Diagnostic[] {
  if (expression.mode === "HALF_UP" || expression.mode === "DOWN") {
    // Both are phrases COBOL performs itself, so nothing is generated and there
    // is no remainder field to size.
    return [];
  }
  const operand = expression.operand;
  if (operand.kind !== "BinaryArithmetic" || operand.operator !== "/") {
    return [];
  }

  const dividend = numericShape(operand.left.resolvedType);
  const divisor = numericShape(operand.right.resolvedType);
  const target =
    numericShape(receiver) ?? numericShape(expression.resolvedType);
  if (!dividend || !divisor || !target) {
    return [];
  }

  const remainder = divisionRemainderShape(dividend, divisor, target.scale);
  const digits = remainder.integer + remainder.scale;
  if (digits <= MAX_COMPAT_DIGITS) {
    return [];
  }

  return [
    diagnostic(
      "BANK-DEC-006",
      `Rounding this division ${expression.mode} needs a ${digits}-digit remainder, and a numeric item holds ${MAX_COMPAT_DIGITS}.`,
      expression.span,
      `Reduce the divisor's precision or the result's scale. ${expression.mode} is generated from DIVIDE ... REMAINDER, and a remainder that does not fit makes the tie test read truncated digits.`,
    ),
  ];
}

function numericShape(
  type: IRType | null,
): { precision: number; scale: number } | null {
  if (!type) {
    return null;
  }
  if (type.kind === "decimal" || type.kind === "currency") {
    return { precision: type.precision, scale: type.scale };
  }
  if (type.kind === "nullable") {
    return numericShape(type.inner);
  }
  return null;
}

/** Sub-expressions of an expression, for a walk that has to reach all of them. */
function childExpressions(expression: IRExpression): IRExpression[] {
  switch (expression.kind) {
    case "BinaryComparison":
    case "BinaryArithmetic":
    case "Logical":
      return [expression.left, expression.right];
    case "Not":
    case "Rounded":
    case "NullableCheck":
      return [expression.operand];
    case "TemporalCall":
    case "NumericCall":
    case "StringCall":
    case "Call":
      return expression.args;
    case "IndexAccess":
      return [expression.target, expression.index];
    case "MemberAccess":
      return [];
    default:
      return [];
  }
}
