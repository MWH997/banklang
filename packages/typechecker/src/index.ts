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
  type EnumDeclarationNode,
  type FileOrganization,
  type SwitchStatementNode,
  type IndexAccessNode,
  type NullableCheckNode,
  type SqlDeclarationNode,
  type SqlStatementNode,
  type CicsStatementNode,
  type ForEachStatementNode,
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
  /**
   * True for a written literal, which fits any string field long enough to
   * hold it. COBOL `MOVE` pads with spaces, so this is not a silent truncation.
   */
  literal?: boolean;
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

/** A decimal that is nominally typed by currency code. */
export interface CurrencyType {
  kind: "currency";
  code: string;
  precision: number;
  scale: number;
}

export interface EnumType {
  kind: "enum";
  name: string;
  members: string[];
}

export interface NullableType {
  kind: "nullable";
  inner: ResolvedType;
}

export interface ArrayType {
  kind: "array";
  element: ResolvedType;
  length: number;
}

export type ResolvedType =
  | DecimalType
  | StringType
  | BoolType
  | RecordType
  | CurrencyType
  | EnumType
  | NullableType
  | ArrayType;

export interface ResolvedEnum {
  name: string;
  span: SourceSpan;
  members: string[];
}

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
  isCics: boolean;
}

export interface ResolvedFile {
  name: string;
  span: SourceSpan;
  organization: FileOrganization;
  keyField: ResolvedField | null;
  mode: "input" | "output";
  record: ResolvedRecord;
  statusName: string | null;
}

export interface ResolvedSql {
  name: string;
  span: SourceSpan;
  parameters: ResolvedParameter[];
  result: ResolvedRecord | null;
  text: string;
  /** Host variables resolved to a parameter or a result field. */
  hostVariables: { name: string; origin: "parameter" | "result" }[];
}

export interface TypeCheckResult {
  program: ProgramNode | null;
  diagnostics: Diagnostic[];
  aliases: Record<string, ResolvedType>;
  records: ResolvedRecord[];
  functions: ResolvedFunction[];
  transactions: ResolvedTransaction[];
  files: ResolvedFile[];
  enums: ResolvedEnum[];
  sql: ResolvedSql[];
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
      enums: [],
      sql: [],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const aliases: Record<string, ResolvedType> = {};
  const records: ResolvedRecord[] = [];
  const recordMap = new Map<string, ResolvedRecord>();
  const functions: ResolvedFunction[] = [];
  const transactions: ResolvedTransaction[] = [];
  const files: ResolvedFile[] = [];
  const enums: ResolvedEnum[] = [];
  const sqlStatements: ResolvedSql[] = [];

  // Resolve record and alias declarations first so function signatures can
  // reference them, then collect signatures so a function may call one
  // declared later in the file.
  functionSignatures = new Map();
  declaredFiles = new Map();
  enumMap = new Map();
  sqlMap = new Map();

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

    if (declaration.kind === "EnumDeclaration") {
      if (declaration.members.length === 0) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-002",
            severity: "error",
            message: `Enum ${declaration.name} declares no members.`,
            span: declaration.span,
            hint: "An enum needs at least one member.",
            backendProfile: null,
          }),
        );
        continue;
      }
      const resolved: ResolvedEnum = {
        name: declaration.name,
        span: declaration.span,
        members: declaration.members,
      };
      enums.push(resolved);
      enumMap.set(resolved.name, resolved);
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

    if (declaration.kind === "SqlDeclaration") {
      const resolvedSql = resolveSql(
        declaration,
        aliases,
        recordMap,
        diagnostics,
      );
      if (resolvedSql) {
        sqlStatements.push(resolvedSql);
        sqlMap.set(resolvedSql.name, resolvedSql);
      }
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
    enums,
    sql: sqlStatements,
  };
}

/**
 * Resolves a SQL declaration.
 *
 * BankLang does not parse SQL. It resolves the `:hostVariable` references
 * against the declared parameters and result record, rejects dynamic SQL, and
 * leaves the statement text otherwise untouched.
 */
