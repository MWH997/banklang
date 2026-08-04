import {
  type BinaryExpressionNode,
  type BooleanLiteralNode,
  type DecimalLiteralNode,
  type ExpressionNode,
  type IdentifierNode,
  type IfStatementNode,
  type LetStatementNode,
  type StatementNode,
  type ReturnStatementNode,
  type SourceSpan,
  type MemberAccessNode,
} from "../../ast/src/index";
import type {
  DecimalType,
  ResolvedField,
  ResolvedFunction,
  ResolvedRecord,
  ResolvedLocal,
  ResolvedTransaction,
  ResolvedType,
  TypeCheckResult,
} from "../../typechecker/src/index";

export interface IRProgram {
  kind: "Program";
  sourceFile: string;
  moduleName: string;
  moduleSpan: SourceSpan;
  records: IRRecord[];
  functions: IRFunction[];
  transactions: IRTransaction[];
}

export interface IRTransaction {
  kind: "Transaction";
  name: string;
  span: SourceSpan;
  parameters: IRParameter[];
  body: IRBlock;
}

export interface IRRecord {
  kind: "Record";
  name: string;
  span: SourceSpan;
  fields: IRField[];
}

export interface IRField {
  kind: "Field";
  name: string;
  span: SourceSpan;
  type: IRType;
}

export interface IRFunction {
  kind: "Function";
  name: string;
  span: SourceSpan;
  parameters: IRParameter[];
  returnType: IRType;
  body: IRBlock;
}

export interface IRParameter {
  kind: "Parameter";
  name: string;
  span: SourceSpan;
  type: IRType;
}

export interface IRBlock {
  kind: "Block";
  span: SourceSpan;
  statements: IRStatement[];
}

export type IRStatement =
  | IRLetStatement
  | IRReturnStatement
  | IRIfStatement
  | IRLedgerStatement
  | IRAuditStatement;

export interface IRLedgerStatement {
  kind: "LedgerStatement";
  span: SourceSpan;
  operation: "debit" | "credit";
  account: IRExpression;
  amount: IRExpression;
}

export interface IRAuditStatement {
  kind: "AuditStatement";
  span: SourceSpan;
  eventName: IRExpression;
  correlation: IRExpression;
}

export interface IRLetStatement {
  kind: "LetStatement";
  span: SourceSpan;
  name: string;
  declaredType: IRType;
  initializer: IRExpression;
}

export interface IRReturnStatement {
  kind: "ReturnStatement";
  span: SourceSpan;
  expression: IRExpression;
}

export interface IRIfStatement {
  kind: "IfStatement";
  span: SourceSpan;
  condition: IRExpression;
  thenBranch: IRBlock;
  elseBranch: IRBlock | null;
}

export type IRExpression =
  | IRIdentifierExpression
  | IRDecimalLiteralExpression
  | IRBooleanLiteralExpression
  | IRStringLiteralExpression
  | IRMemberAccessExpression
  | IRBinaryComparisonExpression
  | IRBinaryArithmeticExpression;

export interface IRStringLiteralExpression {
  kind: "StringLiteral";
  span: SourceSpan;
  value: string;
  resolvedType: StringIRType;
}

export interface IRMemberAccessExpression {
  kind: "MemberAccess";
  span: SourceSpan;
  targetName: string;
  recordName: string;
  member: string;
  resolvedType: IRType;
}

export interface IRIdentifierExpression {
  kind: "Identifier";
  span: SourceSpan;
  name: string;
  resolvedType: IRType;
}

export interface IRDecimalLiteralExpression {
  kind: "DecimalLiteral";
  span: SourceSpan;
  text: string;
  resolvedType: DecimalIRType;
}

export interface IRBooleanLiteralExpression {
  kind: "BooleanLiteral";
  span: SourceSpan;
  value: boolean;
  resolvedType: BoolIRType;
}

export interface IRBinaryComparisonExpression {
  kind: "BinaryComparison";
  span: SourceSpan;
  operator: ">";
  left: IRExpression;
  right: IRExpression;
  resolvedType: BoolIRType;
}

export interface IRBinaryArithmeticExpression {
  kind: "BinaryArithmetic";
  span: SourceSpan;
  operator: "+" | "-";
  left: IRExpression;
  right: IRExpression;
  resolvedType: DecimalIRType;
}

export type IRType = DecimalIRType | StringIRType | BoolIRType | RecordIRType;

export interface DecimalIRType {
  kind: "decimal";
  precision: number;
  scale: number;
}

export interface StringIRType {
  kind: "string";
  length: number;
}

export interface BoolIRType {
  kind: "bool";
}

export interface RecordIRType {
  kind: "record";
  name: string;
  fields: IRField[];
}

export interface IRLoweringResult {
  program: IRProgram | null;
  diagnostics: TypeCheckResult["diagnostics"];
}

