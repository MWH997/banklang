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
  type FileDeclarationNode,
  type CallExpressionNode,
  type WhileStatementNode,
  type AssignStatementNode,
  type FileStatementNode,
} from "../../ast/src/index";

export interface DecimalType {
  kind: "decimal";
  precision: number;
  scale: number;
  /** True for a written literal, which widens to a larger declared precision. */
  literal?: boolean;
  /**
   * True for the result of `round(...)` or `divide(...)`, whose scale is
   * decided by the assignment target. This mirrors COBOL, where `ROUNDED`
   * attaches to the receiving field rather than to the expression.
   */
  rounded?: boolean;
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

export interface ResolvedFile {
  name: string;
  span: SourceSpan;
  organization: "sequential";
  mode: "input" | "output";
  record: ResolvedRecord;
  statusName: string | null;
}

export interface TypeCheckResult {
  program: ProgramNode | null;
  diagnostics: Diagnostic[];
  aliases: Record<string, ResolvedType>;
  records: ResolvedRecord[];
  functions: ResolvedFunction[];
  transactions: ResolvedTransaction[];
  files: ResolvedFile[];
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
      files: [],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const aliases: Record<string, ResolvedType> = {};
  const records: ResolvedRecord[] = [];
  const recordMap = new Map<string, ResolvedRecord>();
  const functions: ResolvedFunction[] = [];
  const transactions: ResolvedTransaction[] = [];
  const files: ResolvedFile[] = [];

  // Resolve record and alias declarations first so function signatures can
  // reference them, then collect signatures so a function may call one
  // declared later in the file.
  functionSignatures = new Map();
  declaredFiles = new Map();

  // Pass 1: type aliases and records, so later passes can resolve types.
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
    }
  }

  // Pass 2: files and function signatures, so a body can call a function
  // declared later in the file and reference any declared file.
  for (const declaration of program.declarations) {
    if (declaration.kind === "FunctionDeclaration") {
      registerFunctionSignature(declaration, aliases, recordMap);
      continue;
    }

    if (declaration.kind === "FileDeclaration") {
      const resolvedFile = resolveFile(declaration, recordMap, diagnostics);
      if (resolvedFile) {
        files.push(resolvedFile);
        declaredFiles.set(resolvedFile.name, resolvedFile);
      }
    }
  }

  // Pass 3: bodies.
  for (const declaration of program.declarations) {
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
    files,
  };
}