function resolveSql(
  declaration: SqlDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedSql | null {
  const parameters: ResolvedParameter[] = [];
  for (const parameter of declaration.parameters) {
    const type = resolveTypeNode(
      parameter.type,
      aliases,
      recordMap,
      diagnostics,
      parameter.span,
    );
    if (type) {
      parameters.push({ name: parameter.name, span: parameter.span, type });
    }
  }

  let result: ResolvedRecord | null = null;
  if (declaration.resultTypeName) {
    result = recordMap.get(declaration.resultTypeName) ?? null;
    if (!result) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `Unresolved result record for SQL statement ${declaration.name}: ${declaration.resultTypeName}.`,
          span: declaration.span,
          hint: "Declare the record before the SQL statement that returns it.",
          backendProfile: null,
        }),
      );
    }
  }

  // Dynamic SQL cannot be checked or bound ahead of time.
  const upper = declaration.text.toUpperCase();
  for (const banned of ["EXECUTE IMMEDIATE", "PREPARE "]) {
    if (upper.includes(banned)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-SQL-002",
          severity: "error",
          message: `Dynamic SQL is not supported: ${declaration.name} uses ${banned.trim()}.`,
          span: declaration.span,
          hint: "Write the statement out so it can be precompiled and bound.",
          backendProfile: null,
        }),
      );
      break;
    }
  }

  const hostVariables: ResolvedSql["hostVariables"] = [];
  for (const host of declaration.hostVariables) {
    const isParameter = parameters.some(
      (parameter) => parameter.name === host.name,
    );
    const isResultField = Boolean(
      result?.fields.some((field) => field.name === host.name),
    );

    // A name that is both an input and an output is ambiguous: the generated
    // statement would silently bind one of them.
    if (isParameter && isResultField) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-SQL-003",
          severity: "error",
          message: `Host variable :${host.name} matches both a parameter and a field of ${result?.name}.`,
          span: declaration.span,
          hint: "Rename one of them so each host variable binds to one place.",
          backendProfile: null,
        }),
      );
      continue;
    }

    if (isParameter) {
      hostVariables.push({ name: host.name, origin: "parameter" });
      continue;
    }
    if (result?.fields.some((field) => field.name === host.name)) {
      hostVariables.push({ name: host.name, origin: "result" });
      continue;
    }
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-003",
        severity: "error",
        message: `Host variable :${host.name} does not match a parameter or a field of the result record.`,
        span: declaration.span,
        hint: `Parameters: ${parameters.map((parameter) => parameter.name).join(", ") || "none"}. Result fields: ${result?.fields.map((field) => field.name).join(", ") || "none"}.`,
        backendProfile: null,
      }),
    );
  }

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    result,
    text: declaration.text,
    hostVariables,
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

  // An indexed file needs a record key, and the key must be a real field of
  // the record it carries.
  let keyField: ResolvedField | null = null;
  if (declaration.organization === "indexed") {
    if (!declaration.keyField) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-004",
          severity: "error",
          message: `Indexed file ${declaration.name} declares no record key.`,
          span: declaration.span,
          hint: "Write `... record R key <field> status <s>;`.",
          backendProfile: null,
        }),
      );
    } else {
      keyField =
        record.fields.find((field) => field.name === declaration.keyField) ??
        null;
      if (!keyField) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-004",
            severity: "error",
            message: `Record ${record.name} has no field named ${declaration.keyField} to use as the record key.`,
            span: declaration.span,
            hint: `Available fields: ${record.fields.map((field) => field.name).join(", ")}.`,
            backendProfile: null,
          }),
        );
      }
    }
  } else if (declaration.keyField) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-004",
        severity: "error",
        message: `Only an indexed file can declare a record key, but ${declaration.name} is ${declaration.organization}.`,
        span: declaration.span,
        hint: "Remove the key clause, or declare the file as indexed.",
        backendProfile: null,
      }),
    );
  }

  return {
    name: declaration.name,
    span: declaration.span,
    organization: declaration.organization,
    keyField,
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

  // CICS response variables are compiler-owned storage, like file statuses.
  currentTransactionIsCics = declaration.isCics;
  cicsRespCaptured = new Set();
  declareCicsRespSymbols(declaration.body, scope);

  sqlExecuted = false;
  sqlCodeTested = false;
  validateTransactionBody(
    declaration.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  checkSqlCodeHandled(declaration.span, diagnostics);

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    locals,
    body: declaration.body,
    isCics: declaration.isCics,
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
      case "SwitchStatement":
      case "SqlStatement":
      case "CicsStatement":
      case "ForEachStatement":
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
            message: `A ${statement.kind} is not allowed in a transaction body.`,
            span: statement.span,
            hint: "Transactions carry effects. Move a return into a function.",
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

  // Inside the then-branch, any nullable proven present by the condition may
  // be read with valueOf.
  const previousGuards = guardedNullables;
  const guards = new Set(previousGuards);
  collectGuards(statement.condition, guards);

  guardedNullables = guards;
  validateTransactionBody(
    statement.thenBranch,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  guardedNullables = previousGuards;

  if (statement.elseBranch) {
    validateTransactionBody(
      statement.elseBranch,
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
      validateFileStatement(statement, scope, aliases, recordMap, diagnostics);
      return true;
    case "SqlStatement":
      validateSqlStatement(statement, scope, aliases, recordMap, diagnostics);
      return true;
    case "CicsStatement":
      validateCicsStatement(statement, scope, diagnostics, inTransaction);
      return true;
    case "ForEachStatement":
      validateForEachStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    case "SwitchStatement":
      validateSwitchStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    default:
      return false;
  }
}

/**
 * CICS commands are only valid inside a CICS transaction, and every command
 * must capture its response code.
 */
function validateCicsStatement(
  statement: CicsStatementNode,
  scope: Map<string, ResolvedType>,
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  if (!inTransaction || !currentTransactionIsCics) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-CICS-002",
        severity: "error",
        message: `A ${statement.operation} command requires a CICS transaction.`,
        span: statement.span,
        hint: "Declare the transaction as `cics transaction <name>(...)`.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.operation === "link") {
    if (!statement.respName) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-CICS-001",
          severity: "error",
          message: `The response code of link "${statement.program}" is not captured.`,
          span: statement.span,
          hint: 'Write `link "PROG" commarea <record> resp <status>;` and test the status.',
          backendProfile: null,
        }),
      );
    }

    if (statement.commarea && !scope.has(statement.commarea)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `Unresolved COMMAREA record: ${statement.commarea}.`,
          span: statement.span,
          hint: "Pass a record-typed parameter or local.",
          backendProfile: null,
        }),
      );
    }
  }

  // A syncpoint inside a loop commits partial work on each pass.
  if (statement.operation !== "link" && inLoopBody) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-CICS-003",
        severity: "error",
        message: `A ${statement.operation} inside a loop commits or discards partial work on every iteration.`,
        span: statement.span,
        hint: "Move the syncpoint outside the loop.",
        backendProfile: null,
      }),
    );
  }

  if (statement.respName) {
    cicsRespCaptured.add(statement.respName);
  }
}

