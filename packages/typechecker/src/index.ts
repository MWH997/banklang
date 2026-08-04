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
  type IfStatementNode,
  type LetStatementNode,
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
  type StatementNode,
  type TransactionDeclarationNode,
  type LedgerStatementNode,
  type AuditStatementNode,
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
  locals: ResolvedLocal[];
  returnType: ResolvedType;
  body: BlockNode;
}

export interface ResolvedLocal {
  name: string;
  span: SourceSpan;
  type: ResolvedType;
}

export interface ResolvedTransaction {
  name: string;
  span: SourceSpan;
  parameters: ResolvedParameter[];
  locals: ResolvedLocal[];
  body: BlockNode;
}

export interface TypeCheckResult {
  program: ProgramNode | null;
  diagnostics: Diagnostic[];
  aliases: Record<string, ResolvedType>;
  records: ResolvedRecord[];
  functions: ResolvedFunction[];
  transactions: ResolvedTransaction[];
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
      transactions: [],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const aliases: Record<string, ResolvedType> = {};
  const records: ResolvedRecord[] = [];
  const recordMap = new Map<string, ResolvedRecord>();
  const functions: ResolvedFunction[] = [];
  const transactions: ResolvedTransaction[] = [];

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
      continue;
    }

    if (declaration.kind === "TransactionDeclaration") {
      const resolvedTransaction = resolveTransaction(
        declaration,
        aliases,
        recordMap,
        diagnostics,
      );
      if (resolvedTransaction) {
        transactions.push(resolvedTransaction);
      }
    }
  }

  return {
    program,
    diagnostics,
    aliases,
    records,
    functions,
    transactions,
  };
}

function resolveTransaction(
  declaration: TransactionDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedTransaction | null {
  const parameters: ResolvedParameter[] = [];
  const scope = new Map<string, ResolvedType>();
  const locals: ResolvedLocal[] = [];

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
    declareSymbol(parameter.name, resolved, parameter.span, scope, diagnostics);
    parameters.push({
      name: parameter.name,
      span: parameter.span,
      type: resolved,
    });
  }

  validateTransactionBody(
    declaration.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    locals,
    body: declaration.body,
  };
}

/**
 * Transaction bodies are a flat sequence of effect statements rather than an
 * expression with a return type, so they use their own validation path instead
 * of the terminal-statement rule that applies to functions.
 */
function validateTransactionBody(
  body: BlockNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): void {
  for (const statement of body.statements) {
    switch (statement.kind) {
      case "LetStatement":
        validateLetStatement(
          statement,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
        break;
      case "LedgerStatement":
        validateLedgerStatement(
          statement,
          scope,
          aliases,
          recordMap,
          diagnostics,
        );
        break;
      case "AuditStatement":
        validateAuditStatement(
          statement,
          scope,
          aliases,
          recordMap,
          diagnostics,
        );
        break;
      default:
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-007",
            severity: "error",
            message:
              "Transaction bodies support let, debit, credit, and audit statements in the current subset.",
            span: statement.span,
            hint: "Move return and if statements into a function.",
            backendProfile: null,
          }),
        );
    }
  }
}

function validateLedgerStatement(
  statement: LedgerStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const accountType = inferExpressionType(
    statement.account,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (accountType && accountType.kind !== "string") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `The ${statement.operation} account argument must be a string value.`,
        span: statement.account.span,
        hint: "Pass an account identifier declared as string<n>.",
        backendProfile: null,
      }),
    );
  }

  const amountType = inferExpressionType(
    statement.amount,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (amountType && amountType.kind !== "decimal") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `The ${statement.operation} amount argument must be a decimal value.`,
        span: statement.amount.span,
        hint: "Pass a decimal amount so the posting stays exact.",
        backendProfile: null,
      }),
    );
  }
}