export function lowerProgramToIR(
  typechecked: TypeCheckResult,
): IRLoweringResult {
  if (typechecked.diagnostics.length > 0 || !typechecked.program) {
    return {
      program: null,
      diagnostics: typechecked.diagnostics,
    };
  }

  const moduleDeclaration = typechecked.program.module;
  const recordTypeMap = new Map<string, IRRecord>();
  const records = typechecked.records.map((record) => {
    const lowered = lowerRecord(record, recordTypeMap);
    recordTypeMap.set(lowered.name, lowered);
    return lowered;
  });

  const functions = typechecked.functions.map((fn) => lowerFunction(fn));
  const transactions = typechecked.transactions.map((transaction) =>
    lowerTransaction(transaction),
  );

  return {
    program: {
      kind: "Program",
      sourceFile: moduleDeclaration.span.sourceFile,
      moduleName: moduleDeclaration.name,
      moduleSpan: moduleDeclaration.span,
      records,
      functions,
      transactions,
    },
    diagnostics: typechecked.diagnostics,
  };
}

function lowerTransaction(transaction: ResolvedTransaction): IRTransaction {
  const scopeTypes = new Map<string, IRType>();
  for (const parameter of transaction.parameters) {
    scopeTypes.set(parameter.name, lowerType(parameter.type));
  }
  for (const local of transaction.locals) {
    scopeTypes.set(local.name, lowerType(local.type));
  }

  return {
    kind: "Transaction",
    name: transaction.name,
    span: transaction.span,
    parameters: transaction.parameters.map((parameter) => ({
      kind: "Parameter",
      name: parameter.name,
      span: parameter.span,
      type: lowerType(parameter.type),
    })),
    body: lowerBlock(transaction.body, scopeTypes),
  };
}

function lowerRecord(
  record: ResolvedRecord,
  _recordTypeMap: Map<string, IRRecord>,
): IRRecord {
  return {
    kind: "Record",
    name: record.name,
    span: record.span,
    fields: record.fields.map((field) => ({
      kind: "Field",
      name: field.name,
      span: field.span,
      type: lowerType(field.type),
    })),
  };
}

function lowerFunction(fn: ResolvedFunction): IRFunction {
  const scopeTypes = new Map<string, IRType>();
  for (const parameter of fn.parameters) {
    scopeTypes.set(parameter.name, lowerType(parameter.type));
  }
  for (const local of fn.locals) {
    scopeTypes.set(local.name, lowerType(local.type));
  }

  return {
    kind: "Function",
    name: fn.name,
    span: fn.span,
    parameters: fn.parameters.map((parameter) => ({
      kind: "Parameter",
      name: parameter.name,
      span: parameter.span,
      type: lowerType(parameter.type),
    })),
    returnType: lowerType(fn.returnType),
    body: lowerBlock(fn.body, scopeTypes),
  };
}

function lowerBlock(
  block: { span: SourceSpan; statements: StatementNode[] },
  scopeTypes: Map<string, IRType>,
): IRBlock {
  return {
    kind: "Block",
    span: block.span,
    statements: block.statements.map((statement) =>
      lowerStatement(statement, scopeTypes),
    ),
  };
}

function lowerStatement(
  statement: StatementNode,
  scopeTypes: Map<string, IRType>,
): IRStatement {
  switch (statement.kind) {
    case "LetStatement":
      return lowerLetStatement(statement, scopeTypes);
    case "ReturnStatement":
      return lowerReturnStatement(statement, scopeTypes);
    case "IfStatement":
      return lowerIfStatement(statement, scopeTypes);
    case "LedgerStatement":
      return {
        kind: "LedgerStatement",
        span: statement.span,
        operation: statement.operation,
        account: lowerExpression(statement.account, scopeTypes),
        amount: lowerExpression(statement.amount, scopeTypes),
      };
    case "AuditStatement":
      return {
        kind: "AuditStatement",
        span: statement.span,
        eventName: lowerExpression(statement.eventName, scopeTypes),
        correlation: lowerExpression(statement.correlation, scopeTypes),
      };
  }
}

function lowerLetStatement(
  statement: LetStatementNode,
  scopeTypes: Map<string, IRType>,
): IRLetStatement {
  const declaredType = scopeTypes.get(statement.name);
  if (!declaredType) {
    throw new Error(`Unresolved local during IR lowering: ${statement.name}`);
  }

  return {
    kind: "LetStatement",
    span: statement.span,
    name: statement.name,
    declaredType,
    initializer: lowerExpression(statement.expression, scopeTypes),
  };
}

function lowerReturnStatement(
  statement: ReturnStatementNode,
  scopeTypes: Map<string, IRType>,
): IRReturnStatement {
  return {
    kind: "ReturnStatement",
    span: statement.span,
    expression: lowerExpression(statement.expression, scopeTypes),
  };
}

function lowerIfStatement(
  statement: IfStatementNode,
  scopeTypes: Map<string, IRType>,
): IRIfStatement {
  return {
    kind: "IfStatement",
    span: statement.span,
    condition: lowerExpression(statement.condition, scopeTypes),
    thenBranch: lowerBlock(statement.thenBranch, scopeTypes),
    elseBranch: statement.elseBranch
      ? lowerBlock(statement.elseBranch, scopeTypes)
      : null,
  };
}