function validateSqlStatement(
  statement: SqlStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const declared = sqlMap.get(statement.name);
  if (!declared) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved SQL statement: ${statement.name}.`,
        span: statement.span,
        hint: "Declare it with `sql <name>(...) : <Record> { ... }`.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.args.length !== declared.parameters.length) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${statement.name} expects ${declared.parameters.length} argument(s) but received ${statement.args.length}.`,
        span: statement.span,
        hint: `Signature: ${declared.parameters.map((parameter) => `${parameter.name}: ${describeType(parameter.type)}`).join(", ")}.`,
        backendProfile: null,
      }),
    );
  }

  for (let index = 0; index < statement.args.length; index += 1) {
    const actual = inferExpressionType(
      statement.args[index],
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    const expected = declared.parameters[index]?.type;
    if (actual && expected && !typesCompatible(expected, actual)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-SQL-003",
          severity: "error",
          message: `Argument ${index + 1} of ${statement.name} expects ${describeType(expected)} but received ${describeType(actual)}.`,
          span: statement.args[index].span,
          hint: "A host variable must match the declared parameter layout.",
          backendProfile: null,
        }),
      );
    }
  }

  if (statement.intoRecord) {
    const target = scope.get(statement.intoRecord);
    if (!target) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `Unresolved record variable: ${statement.intoRecord}.`,
          span: statement.span,
          hint: "Pass a record-typed parameter or local.",
          backendProfile: null,
        }),
      );
    } else if (
      target.kind !== "record" ||
      !declared.result ||
      target.name !== declared.result.name
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-SQL-003",
          severity: "error",
          message: `${statement.name} returns ${declared.result?.name ?? "no record"}, but ${statement.intoRecord} is ${describeType(target)}.`,
          span: statement.span,
          hint: "The target record must match the declared result type.",
          backendProfile: null,
        }),
      );
    }
  } else if (declared.result) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-003",
        severity: "error",
        message: `${statement.name} returns ${declared.result.name} but the result is discarded.`,
        span: statement.span,
        hint: `Write \`execute ${statement.name}(...) into <record>;\`.`,
        backendProfile: null,
      }),
    );
  }

  sqlExecuted = true;
}