function validateAuditStatement(
  statement: AuditStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  inferExpressionType(
    statement.eventName,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  const correlationType = inferExpressionType(
    statement.correlation,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (correlationType && correlationType.kind !== "string") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "The audit correlation argument must be a string value.",
        span: statement.correlation.span,
        hint: "Pass the idempotency key or another string<n> correlation value.",
        backendProfile: null,
      }),
    );
  }
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
  const scope = new Map<string, ResolvedType>();
  const locals: ResolvedLocal[] = [];

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
    declareSymbol(parameter.name, resolved, parameter.span, scope, diagnostics);
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

  validateFunctionBody(
    declaration.body,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    locals,
    returnType,
    body: declaration.body,
  };
}

function validateFunctionBody(
  body: BlockNode,
  returnType: ResolvedType,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): ResolvedType | null {
  return validateBlock(
    body,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
}

function validateBlock(
  block: BlockNode,
  returnType: ResolvedType,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): ResolvedType | null {
  let terminalType: ResolvedType | null = null;
  let terminalSeen = false;

  for (const statement of block.statements) {
    if (terminalSeen) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-004",
          severity: "error",
          message: "Statements cannot follow a terminal statement.",
          span: statement.span,
          hint: "Move declarations before the final return or if statement.",
          backendProfile: null,
        }),
      );
      return null;
    }

    if (statement.kind === "LetStatement") {
      validateLetStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
      );
      continue;
    }

    terminalSeen = true;
    terminalType = resolveTerminalStatementType(
      statement,
      returnType,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
    );
  }

  if (!terminalSeen) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-004",
        severity: "error",
        message: "Function blocks must end with a return or if statement.",
        span: block.span,
        hint: "Add a terminal statement after any local declarations.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return terminalType;
}

function resolveTerminalStatementType(
  statement: StatementNode,
  returnType: ResolvedType,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): ResolvedType | null {
  switch (statement.kind) {
    case "ReturnStatement": {
      const resolved = inferExpressionType(
        statement.expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (!resolved) {
        return null;
      }

      if (!typesCompatible(returnType, resolved)) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: "Return path type does not match declared return type.",
            span: statement.span,
            hint: "Make every return path align with the declared function return type.",
            backendProfile: null,
          }),
        );
      }

      return resolved;
    }
    case "IfStatement":
      return resolveIfStatementType(
        statement,
        returnType,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
      );
    case "LetStatement":
      return null;
    case "LedgerStatement":
    case "AuditStatement":
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-007",
          severity: "error",
          message:
            "Ledger and audit statements are only allowed inside a transaction body.",
          span: statement.span,
          hint: "Move the debit, credit, or audit statement into a transaction declaration.",
          backendProfile: null,
        }),
      );
      return null;
  }
}

function resolveIfStatementType(
  statement: IfStatementNode,
  returnType: ResolvedType,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const conditionType = inferExpressionType(
    statement.condition,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (!conditionType) {
    return null;
  }

  if (!isBoolType(conditionType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "If conditions must be bool.",
        span: statement.condition.span,
        hint: "Compare a decimal expression or use a bool value in the condition.",
        backendProfile: null,
      }),
    );
    return null;
  }

  const thenType = validateBlock(
    statement.thenBranch,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  if (!thenType) {
    return null;
  }

  if (!statement.elseBranch) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-004",
        severity: "error",
        message:
          "If statements used as function bodies must include an else branch.",
        span: statement.span,
        hint: "Add an else branch so every path returns a value.",
        backendProfile: null,
      }),
    );
    return null;
  }

  const elseType = validateBlock(
    statement.elseBranch,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  if (!elseType) {
    return null;
  }

  if (!typesCompatible(thenType, elseType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "If branches must return the same type.",
        span: statement.span,
        hint: "Make the then and else branches return matching types.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (!typesCompatible(returnType, thenType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "Return path type does not match declared return type.",
        span: statement.span,
        hint: "Make every return path align with the declared function return type.",
        backendProfile: null,
      }),
    );
  }

  return thenType;
}

