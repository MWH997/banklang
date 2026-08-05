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
  IRStatement,
  IRTransaction,
  IRFile,
} from "../../ir/src/index";

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
  }

  for (const file of program.files) {
    diagnostics.push(...checkFileStatus(file));
  }

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

  if (!postsInsideLoop || checkpointed) {
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
      message: `Transaction ${transaction.name} posts to the ledger inside a loop with no checkpoint.`,
      span: transaction.span,
      hint: "A rerun after a mid-stream failure starts again from the beginning. Add `checkpoint <file> from <record> every <n>;` inside the loop, or confirm the job is rerunnable another way.",
      backendProfile: null,
    }),
  ];
}

/** True when a statement is a loop whose body posts to the ledger. */
function loopPosts(statement: IRStatement): boolean {
  switch (statement.kind) {
    case "WhileStatement":
    case "ForEachStatement":
    case "CursorLoopStatement":
      return flattenStatements(statement.body.statements).some(
        (inner) => inner.kind === "LedgerStatement",
      );
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
 */
function flattenStatements(statements: IRStatement[]): IRStatement[] {
  const flattened: IRStatement[] = [];
  for (const statement of statements) {
    flattened.push(statement);
    switch (statement.kind) {
      case "IfStatement":
        flattened.push(...flattenStatements(statement.thenBranch.statements));
        if (statement.elseBranch) {
          flattened.push(...flattenStatements(statement.elseBranch.statements));
        }
        break;
      case "WhileStatement":
      case "ForEachStatement":
      case "CursorLoopStatement":
        flattened.push(...flattenStatements(statement.body.statements));
        break;
      case "SearchStatement":
        flattened.push(...flattenStatements(statement.body.statements));
        flattened.push(...flattenStatements(statement.notFound.statements));
        break;
      case "FileStatement":
        if (statement.atEndOfPage) {
          flattened.push(
            ...flattenStatements(statement.atEndOfPage.statements),
          );
        }
        break;
      case "SerializeStatement":
      case "XmlParseStatement":
        if (statement.onError) {
          flattened.push(...flattenStatements(statement.onError.statements));
        }
        break;
      case "SortStatement":
        for (const procedure of [
          statement.inputProcedure,
          statement.outputProcedure,
        ]) {
          if (procedure) {
            flattened.push(...flattenStatements(procedure.body.statements));
          }
        }
        break;
      case "SwitchStatement":
        for (const branch of statement.cases) {
          flattened.push(...flattenStatements(branch.body.statements));
        }
        if (statement.otherwise) {
          flattened.push(...flattenStatements(statement.otherwise.statements));
        }
        break;
      default:
        break;
    }
  }

  return flattened;
}

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