/**
 * `switch` over an enum. Every case must name a real member, cases must not
 * repeat, and a switch with no `else` must cover every member, so adding an
 * enum member surfaces every place that has to handle it.
 */
function validateSwitchStatement(
  statement: SwitchStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const subject = inferExpressionType(
    statement.subject,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (!subject) {
    return;
  }

  if (subject.kind !== "enum") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `switch requires an enum value, but received ${describeType(subject)}.`,
        span: statement.subject.span,
        hint: "Switch over a declared enum.",
        backendProfile: null,
      }),
    );
    return;
  }

  const seen = new Set<string>();
  for (const branch of statement.cases) {
    if (!subject.members.includes(branch.member)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-006",
          severity: "error",
          message: `Enum ${subject.name} has no member named ${branch.member}.`,
          span: branch.span,
          hint: `Members: ${subject.members.join(", ")}.`,
          backendProfile: null,
        }),
      );
      continue;
    }
    if (seen.has(branch.member)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-005",
          severity: "error",
          message: `Duplicate switch case for ${branch.member}.`,
          span: branch.span,
          hint: "Each member may appear once.",
          backendProfile: null,
        }),
      );
    }
    seen.add(branch.member);
  }

  if (!statement.otherwise) {
    const missing = subject.members.filter((member) => !seen.has(member));
    if (missing.length > 0) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-010",
          severity: "error",
          message: `switch over ${subject.name} does not handle: ${missing.join(", ")}.`,
          span: statement.span,
          hint: "Handle every member, or add an else branch.",
          backendProfile: null,
        }),
      );
    }
  }

  for (const branch of statement.cases) {
    validateBranchBody(
      branch.body,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
      inTransaction,
    );
  }

  if (statement.otherwise) {
    validateBranchBody(
      statement.otherwise,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
      inTransaction,
    );
  }
}

/** Body of a switch case or loop: effects and locals, no terminal statement. */
function validateBranchBody(
  block: BlockNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  for (const statement of block.statements) {
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
    if (
      validateEffectStatement(
        statement,
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
    if (inTransaction && statement.kind === "LedgerStatement") {
      validateLedgerStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      continue;
    }
    if (inTransaction && statement.kind === "AuditStatement") {
      validateAuditStatement(statement, scope, aliases, recordMap, diagnostics);
      continue;
    }
    if (inTransaction && statement.kind === "IfStatement") {
      validateTransactionBranch(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
      );
      continue;
    }
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-007",
        severity: "error",
        message: `A ${statement.kind} is not allowed in this position.`,
        span: statement.span,
        hint: "Case and loop bodies carry effects.",
        backendProfile: null,
      }),
    );
  }
}

/**
 * `for each <index> in <array>` iterates a bounded array.
 *
 * The bound comes from the declared array length, so no limit clause is
 * needed and the loop cannot run away.
 */
