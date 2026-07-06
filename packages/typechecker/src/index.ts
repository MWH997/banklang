import {
  createDiagnostic,
  type BinaryExpressionNode,
  type BlockNode,
  type BooleanLiteralNode,
  type DeclarationNode,
  type DecimalLiteralNode,
  type DecimalTypeNode,
  type Diagnostic,
  type ExpressionNode,
  type FieldDeclarationNode,
  type FunctionDeclarationNode,
  type IdentifierNode,
  type ParameterNode,
  type ProgramNode,
  type RecordDeclarationNode,
  type ReturnStatementNode,
  type SourceSpan,
  type StringTypeNode,
  type TypeAliasDeclarationNode,
  type TypeNode,
  type TypeReferenceNode,
  type BoolTypeNode,
} from "../../ast/src/index";

export interface DecimalType {
  kind: "decimal";
  precision: number;
  scale: number;
}

export interface StringType {
  kind: "string";
  length: number;
}

export interface BoolType {
  kind: "bool";
}

export interface RecordType {
  kind: "record";
  name: string;
  span: SourceSpan;
  fields: ResolvedField[];
}

export type ResolvedType = DecimalType | StringType | BoolType | RecordType;

export interface ResolvedField {
  name: string;
  span: SourceSpan;
  type: ResolvedType;
}

export interface ResolvedParameter {
  name: string;
  span: SourceSpan;
  type: ResolvedType;
}

export interface ResolvedRecord {
  name: string;
  span: SourceSpan;
  fields: ResolvedField[];
}

export interface ResolvedFunction {
  name: string;
  span: SourceSpan;
  parameters: ResolvedParameter[];
  returnType: ResolvedType;
  body: BlockNode;
}

export interface TypeCheckResult {
  program: ProgramNode | null;
  diagnostics: Diagnostic[];
  aliases: Record<string, ResolvedType>;
  records: ResolvedRecord[];
  functions: ResolvedFunction[];
}