function resolveFile(
  declaration: FileDeclarationNode,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedFile | null {
  const record = recordMap.get(declaration.recordTypeName);
  if (!record) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved record type for file ${declaration.name}: ${declaration.recordTypeName}.`,
        span: declaration.span,
        hint: "Declare the record before the file that uses it.",
        backendProfile: null,
      }),
    );
    return null;
  }

  return {
    name: declaration.name,
    span: declaration.span,
    organization: declaration.organization,
    mode: declaration.mode,
    record,
    statusName: declaration.statusName,
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

  declareFileStatusSymbols(scope);

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
      case "WhileStatement":
      case "AssignStatement":
      case "ExpressionStatement":
      case "FileStatement":
        validateEffectStatement(
          statement,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
          true,
        );
        break;
      case "IfStatement":
        validateTransactionBranch(
          statement,
          scope,
          aliases,
          recordMap,
          locals,
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

/**
 * Statements that carry effects and are valid in both function and
 * transaction bodies: loops, assignment, calls, and file operations.
 */
/**
 * `if` inside a transaction branches on effects rather than producing a value,
 * so it is validated separately from the function-body form that must return
 * matching types on both paths.
 */
function validateTransactionBranch(
  statement: IfStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): void {
  const conditionType = inferExpressionType(
    statement.condition,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (conditionType && !isBoolType(conditionType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "If conditions must be bool.",
        span: statement.condition.span,
        hint: "Use a comparison or a bool value.",
        backendProfile: null,
      }),
    );
  }

  for (const branch of [statement.thenBranch, statement.elseBranch]) {
    if (!branch) {
      continue;
    }
    validateTransactionBody(
      branch,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
    );
  }
}

function validateEffectStatement(
  statement: StatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): boolean {
  switch (statement.kind) {
    case "WhileStatement":
      validateWhileStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    case "AssignStatement":
      validateAssignStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      return true;
    case "ExpressionStatement":
      inferExpressionType(
        statement.expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      return true;
    case "FileStatement":
      validateFileStatement(statement, scope, diagnostics);
      return true;
    default:
      return false;
  }
}

function validateWhileStatement(
  statement: WhileStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const conditionType = inferExpressionType(
    statement.condition,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (conditionType && !isBoolType(conditionType)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "While conditions must be bool.",
        span: statement.condition.span,
        hint: "Use a comparison or a bool value.",
        backendProfile: null,
      }),
    );
  }

  if (!Number.isInteger(statement.limit) || statement.limit <= 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TXN-004",
        severity: "error",
        message: "A loop limit must be a positive whole number.",
        span: statement.span,
        hint: "Write `limit 1000`.",
        backendProfile: null,
      }),
    );
  }

  for (const inner of statement.body.statements) {
    if (inner.kind === "LetStatement") {
      validateLetStatement(
        inner,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
      );
      continue;
    }
    if (
      validateEffectStatement(
        inner,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      )
    ) {
      continue;
    }
    if (inTransaction && inner.kind === "LedgerStatement") {
      validateLedgerStatement(inner, scope, aliases, recordMap, diagnostics);
      continue;
    }
    if (inTransaction && inner.kind === "AuditStatement") {
      validateAuditStatement(inner, scope, aliases, recordMap, diagnostics);
      continue;
    }
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-007",
        severity: "error",
        message: `A ${inner.kind} is not allowed inside a loop body.`,
        span: inner.span,
        hint: "Loop bodies carry effects; move returns outside the loop.",
        backendProfile: null,
      }),
    );
  }
}

function validateAssignStatement(
  statement: AssignStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const targetType = inferExpressionType(
    statement.target,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  const valueType = inferExpressionType(
    statement.expression,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (!targetType || !valueType) {
    return;
  }

  if (!typesCompatible(targetType, valueType)) {
    // Narrowing a decimal scale without saying how to round is the classic
    // silent money bug, so it gets its own diagnostic.
    if (
      isDecimalType(targetType) &&
      isDecimalType(valueType) &&
      targetType.scale < valueType.scale &&
      statement.expression.kind !== "RoundedExpression"
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DEC-002",
          severity: "error",
          message: `Assigning ${describeType(valueType)} to ${describeType(targetType)} discards digits.`,
          span: statement.span,
          hint: 'Wrap the value in round(value, "HALF_EVEN") to state the rounding.',
          backendProfile: null,
        }),
      );
      return;
    }

    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Cannot assign ${describeType(valueType)} to ${describeType(targetType)}.`,
        span: statement.span,
        hint: "The subset does not coerce on assignment.",
        backendProfile: null,
      }),
    );
  }
}

function validateFileStatement(
  statement: FileStatementNode,
  scope: Map<string, ResolvedType>,
  diagnostics: Diagnostic[],
): void {
  const file = declaredFiles.get(statement.fileName);
  if (!file) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved file: ${statement.fileName}.`,
        span: statement.span,
        hint: "Declare the file before operating on it.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.operation === "read" && file.mode !== "input") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-001",
        severity: "error",
        message: `Cannot read from ${file.name}, which is declared as output.`,
        span: statement.span,
        hint: "Declare the file as input, or use write.",
        backendProfile: null,
      }),
    );
  }

  if (statement.operation === "write" && file.mode !== "output") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-001",
        severity: "error",
        message: `Cannot write to ${file.name}, which is declared as input.`,
        span: statement.span,
        hint: "Declare the file as output, or use read.",
        backendProfile: null,
      }),
    );
  }

  if (statement.recordName === null) {
    return;
  }

  const recordType = scope.get(statement.recordName);
  if (!recordType) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved record variable: ${statement.recordName}.`,
        span: statement.span,
        hint: "Pass a record-typed parameter or local.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (recordType.kind !== "record" || recordType.name !== file.record.name) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-002",
        severity: "error",
        message: `File ${file.name} carries ${file.record.name} records, but ${statement.recordName} is ${describeType(recordType)}.`,
        span: statement.span,
        hint: "The record layout must match the file declaration.",
        backendProfile: null,
      }),
    );
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

  declareFileStatusSymbols(scope);

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

    // Loops, assignments, calls, and file operations carry effects and do not
    // end a block, so they are checked here and the search for a terminal
    // statement continues.
    if (
      validateEffectStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        false,
      )
    ) {
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
    case "WhileStatement":
    case "AssignStatement":
    case "ExpressionStatement":
    case "FileStatement":
      // Effect statements are validated by validateBlock before the terminal
      // statement is resolved, so nothing further is needed here.
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
    case "UnaryExpression": {
      const operand = inferExpressionType(
        expression.operand,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (!operand) {
        return null;
      }
      if (!isBoolType(operand)) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: "The `!` operator requires a bool operand.",
            span: expression.span,
            hint: "Negate a comparison or a bool value.",
            backendProfile: null,
          }),
        );
        return null;
      }
      return { kind: "bool" };
    }
    case "RoundedExpression": {
      const previous = inRoundedContext;
      inRoundedContext = true;
      const operand = inferExpressionType(
        expression.operand,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      inRoundedContext = previous;
      if (!operand) {
        return null;
      }
      if (!isDecimalType(operand)) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `${expression.isDivision ? "divide" : "round"} requires decimal operands.`,
            span: expression.span,
            hint: "Rounding applies to decimal arithmetic only.",
            backendProfile: null,
          }),
        );
        return null;
      }
      // The scale is decided by the assignment target, exactly as COBOL's
      // ROUNDED attaches to the receiving field.
      return { ...operand, rounded: true };
    }
    case "CallExpression":
      return inferCallExpressionType(
        expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
  }
}