function validateForEachStatement(
  statement: ForEachStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const arrayType = inferExpressionType(
    statement.array,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (!arrayType) {
    return;
  }

  if (arrayType.kind !== "array") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Cannot iterate ${describeType(arrayType)}, which is not an array.`,
        span: statement.array.span,
        hint: "Iterate a field declared as T[n].",
        backendProfile: null,
      }),
    );
    return;
  }

  // The index is scoped to the loop and typed to hold the array's bound.
  const indexType: ResolvedType = {
    kind: "decimal",
    precision: Math.max(String(arrayType.length).length, 4),
    scale: 0,
  };
  const shadowed = scope.get(statement.indexName);
  scope.set(statement.indexName, indexType);
  if (!locals.some((local) => local.name === statement.indexName)) {
    locals.push({
      name: statement.indexName,
      span: statement.span,
      type: indexType,
    });
  }

  const previousInLoop = inLoopBody;
  inLoopBody = true;
  validateBranchBody(
    statement.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
    inTransaction,
  );
  inLoopBody = previousInLoop;

  if (shadowed) {
    scope.set(statement.indexName, shadowed);
  } else {
    scope.delete(statement.indexName);
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

  const previousInLoop = inLoopBody;
  inLoopBody = true;
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
  inLoopBody = previousInLoop;
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
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
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

  if (statement.key) {
    if (file.organization !== "indexed") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-004",
          severity: "error",
          message: `Only an indexed file supports a keyed read, but ${file.name} is ${file.organization}.`,
          span: statement.span,
          hint: "Declare the file as indexed with a record key.",
          backendProfile: null,
        }),
      );
    } else {
      const keyType = inferExpressionType(
        statement.key,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (
        keyType &&
        file.keyField &&
        !typesCompatible(file.keyField.type, keyType)
      ) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-004",
            severity: "error",
            message: `Key expression is ${describeType(keyType)} but the record key ${file.keyField.name} is ${describeType(file.keyField.type)}.`,
            span: statement.key.span,
            hint: "The key must match the declared record key field.",
            backendProfile: null,
          }),
        );
      }
    }
  } else if (
    statement.operation === "read" &&
    file.organization === "indexed"
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-004",
        severity: "error",
        message: `Reading indexed file ${file.name} requires a key.`,
        span: statement.span,
        hint: `Write \`read ${file.name} into <record> key <value>;\`.`,
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

  sqlExecuted = false;
  sqlCodeTested = false;
  validateFunctionBody(
    declaration.body,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );

  checkSqlCodeHandled(declaration.span, diagnostics);

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
    case "SwitchStatement":
    case "SqlStatement":
    case "CicsStatement":
    case "ForEachStatement":
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

  const previousGuards = guardedNullables;
  const guards = new Set(previousGuards);
  collectGuards(statement.condition, guards);
  guardedNullables = guards;
  const thenType = validateBlock(
    statement.thenBranch,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  guardedNullables = previousGuards;
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
      if (expression.name === "sqlcode") {
        sqlCodeTested = true;
      }
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
      return {
        kind: "string",
        length: expression.value.length,
        literal: true,
      };
    case "MemberAccess": {
      // Reaching a field of an array element, such as `lines[i].amount`.
      if (expression.target.kind === "IndexAccess") {
        const element = inferExpressionType(
          expression.target,
          scope,
          aliases,
          recordMap,
          diagnostics,
        );
        if (!element) {
          return null;
        }
        if (element.kind !== "record") {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-TYPE-003",
              severity: "error",
              message: `Cannot read field ${expression.member} of ${describeType(element)}.`,
              span: expression.span,
              hint: "Field access needs an array of records.",
              backendProfile: null,
            }),
          );
          return null;
        }
        const field = element.fields.find(
          (candidate) => candidate.name === expression.member,
        );
        if (!field) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-TYPE-006",
              severity: "error",
              message: `Record ${element.name} has no field named ${expression.member}.`,
              span: expression.span,
              hint: `Use one of: ${element.fields.map((candidate) => candidate.name).join(", ")}.`,
              backendProfile: null,
            }),
          );
          return null;
        }
        return field.type;
      }

      const targetName = expression.target.name;
      // `Status.ACTIVE` where `Status` is a declared enum, not a value.
      const enumType = enumMap.get(targetName);
      if (enumType && !scope.has(targetName)) {
        if (!enumType.members.includes(expression.member)) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-TYPE-006",
              severity: "error",
              message: `Enum ${enumType.name} has no member named ${expression.member}.`,
              span: expression.span,
              hint: `Members: ${enumType.members.join(", ")}.`,
              backendProfile: null,
            }),
          );
          return null;
        }
        return {
          kind: "enum",
          name: enumType.name,
          members: enumType.members,
        };
      }

      const target = scope.get(targetName);
      if (!target) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-001",
            severity: "error",
            message: `Unresolved type or symbol: ${targetName}.`,
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
            message: `Field access requires a record value, but ${targetName} is not a record.`,
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
      // Money is rounded at least as often as a plain decimal, so currency
      // operands are accepted and keep their currency.
      if (operand.kind === "currency") {
        return operand;
      }

      if (!isDecimalType(operand)) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `${expression.isDivision ? "divide" : "round"} requires a decimal or currency operand.`,
            span: expression.span,
            hint: "Rounding applies to numeric arithmetic only.",
            backendProfile: null,
          }),
        );
        return null;
      }
      // The scale is decided by the assignment target, exactly as COBOL's
      // ROUNDED attaches to the receiving field.
      return { ...operand, rounded: true };
    }
    case "EnumMember": {
      const enumType = enumMap.get(expression.enumName);
      return enumType
        ? { kind: "enum", name: enumType.name, members: enumType.members }
        : null;
    }
    case "IndexAccess": {
      const target = inferExpressionType(
        expression.target,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      const index = inferExpressionType(
        expression.index,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );

      if (!target) {
        return null;
      }

      if (target.kind !== "array") {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `Cannot index ${describeType(target)}, which is not an array.`,
            span: expression.span,
            hint: "Index a field declared as T[n].",
            backendProfile: null,
          }),
        );
        return null;
      }

      if (index && !(index.kind === "decimal" && index.scale === 0)) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: "An array index must be a whole-number decimal.",
            span: expression.index.span,
            hint: "Use decimal<n, 0> for indexes.",
            backendProfile: null,
          }),
        );
      }

      // A literal index out of range is a compile-time error; a computed index
      // is not bounds-checked at run time, which is recorded as a known gap.
      if (
        expression.index.kind === "DecimalLiteral" &&
        !expression.index.text.includes(".")
      ) {
        const value = Number(expression.index.text);
        if (value < 1 || value > target.length) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-TYPE-009",
              severity: "error",
              message: `Index ${value} is outside the bounds of an array of ${target.length}.`,
              span: expression.index.span,
              hint: `Valid indexes are 1 to ${target.length}.`,
              backendProfile: null,
            }),
          );
        }
      }

      return target.element;
    }
    case "NullableCheck": {
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
      if (operand.kind !== "nullable") {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `${expression.operation} requires a nullable value, but received ${describeType(operand)}.`,
            span: expression.span,
            hint: "Only nullable<T> values need a presence check.",
            backendProfile: null,
          }),
        );
        return null;
      }

      if (expression.operation === "isPresent") {
        return { kind: "bool" };
      }

      // valueOf is only legal where a preceding isPresent check guards it.
      if (!guardedNullables.has(nullableKey(expression.operand))) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-008",
            severity: "error",
            message: "A nullable value is used without a presence check.",
            span: expression.span,
            hint: "Guard the use with `if isPresent(value) { ... valueOf(value) ... }`.",
            backendProfile: null,
          }),
        );
        return null;
      }

      return operand.inner;
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