export function typecheckProgram(program: ProgramNode | null): TypeCheckResult {
  if (!program) {
    return {
      program: null,
      diagnostics: [
        createDiagnostic({
          id: "BANK-TYPE-000",
          severity: "error",
          message: "No AST was provided to the typechecker.",
          hint: "Fix parser errors before running type checking.",
          backendProfile: null,
        }),
      ],
      aliases: {},
      records: [],
      functions: [],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const aliases: Record<string, ResolvedType> = {};
  const records: ResolvedRecord[] = [];
  const recordMap = new Map<string, ResolvedRecord>();
  const functions: ResolvedFunction[] = [];

  for (const declaration of program.declarations) {
    if (declaration.kind === "TypeAliasDeclaration") {
      const resolved = resolveTypeNode(
        declaration.type,
        aliases,
        recordMap,
        diagnostics,
        declaration.span,
      );
      if (resolved) {
        aliases[declaration.name] = resolved;
      }
      continue;
    }

    if (declaration.kind === "RecordDeclaration") {
      const resolvedRecord = resolveRecord(
        declaration,
        aliases,
        recordMap,
        diagnostics,
      );
      if (resolvedRecord) {
        records.push(resolvedRecord);
        recordMap.set(resolvedRecord.name, resolvedRecord);
      }
      continue;
    }

    if (declaration.kind === "FunctionDeclaration") {
      const resolvedFunction = resolveFunction(
        declaration,
        aliases,
        recordMap,
        diagnostics,
      );
      if (resolvedFunction) {
        functions.push(resolvedFunction);
      }
    }
  }

  return {
    program,
    diagnostics,
    aliases,
    records,
    functions,
  };
}

function resolveRecord(
  declaration: RecordDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedRecord | null {
  const fields: ResolvedField[] = [];
  for (const field of declaration.fields) {
    const resolved = resolveTypeNode(
      field.type,
      aliases,
      recordMap,
      diagnostics,
      field.span,
    );
    if (!resolved) {
      continue;
    }
    fields.push({ name: field.name, span: field.span, type: resolved });
  }

  return {
    name: declaration.name,
    span: declaration.span,
    fields,
  };
}

function resolveFunction(
  declaration: FunctionDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedFunction | null {
  const parameters: ResolvedParameter[] = [];
  const parameterMap = new Map<string, ResolvedType>();

  for (const parameter of declaration.parameters) {
    const resolved = resolveTypeNode(
      parameter.type,
      aliases,
      recordMap,
      diagnostics,
      parameter.span,
    );
    if (!resolved) {
      continue;
    }
    parameterMap.set(parameter.name, resolved);
    parameters.push({
      name: parameter.name,
      span: parameter.span,
      type: resolved,
    });
  }

  const returnType = resolveTypeNode(
    declaration.returnType,
    aliases,
    recordMap,
    diagnostics,
    declaration.returnType.span,
  );
  if (!returnType) {
    return null;
  }

  const bodyDiagnostics = validateFunctionBody(
    declaration.body,
    parameterMap,
    returnType,
    aliases,
    recordMap,
  );
  diagnostics.push(...bodyDiagnostics);

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    returnType,
    body: declaration.body,
  };
}

function validateFunctionBody(
  body: BlockNode,
  parameterMap: Map<string, ResolvedType>,
  returnType: ResolvedType,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (body.statements.length !== 1) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-004",
        severity: "error",
        message:
          "Functions in the initial subset must contain exactly one return statement.",
        span: body.span,
        hint: "Keep the account-transfer example to a single return expression.",
        backendProfile: null,
      }),
    );
    return diagnostics;
  }

  const statement = body.statements[0];
  const expressionType = inferExpressionType(
    statement.expression,
    parameterMap,
    aliases,
    recordMap,
    diagnostics,
  );

  if (!expressionType) {
    return diagnostics;
  }

  if (!typesCompatible(returnType, expressionType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Return expression type does not match declared return type.`,
        span: statement.span,
        hint: "Make the expression type align with the function return type.",
        backendProfile: null,
      }),
    );
  }

  return diagnostics;
}

function inferExpressionType(
  expression: ExpressionNode,
  parameterMap: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  switch (expression.kind) {
    case "BooleanLiteral":
      return { kind: "bool" };
    case "DecimalLiteral":
      return inferDecimalLiteral(expression);
    case "Identifier": {
      const resolved = parameterMap.get(expression.name);
      if (!resolved) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-001",
            severity: "error",
            message: `Unresolved type or symbol: ${expression.name}.`,
            span: expression.span,
            hint: "Declare the symbol before using it in the function body.",
            backendProfile: null,
          }),
        );
        return null;
      }
      return resolved;
    }
    case "BinaryExpression": {
      return inferBinaryExpressionType(
        expression,
        parameterMap,
        aliases,
        recordMap,
        diagnostics,
      );
    }
  }
}

function inferBinaryExpressionType(
  expression: BinaryExpressionNode,
  parameterMap: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const left = inferExpressionType(
    expression.left,
    parameterMap,
    aliases,
    recordMap,
    diagnostics,
  );
  const right = inferExpressionType(
    expression.right,
    parameterMap,
    aliases,
    recordMap,
    diagnostics,
  );
  if (!left || !right) {
    return null;
  }

  if (!isDecimalType(left) || !isDecimalType(right)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Comparison operator ${expression.operator} requires decimal operands in the initial subset.`,
        span: expression.span,
        hint: "Use decimal values or decimal literals in the comparison.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (left.scale !== right.scale) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message:
          "Decimal comparison requires matching scale in the initial subset.",
        span: expression.span,
        hint: "Make both sides use the same decimal scale.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return { kind: "bool" };
}

function resolveTypeNode(
  node: TypeNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): ResolvedType | null {
  switch (node.kind) {
    case "DecimalType":
      return resolveDecimal(node, diagnostics, span);
    case "StringType":
      return resolveString(node, diagnostics, span);
    case "BoolType":
      return { kind: "bool" };
    case "TypeReference":
      return resolveReference(node, aliases, recordMap, diagnostics, span);
  }
}

function resolveDecimal(
  node: DecimalTypeNode,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): DecimalType | null {
  if (
    !Number.isInteger(node.precision) ||
    !Number.isInteger(node.scale) ||
    node.precision <= 0 ||
    node.scale < 0
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-002",
        severity: "error",
        message: "Invalid decimal parameters.",
        span,
        hint: "Decimal precision must be positive and scale must be zero or greater.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (node.scale > node.precision) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-002",
        severity: "error",
        message: "Decimal scale cannot exceed decimal precision.",
        span,
        hint: "Reduce the scale or increase the precision.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return { kind: "decimal", precision: node.precision, scale: node.scale };
}

function resolveString(
  node: StringTypeNode,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): StringType | null {
  if (!Number.isInteger(node.length) || node.length <= 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-002",
        severity: "error",
        message: "Invalid string length.",
        span,
        hint: "String length must be a positive integer.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return { kind: "string", length: node.length };
}

function resolveReference(
  node: TypeReferenceNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): ResolvedType | null {
  const alias = aliases[node.name];
  if (alias) {
    return alias;
  }

  const record = recordMap.get(node.name);
  if (record) {
    return {
      kind: "record",
      name: record.name,
      span: record.span,
      fields: record.fields,
    };
  }

  diagnostics.push(
    createDiagnostic({
      id: "BANK-TYPE-001",
      severity: "error",
      message: `Unresolved type: ${node.name}.`,
      span,
      hint: "Declare the type alias or record before using it.",
      backendProfile: null,
    }),
  );
  return null;
}

function inferDecimalLiteral(node: DecimalLiteralNode): DecimalType {
  const scale = node.text.includes(".") ? node.text.split(".")[1].length : 0;
  const precision = node.text.replace(".", "").length;
  return { kind: "decimal", precision, scale };
}

function isDecimalType(type: ResolvedType): type is DecimalType {
  return type.kind === "decimal";
}

function typesCompatible(left: ResolvedType, right: ResolvedType): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "decimal" && right.kind === "decimal") {
    return left.precision === right.precision && left.scale === right.scale;
  }

  if (left.kind === "string" && right.kind === "string") {
    return left.length === right.length;
  }

  if (left.kind === "record" && right.kind === "record") {
    return left.name === right.name;
  }

  return true;
}