/**
 * Function calls are resolved against the module's declared functions.
 *
 * `functionSignatures` is populated in a first pass over declarations so a
 * function can call one declared later in the file.
 */
let functionSignatures = new Map<string, ResolvedFunctionSignature>();

/** Declared files, for resolving file statements. */
let declaredFiles = new Map<string, ResolvedFile>();

/**
 * File status fields are readable in any body, so a loop can test them.
 * They are compiler-owned storage, not user locals.
 */
function declareFileStatusSymbols(scope: Map<string, ResolvedType>): void {
  for (const file of declaredFiles.values()) {
    if (file.statusName && !scope.has(file.statusName)) {
      scope.set(file.statusName, { kind: "string", length: 2 });
    }
  }
}

function registerFunctionSignature(
  declaration: FunctionDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
): void {
  const ignored: Diagnostic[] = [];
  const parameters = declaration.parameters.flatMap((parameter) => {
    const type = resolveTypeNode(
      parameter.type,
      aliases,
      recordMap,
      ignored,
      parameter.span,
    );
    return type ? [{ name: parameter.name, type }] : [];
  });

  const returnType = resolveTypeNode(
    declaration.returnType,
    aliases,
    recordMap,
    ignored,
    declaration.returnType.span,
  );

  if (returnType && parameters.length === declaration.parameters.length) {
    functionSignatures.set(declaration.name, {
      name: declaration.name,
      parameters,
      returnType,
    });
  }
}

interface ResolvedFunctionSignature {
  name: string;
  parameters: { name: string; type: ResolvedType }[];
  returnType: ResolvedType;
}

function inferCallExpressionType(
  expression: CallExpressionNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const signature = functionSignatures.get(expression.callee);
  if (!signature) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved function: ${expression.callee}.`,
        span: expression.span,
        hint: "Declare the function in this module before calling it.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (expression.args.length !== signature.parameters.length) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${expression.callee} expects ${signature.parameters.length} argument(s) but received ${expression.args.length}.`,
        span: expression.span,
        hint: `Signature: ${signature.parameters.map((parameter) => `${parameter.name}: ${describeType(parameter.type)}`).join(", ")}.`,
        backendProfile: null,
      }),
    );
    return null;
  }

  for (let index = 0; index < expression.args.length; index += 1) {
    const actual = inferExpressionType(
      expression.args[index],
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    const expected = signature.parameters[index].type;
    if (actual && !typesCompatible(expected, actual)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message: `Argument ${index + 1} of ${expression.callee} expects ${describeType(expected)} but received ${describeType(actual)}.`,
          span: expression.args[index].span,
          hint: "The subset does not coerce arguments.",
          backendProfile: null,
        }),
      );
    }
  }

  return signature.returnType;
}

const COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!="]);

/**
 * True while checking inside `round(...)` or `divide(...)`.
 *
 * Division is only legal there, because COBOL attaches `ROUNDED` to the
 * assignment and an unstated rounding mode is a real financial defect.
 */