/** Declared enums, for resolving member references and switch cases. */
let enumMap = new Map<string, ResolvedEnum>();

/** Declared SQL statements, for resolving execute statements. */
let sqlMap = new Map<string, ResolvedSql>();

/**
 * Whether the body being checked runs SQL, and whether it tests SQLCODE.
 *
 * An unchecked SQLCODE is the classic embedded-SQL defect: a row that was not
 * found looks identical to a row that was.
 */
let sqlExecuted = false;
let sqlCodeTested = false;

/** Whether the transaction being checked is a CICS transaction. */
let currentTransactionIsCics = false;

/** Whether the statement being checked sits inside a loop body. */
let inLoopBody = false;

/** Response variables captured by CICS commands in the current body. */
let cicsRespCaptured = new Set<string>();

/**
 * File status fields are readable in any body, so a loop can test them.
 * They are compiler-owned storage, not user locals.
 */
/** Declares every `resp` variable a CICS body names, so it can be tested. */
function declareCicsRespSymbols(
  block: BlockNode,
  scope: Map<string, ResolvedType>,
): void {
  for (const statement of block.statements) {
    if (statement.kind === "CicsStatement" && statement.respName) {
      scope.set(statement.respName, {
        kind: "decimal",
        precision: 9,
        scale: 0,
      });
    }
    if (statement.kind === "IfStatement") {
      declareCicsRespSymbols(statement.thenBranch, scope);
      if (statement.elseBranch) {
        declareCicsRespSymbols(statement.elseBranch, scope);
      }
    }
    if (statement.kind === "WhileStatement") {
      declareCicsRespSymbols(statement.body, scope);
    }
    if (statement.kind === "SwitchStatement") {
      for (const branch of statement.cases) {
        declareCicsRespSymbols(branch.body, scope);
      }
      if (statement.otherwise) {
        declareCicsRespSymbols(statement.otherwise, scope);
      }
    }
  }
}

