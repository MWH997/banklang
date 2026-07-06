import {
  type BinaryExpressionNode,
  type BooleanLiteralNode,
  type DecimalLiteralNode,
  type ExpressionNode,
  type IdentifierNode,
  type IfStatementNode,
  type StatementNode,
  type ReturnStatementNode,
  type SourceSpan,
} from "../../ast/src/index";
import type {
  DecimalType,
  ResolvedField,
  ResolvedFunction,
  ResolvedRecord,
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

export type IRStatement = IRReturnStatement | IRIfStatement;

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
  | IRBinaryComparisonExpression;

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

  return {
    program: {
      kind: "Program",
      sourceFile: moduleDeclaration.span.sourceFile,
      moduleName: moduleDeclaration.name,
      moduleSpan: moduleDeclaration.span,
      records,
      functions,
    },
    diagnostics: typechecked.diagnostics,
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
  const parameterTypes = new Map<string, IRType>();
  for (const parameter of fn.parameters) {
    parameterTypes.set(parameter.name, lowerType(parameter.type));
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
    body: lowerBlock(fn.body, parameterTypes),
  };
}

function lowerBlock(
  block: { span: SourceSpan; statements: StatementNode[] },
  parameterTypes: Map<string, IRType>,
): IRBlock {
  return {
    kind: "Block",
    span: block.span,
    statements: block.statements.map((statement) =>
      lowerStatement(statement, parameterTypes),
    ),
  };
}

function lowerStatement(
  statement: StatementNode,
  parameterTypes: Map<string, IRType>,
): IRStatement {
  switch (statement.kind) {
    case "ReturnStatement":
      return lowerReturnStatement(statement, parameterTypes);
    case "IfStatement":
      return lowerIfStatement(statement, parameterTypes);
  }
}

function lowerReturnStatement(
  statement: ReturnStatementNode,
  parameterTypes: Map<string, IRType>,
): IRReturnStatement {
  return {
    kind: "ReturnStatement",
    span: statement.span,
    expression: lowerExpression(statement.expression, parameterTypes),
  };
}

function lowerIfStatement(
  statement: IfStatementNode,
  parameterTypes: Map<string, IRType>,
): IRIfStatement {
  return {
    kind: "IfStatement",
    span: statement.span,
    condition: lowerExpression(statement.condition, parameterTypes),
    thenBranch: lowerBlock(statement.thenBranch, parameterTypes),
    elseBranch: statement.elseBranch
      ? lowerBlock(statement.elseBranch, parameterTypes)
      : null,
  };
}

function lowerExpression(
  expression: ExpressionNode,
  parameterTypes: Map<string, IRType>,
): IRExpression {
  switch (expression.kind) {
    case "Identifier":
      return lowerIdentifierExpression(expression, parameterTypes);
    case "DecimalLiteral":
      return lowerDecimalLiteralExpression(expression);
    case "BooleanLiteral":
      return lowerBooleanLiteralExpression(expression);
    case "BinaryExpression":
      return lowerBinaryExpression(expression, parameterTypes);
  }
}

function lowerIdentifierExpression(
  expression: IdentifierNode,
  parameterTypes: Map<string, IRType>,
): IRIdentifierExpression {
  const resolvedType = parameterTypes.get(expression.name);
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
  parameterTypes: Map<string, IRType>,
): IRBinaryComparisonExpression {
  return {
    kind: "BinaryComparison",
    span: expression.span,
    operator: expression.operator,
    left: lowerExpression(expression.left, parameterTypes),
    right: lowerExpression(expression.right, parameterTypes),
    resolvedType: { kind: "bool" },
  };
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