function validateLetStatement(
  statement: LetStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): void {
  const declaredType = resolveTypeNode(
    statement.type,
    aliases,
    recordMap,
    diagnostics,
    statement.type.span,
  );
  if (!declaredType) {
    return;
  }

  const initializerType = inferExpressionType(
    statement.expression,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (!initializerType) {
    return;
  }

  if (!typesCompatible(declaredType, initializerType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "Let initializer type does not match the declared type.",
        span: statement.expression.span,
        hint: "Make the let declaration type and initializer resolve to the same BankLang type.",
        backendProfile: null,
      }),
    );
  }

  if (
    !declareSymbol(
      statement.name,
      declaredType,
      statement.span,
      scope,
      diagnostics,
    )
  ) {
    return;
  }

  locals.push({
    name: statement.name,
    span: statement.span,
    type: declaredType,
  });
}

function inferExpressionType(
  expression: ExpressionNode,
  scope: Map<string, ResolvedType>,
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
      const resolved = scope.get(expression.name);
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
    case "StringLiteral":
      return { kind: "string", length: expression.value.length };
    case "MemberAccess": {
      const target = scope.get(expression.target.name);
      if (!target) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-001",
            severity: "error",
            message: `Unresolved type or symbol: ${expression.target.name}.`,
            span: expression.target.span,
            hint: "Declare the symbol before using it in the transaction body.",
            backendProfile: null,
          }),
        );
        return null;
      }

      if (target.kind !== "record") {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `Field access requires a record value, but ${expression.target.name} is not a record.`,
            span: expression.span,
            hint: "Use field access only on record-typed parameters.",
            backendProfile: null,
          }),
        );
        return null;
      }

      const field = target.fields.find(
        (candidate) => candidate.name === expression.member,
      );
      if (!field) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-006",
            severity: "error",
            message: `Record ${target.name} has no field named ${expression.member}.`,
            span: expression.span,
            hint: `Use one of: ${target.fields.map((candidate) => candidate.name).join(", ")}.`,
            backendProfile: null,
          }),
        );
        return null;
      }

      return field.type;
    }
    case "BinaryExpression": {
      return inferBinaryExpressionType(
        expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
    }
  }
}

function inferBinaryExpressionType(
  expression: BinaryExpressionNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const left = inferExpressionType(
    expression.left,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  const right = inferExpressionType(
    expression.right,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (!left || !right) {
    return null;
  }

  if (expression.operator === ">") {
    if (!isDecimalType(left) || !isDecimalType(right)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message:
            "Comparison operator > requires decimal operands in the current subset.",
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
            "Decimal comparison requires matching scale in the current subset.",
          span: expression.span,
          hint: "Make both sides use the same decimal scale.",
          backendProfile: null,
        }),
      );
      return null;
    }

    return { kind: "bool" };
  }

  if (!isDecimalType(left) || !isDecimalType(right)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Arithmetic operator ${expression.operator} requires decimal operands in the current subset.`,
        span: expression.span,
        hint: "Use decimal values or decimal literals in the arithmetic expression.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (left.precision !== right.precision || left.scale !== right.scale) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message:
          "Decimal arithmetic requires matching precision and scale in the current subset.",
        span: expression.span,
        hint: "Make both operands use the same decimal precision and scale.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return left;
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

function isBoolType(type: ResolvedType): type is BoolType {
  return type.kind === "bool";
}

function declareSymbol(
  name: string,
  type: ResolvedType,
  span: SourceSpan,
  scope: Map<string, ResolvedType>,
  diagnostics: Diagnostic[],
): boolean {
  if (scope.has(name)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-005",
        severity: "error",
        message: `Duplicate symbol: ${name}.`,
        span,
        hint: "Use a unique parameter or local variable name.",
        backendProfile: null,
      }),
    );
    return false;
  }

  scope.set(name, type);
  return true;
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