function lowerExpression(
  expression: ExpressionNode,
  scopeTypes: Map<string, IRType>,
): IRExpression {
  switch (expression.kind) {
    case "Identifier":
      return lowerIdentifierExpression(expression, scopeTypes);
    case "DecimalLiteral":
      return lowerDecimalLiteralExpression(expression);
    case "BooleanLiteral":
      return lowerBooleanLiteralExpression(expression);
    case "StringLiteral":
      return {
        kind: "StringLiteral",
        span: expression.span,
        value: expression.value,
        resolvedType: { kind: "string", length: expression.value.length },
      };
    case "MemberAccess":
      return lowerMemberAccessExpression(expression, scopeTypes);
    case "BinaryExpression":
      return lowerBinaryExpression(expression, scopeTypes);
  }
}

function lowerMemberAccessExpression(
  expression: MemberAccessNode,
  scopeTypes: Map<string, IRType>,
): IRMemberAccessExpression {
  const targetType = scopeTypes.get(expression.target.name);
  if (!targetType || targetType.kind !== "record") {
    throw new Error(
      `Unresolved record during IR lowering: ${expression.target.name}`,
    );
  }

  const field = targetType.fields.find(
    (candidate) => candidate.name === expression.member,
  );
  if (!field) {
    throw new Error(
      `Unresolved field during IR lowering: ${expression.target.name}.${expression.member}`,
    );
  }

  return {
    kind: "MemberAccess",
    span: expression.span,
    targetName: expression.target.name,
    recordName: targetType.name,
    member: expression.member,
    resolvedType: field.type,
  };
}

function lowerIdentifierExpression(
  expression: IdentifierNode,
  scopeTypes: Map<string, IRType>,
): IRIdentifierExpression {
  const resolvedType = scopeTypes.get(expression.name);
  if (!resolvedType) {
    throw new Error(
      `Unresolved identifier during IR lowering: ${expression.name}`,
    );
  }

  return {
    kind: "Identifier",
    span: expression.span,
    name: expression.name,
    resolvedType,
  };
}

function lowerDecimalLiteralExpression(
  expression: DecimalLiteralNode,
): IRDecimalLiteralExpression {
  const scale = expression.text.includes(".")
    ? expression.text.split(".")[1].length
    : 0;
  const precision = expression.text.replace(".", "").length;
  return {
    kind: "DecimalLiteral",
    span: expression.span,
    text: expression.text,
    resolvedType: { kind: "decimal", precision, scale },
  };
}

function lowerBooleanLiteralExpression(
  expression: BooleanLiteralNode,
): IRBooleanLiteralExpression {
  return {
    kind: "BooleanLiteral",
    span: expression.span,
    value: expression.value,
    resolvedType: { kind: "bool" },
  };
}

function lowerBinaryExpression(
  expression: BinaryExpressionNode,
  scopeTypes: Map<string, IRType>,
): IRBinaryComparisonExpression | IRBinaryArithmeticExpression {
  const left = lowerExpression(expression.left, scopeTypes);
  const right = lowerExpression(expression.right, scopeTypes);

  if (expression.operator === ">") {
    return {
      kind: "BinaryComparison",
      span: expression.span,
      operator: expression.operator,
      left,
      right,
      resolvedType: { kind: "bool" },
    };
  }

  return {
    kind: "BinaryArithmetic",
    span: expression.span,
    operator: expression.operator,
    left,
    right,
    resolvedType: decimalExpressionType(left, right),
  };
}

function decimalExpressionType(
  left: IRExpression,
  right: IRExpression,
): DecimalIRType {
  const leftType = expressionDecimalType(left);
  const rightType = expressionDecimalType(right);
  return leftType ?? rightType ?? { kind: "decimal", precision: 18, scale: 2 };
}

function expressionDecimalType(expression: IRExpression): DecimalIRType | null {
  if (
    expression.kind === "DecimalLiteral" ||
    expression.kind === "BinaryArithmetic"
  ) {
    return expression.resolvedType;
  }

  if (
    expression.kind === "Identifier" &&
    expression.resolvedType.kind === "decimal"
  ) {
    return expression.resolvedType;
  }

  return null;
}

function lowerType(type: ResolvedType): IRType {
  switch (type.kind) {
    case "decimal":
      return lowerDecimalType(type);
    case "string":
      return { kind: "string", length: type.length };
    case "bool":
      return { kind: "bool" };
    case "record":
      return {
        kind: "record",
        name: type.name,
        fields: type.fields.map((field) => ({
          kind: "Field",
          name: field.name,
          span: field.span,
          type: lowerType(field.type),
        })),
      };
  }
}

function lowerDecimalType(type: DecimalType): DecimalIRType {
  return {
    kind: "decimal",
    precision: type.precision,
    scale: type.scale,
  };
}
