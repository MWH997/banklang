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
  }
}

function flattenStatements(statements: IRStatement[]): IRStatement[] {
  const flattened: IRStatement[] = [];
  for (const statement of statements) {
    flattened.push(statement);
    if (statement.kind === "IfStatement") {
      flattened.push(...flattenStatements(statement.thenBranch.statements));
      if (statement.elseBranch) {
        flattened.push(...flattenStatements(statement.elseBranch.statements));
      }
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