function declareFileStatusSymbols(scope: Map<string, ResolvedType>): void {
  for (const file of declaredFiles.values()) {
    if (file.statusName && !scope.has(file.statusName)) {
      scope.set(file.statusName, { kind: "string", length: 2 });
    }
  }

  // SQLCODE is readable wherever SQL can run, mirroring the SQLCA field.
  if (sqlMap.size > 0 && !scope.has("sqlcode")) {
    scope.set("sqlcode", { kind: "decimal", precision: 9, scale: 0 });
  }
}

/**
 * Reports BANK-SQL-001 when a body runs SQL without ever testing SQLCODE.
 *
 * Checked per body rather than per statement, because the natural shape is one
 * or more executes followed by a single check of the outcome.
 */
function checkSqlCodeHandled(
  span: SourceSpan,
  diagnostics: Diagnostic[],
): void {
  if (sqlExecuted && !sqlCodeTested) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-001",
        severity: "error",
        message: "SQL runs here but SQLCODE is never checked.",
        span,
        hint: "Test `sqlcode` after the execute; a row that was not found otherwise looks identical to one that was.",
        backendProfile: null,
      }),
    );
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
 * Nullable values proven present by an enclosing `isPresent` check.
 *
 * Tracked by source text of the operand, which is enough for the single-level
 * access the subset allows and keeps the check free of dataflow machinery.
 */
let guardedNullables = new Set<string>();

function nullableKey(expression: ExpressionNode): string {
  switch (expression.kind) {
    case "Identifier":
      return expression.name;
    case "MemberAccess":
      return `${nullableKey(expression.target)}.${expression.member}`;
    default:
      return `<${expression.kind}>`;
  }
}