let inRoundedContext = false;

function describeType(type: ResolvedType): string {
  switch (type.kind) {
    case "decimal":
      return `decimal<${type.precision}, ${type.scale}>`;
    case "string":
      return `string<${type.length}>`;
    case "bool":
      return "bool";
    case "record":
      return type.name;
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

  const operator = expression.operator;

  // Logical operators combine bools.
  if (operator === "&&" || operator === "||") {
    if (!isBoolType(left) || !isBoolType(right)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message: `Operator ${operator} requires bool operands.`,
          span: expression.span,
          hint: "Combine comparisons, not raw decimal values.",
          backendProfile: null,
        }),
      );
      return null;
    }
    return { kind: "bool" };
  }

  // Comparisons produce bool. Equality also works on strings and bools;
  // ordering is decimal-only.
  if (COMPARISON_OPERATORS.has(operator)) {
    const equality = operator === "==" || operator === "!=";

    if (equality && left.kind === right.kind && !isDecimalType(left)) {
      return { kind: "bool" };
    }

    if (!isDecimalType(left) || !isDecimalType(right)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message: equality
            ? `Operator ${operator} requires operands of the same type.`
            : `Comparison operator ${operator} requires decimal operands.`,
          span: expression.span,
          hint: "Compare values of the same BankLang type.",
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
          message: `Decimal comparison requires matching scale, but the operands are ${describeType(left)} and ${describeType(right)}.`,
          span: expression.span,
          hint: 'Rescale one side with round(value, "HALF_EVEN") before comparing.',
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
        message: `Arithmetic operator ${operator} requires decimal operands.`,
        span: expression.span,
        hint: "Use decimal values or decimal literals in the arithmetic expression.",
        backendProfile: null,
      }),
    );
    return null;
  }

  // Division cannot be exact, so it must state a rounding mode.
  if (operator === "/") {
    if (!inRoundedContext) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DEC-003",
          severity: "error",
          message: "Division requires an explicit rounding mode.",
          span: expression.span,
          hint: 'Write divide(a, b, "HALF_EVEN") instead of a / b.',
          backendProfile: null,
        }),
      );
      return null;
    }
    return left;
  }

  // Multiplication is exact: scales add. Precision must still fit.
  if (operator === "*") {
    const scale = left.scale + right.scale;
    const precision = Math.max(left.precision, right.precision);
    if (scale > precision) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DEC-004",
          severity: "error",
          message: `Multiplying ${describeType(left)} by ${describeType(right)} needs scale ${scale}, which exceeds precision ${precision}.`,
          span: expression.span,
          hint: "Widen the operand precision or reduce the operand scales.",
          backendProfile: null,
        }),
      );
      return null;
    }
    return { kind: "decimal", precision, scale };
  }

  if (
    left.scale !== right.scale ||
    (!left.literal && !right.literal && left.precision !== right.precision)
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Decimal ${operator} requires matching precision and scale, but the operands are ${describeType(left)} and ${describeType(right)}.`,
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

/**
 * A literal carries its written scale and a `literal` marker.
 *
 * Without this, `0.00` has precision 3 and could not be assigned to a
 * `decimal<18, 2>`, which is why earlier examples padded literals out to
 * `0000000000000025.00`. A literal widens to any decimal with the same scale
 * and enough precision; the scale still has to match exactly, so no rounding
 * happens implicitly.
 */
function inferDecimalLiteral(node: DecimalLiteralNode): DecimalType {
  const scale = node.text.includes(".") ? node.text.split(".")[1].length : 0;
  const precision = node.text.replace(".", "").replace(/^0+/, "").length || 1;
  return { kind: "decimal", precision, scale, literal: true };
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
    // A rounded value takes the target's scale; that is what rounding means.
    if (right.rounded || left.rounded) {
      return true;
    }
    if (left.scale !== right.scale) {
      return false;
    }
    // A literal fits any declared decimal wide enough to hold it.
    if (right.literal) {
      return right.precision <= left.precision;
    }
    if (left.literal) {
      return left.precision <= right.precision;
    }
    return left.precision === right.precision;
  }

  if (left.kind === "string" && right.kind === "string") {
    return left.length === right.length;
  }

  if (left.kind === "record" && right.kind === "record") {
    return left.name === right.name;
  }

  return true;
}