/** Collects the nullable values an `isPresent` condition proves present. */
function collectGuards(expression: ExpressionNode, into: Set<string>): void {
  if (
    expression.kind === "NullableCheck" &&
    expression.operation === "isPresent"
  ) {
    into.add(nullableKey(expression.operand));
    return;
  }
  if (expression.kind === "BinaryExpression" && expression.operator === "&&") {
    collectGuards(expression.left, into);
    collectGuards(expression.right, into);
  }
}

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
    case "currency":
      return `currency<"${type.code}", ${type.precision}, ${type.scale}>`;
    case "enum":
      return type.name;
    case "nullable":
      return `nullable<${describeType(type.inner)}>`;
    case "array":
      return `${describeType(type.element)}[${type.length}]`;
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

    if (left.kind === "currency" || right.kind === "currency") {
      const currency =
        left.kind === "currency" ? left : (right as CurrencyType);
      const other = left.kind === "currency" ? right : left;

      // A literal is comparable with any currency at the same scale.
      if (isDecimalType(other) && other.literal) {
        if (other.scale !== currency.scale) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-TYPE-003",
              severity: "error",
              message: `A literal compared with ${describeType(currency)} must have scale ${currency.scale}.`,
              span: expression.span,
              hint: "Write the literal at the currency's scale.",
              backendProfile: null,
            }),
          );
          return null;
        }
        return { kind: "bool" };
      }

      if (
        left.kind !== "currency" ||
        right.kind !== "currency" ||
        left.code !== right.code
      ) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-DEC-005",
            severity: "error",
            message: `Cannot compare ${describeType(left)} with ${describeType(right)}.`,
            span: expression.span,
            hint: "Compare amounts in the same currency.",
            backendProfile: null,
          }),
        );
        return null;
      }
      return { kind: "bool" };
    }

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

  // Currency values combine only with the same currency. A written literal has
  // no currency of its own, so it adopts the currency of the other operand;
  // that keeps `balance + 1.00` legal without weakening the nominal typing.
  if (left.kind === "currency" || right.kind === "currency") {
    const currency = left.kind === "currency" ? left : (right as CurrencyType);
    const other = left.kind === "currency" ? right : left;

    // Scaling money by a dimensionless factor is a normal banking operation:
    // a rate or a count has no currency of its own, and the result keeps the
    // currency of the amount. Adding across types is a different matter and
    // still needs both sides to agree.
    const scaling = operator === "*" || operator === "/";
    if (scaling && isDecimalType(other)) {
      return currency;
    }

    if (isDecimalType(other) && other.literal) {
      if (other.scale !== currency.scale) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `A literal combined with ${describeType(currency)} must have scale ${currency.scale}.`,
            span: expression.span,
            hint: "Write the literal at the currency's scale.",
            backendProfile: null,
          }),
        );
        return null;
      }
      return currency;
    }

    if (left.kind !== "currency" || right.kind !== "currency") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DEC-005",
          severity: "error",
          message: `Cannot combine ${describeType(left)} with ${describeType(right)}.`,
          span: expression.span,
          hint: "Convert to a currency type explicitly before combining.",
          backendProfile: null,
        }),
      );
      return null;
    }
    if (left.code !== right.code) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DEC-005",
          severity: "error",
          message: `Cannot combine ${left.code} with ${right.code}.`,
          span: expression.span,
          hint: "Different currencies need an explicit conversion with a stated rate and rounding mode.",
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
          message: `Currency ${operator} requires matching scale.`,
          span: expression.span,
          hint: "Rescale one side with an explicit rounding mode.",
          backendProfile: null,
        }),
      );
      return null;
    }
    return left;
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
    case "CurrencyType":
      return {
        kind: "currency",
        code: node.code,
        precision: node.precision,
        scale: node.scale,
      };
    case "NullableType": {
      const inner = resolveTypeNode(
        node.inner,
        aliases,
        recordMap,
        diagnostics,
        span,
      );
      return inner ? { kind: "nullable", inner } : null;
    }
    case "ArrayType": {
      if (!Number.isInteger(node.length) || node.length <= 0) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-002",
            severity: "error",
            message: "Array length must be a positive whole number.",
            span,
            hint: "Arrays must be statically bounded, such as LedgerEntry[100].",
            backendProfile: null,
          }),
        );
        return null;
      }
      const element = resolveTypeNode(
        node.element,
        aliases,
        recordMap,
        diagnostics,
        span,
      );
      return element ? { kind: "array", element, length: node.length } : null;
    }
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

  const enumType = enumMap.get(node.name);
  if (enumType) {
    return {
      kind: "enum",
      name: enumType.name,
      members: enumType.members,
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
  const digits = node.text.replace(".", "").replace(/^0+/, "").length;
  // Precision must cover the scale: `0.00` is scale 2, so it needs at least
  // two digits even though every one of them is a zero.
  const precision = Math.max(digits, scale, 1);
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
  // A decimal literal has no currency of its own, so it fits a currency field
  // of the same scale. Checked before the kind comparison, which would
  // otherwise reject it outright.
  if (left.kind === "currency" && right.kind === "decimal" && right.literal) {
    return right.scale === left.scale && right.precision <= left.precision;
  }
  if (right.kind === "currency" && left.kind === "decimal" && left.literal) {
    return left.scale === right.scale && left.precision <= right.precision;
  }

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
    // A literal fits any field long enough to hold it; COBOL pads with spaces.
    if (right.literal) {
      return right.length <= left.length;
    }
    if (left.literal) {
      return left.length <= right.length;
    }
    return left.length === right.length;
  }

  if (left.kind === "record" && right.kind === "record") {
    return left.name === right.name;
  }

  // Currency is nominal: two currencies with identical precision and scale are
  // still different types. That is the whole point of BANK-DEC-005.
  if (left.kind === "currency" && right.kind === "currency") {
    return (
      left.code === right.code &&
      left.precision === right.precision &&
      left.scale === right.scale
    );
  }

  if (left.kind === "enum" && right.kind === "enum") {
    return left.name === right.name;
  }

  if (left.kind === "nullable" && right.kind === "nullable") {
    return typesCompatible(left.inner, right.inner);
  }

  if (left.kind === "array" && right.kind === "array") {
    return (
      left.length === right.length &&
      typesCompatible(left.element, right.element)
    );
  }

  return true;
}
