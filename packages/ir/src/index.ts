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
  type ComparisonOperator,
  type LogicalOperator,
  type RoundingMode,
  type UnaryExpressionNode,
  type RoundedExpressionNode,
  type CallExpressionNode,
  type WhileStatementNode,
  type AssignStatementNode,
  type FileStatementNode,
} from "../../ast/src/index";
import type {
  DecimalType,
  ResolvedField,
  ResolvedFunction,
  ResolvedRecord,
  ResolvedLocal,
  ResolvedTransaction,
  ResolvedSql,
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
  files: IRFile[];
  enums: IREnum[];
  sql: IRSql[];
  /**
   * Preprocessing the generated COBOL needs before a compiler will accept it.
   *
   * A program using embedded SQL requires the Db2 precompiler, so plain COBOL
   * compilation is not a meaningful check and must not be reported as one.
   */
  backendRequirements: BackendRequirement[];
}

export type BackendRequirement = "db2-precompiler" | "cics-translator";

export interface IRSql {
  kind: "Sql";
  name: string;
  span: SourceSpan;
  parameters: IRParameter[];
  resultRecordName: string | null;
  text: string;
  hostVariables: { name: string; origin: "parameter" | "result" }[];
}

export interface IREnum {
  kind: "Enum";
  name: string;
  span: SourceSpan;
  members: string[];
}

export interface IRFile {
  kind: "File";
  name: string;
  span: SourceSpan;
  organization: "sequential" | "indexed" | "relative";
  mode: "input" | "output";
  record: IRRecord;
  statusName: string | null;
  keyFieldName: string | null;
}

export interface IRTransaction {
  kind: "Transaction";
  name: string;
  span: SourceSpan;
  parameters: IRParameter[];
  body: IRBlock;
  /** The `on failure` block, lowered. Null when none is declared. */
  failureHandler: IRBlock | null;
  /**
   * True when the body can abandon its work: it raises, guards a computed
   * subscript, or calls a function that does either.
   *
   * The backend only emits the failure plumbing for a transaction that can
   * reach it, so a transaction with no failure path generates exactly the COBOL
   * it did before the exception model existed.
   */
  canFail: boolean;
  /** True when the body posts to the ledger, so a failure has to unwind it. */
  postsToLedger: boolean;
  /** True for the transaction the generated program starts at. */
  isEntry: boolean;
  isCics: boolean;
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
  /**
   * True when the function can reach itself, directly or through other
   * functions. A COBOL paragraph is not reentrant, so a recursive function is
   * emitted as a separate RECURSIVE program instead.
   */
  isRecursive: boolean;
  /**
   * True when the function raises, guards a computed subscript, or calls a
   * function that does. A caller has to test the failure code after performing
   * one of these, because COBOL has no unwinding of its own.
   */
  canFail: boolean;
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
  | IRAuditStatement
  | IRWhileStatement
  | IRAssignStatement
  | IRExpressionStatement
  | IRFileStatement
  | IRSwitchStatement
  | IRSqlStatement
  | IRCicsStatement
  | IRForEachStatement
  | IRRaiseStatement;

/**
 * `raise "CODE"` — abandons the rest of the body and hands control to the
 * enclosing transaction's failure path.
 */
export interface IRRaiseStatement {
  kind: "RaiseStatement";
  span: SourceSpan;
  code: string;
}

export interface IRForEachStatement {
  kind: "ForEachStatement";
  span: SourceSpan;
  indexName: string;
  /** COBOL group item the array field is qualified by. */
  arrayRecordName: string;
  arrayFieldName: string;
  length: number;
  body: IRBlock;
}

export interface IRCicsStatement {
  kind: "CicsStatement";
  span: SourceSpan;
  operation: "link" | "syncpoint" | "rollback";
  program: string | null;
  commarea: string | null;
  respName: string | null;
}

export interface IRSqlStatement {
  kind: "SqlStatement";
  span: SourceSpan;
  name: string;
  args: IRExpression[];
  intoRecord: string | null;
}

export interface IRSwitchStatement {
  kind: "SwitchStatement";
  span: SourceSpan;
  subject: IRExpression;
  enumName: string;
  cases: { member: string; body: IRBlock }[];
  otherwise: IRBlock | null;
}

export interface IRWhileStatement {
  kind: "WhileStatement";
  span: SourceSpan;
  condition: IRExpression;
  limit: number;
  body: IRBlock;
}

export interface IRAssignStatement {
  kind: "AssignStatement";
  span: SourceSpan;
  target: IRIdentifierExpression | IRMemberAccessExpression;
  expression: IRExpression;
}

export interface IRExpressionStatement {
  kind: "ExpressionStatement";
  span: SourceSpan;
  expression: IRExpression;
}

export interface IRFileStatement {
  kind: "FileStatement";
  span: SourceSpan;
  operation: "open" | "read" | "write" | "close";
  fileName: string;
  recordName: string | null;
  /** Mode of the declared file, needed to emit OPEN INPUT vs OPEN OUTPUT. */
  fileMode: "input" | "output";
  fileOrganization: "sequential" | "indexed" | "relative";
  statusName: string | null;
  keyFieldName: string | null;
  key: IRExpression | null;
  /**
   * The file record's fields, for per-field mapping. An array field carries
   * its bound, because COBOL cannot move an OCCURS item without a subscript.
   */
  recordFields: { name: string; arrayLength: number | null }[];
}

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
  | IRBinaryArithmeticExpression
  | IRLogicalExpression
  | IRNotExpression
  | IRRoundedExpression
  | IRCallExpression
  | IREnumMemberExpression
  | IRIndexAccessExpression
  | IRNullableCheckExpression;

export interface IREnumMemberExpression {
  kind: "EnumMember";
  span: SourceSpan;
  enumName: string;
  member: string;
  resolvedType: EnumIRType;
}

export interface IRIndexAccessExpression {
  kind: "IndexAccess";
  span: SourceSpan;
  target: IRIdentifierExpression | IRMemberAccessExpression;
  index: IRExpression;
  /** Declared array bound, used to emit a runtime range check. */
  length: number;
  /** False when the index is a literal the compiler already proved in range. */
  needsBoundsCheck: boolean;
  resolvedType: IRType;
}

export interface IRNullableCheckExpression {
  kind: "NullableCheck";
  span: SourceSpan;
  operation: "isPresent" | "valueOf";
  operand: IRExpression;
  resolvedType: IRType;
}

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
  /** Subscript when the field is reached through an array element. */
  index: IRExpression | null;
  /** Declared bound of the array the subscript indexes. */
  indexLength: number;
  /** False when the subscript is a literal already proven in range. */
  indexNeedsBoundsCheck: boolean;
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
  operator: ComparisonOperator;
  left: IRExpression;
  right: IRExpression;
  resolvedType: BoolIRType;
}

export interface IRLogicalExpression {
  kind: "Logical";
  span: SourceSpan;
  operator: LogicalOperator;
  left: IRExpression;
  right: IRExpression;
  resolvedType: BoolIRType;
}

export interface IRNotExpression {
  kind: "Not";
  span: SourceSpan;
  operand: IRExpression;
  resolvedType: BoolIRType;
}

/** Arithmetic carrying an explicit rounding mode, from round() or divide(). */
export interface IRRoundedExpression {
  kind: "Rounded";
  span: SourceSpan;
  operand: IRExpression;
  mode: RoundingMode;
  resolvedType: DecimalIRType;
}

export interface IRCallExpression {
  kind: "Call";
  span: SourceSpan;
  callee: string;
  args: IRExpression[];
  resolvedType: IRType;
}

export interface IRBinaryArithmeticExpression {
  kind: "BinaryArithmetic";
  span: SourceSpan;
  operator: "+" | "-" | "*" | "/";
  left: IRExpression;
  right: IRExpression;
  resolvedType: DecimalIRType;
}

export type IRType =
  | DecimalIRType
  | StringIRType
  | BoolIRType
  | RecordIRType
  | CurrencyIRType
  | EnumIRType
  | NullableIRType
  | ArrayIRType;

export interface CurrencyIRType {
  kind: "currency";
  code: string;
  precision: number;
  scale: number;
}

export interface EnumIRType {
  kind: "enum";
  name: string;
  members: string[];
}

export interface NullableIRType {
  kind: "nullable";
  inner: IRType;
}

export interface ArrayIRType {
  kind: "array";
  element: IRType;
  length: number;
}

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

  fileTable.clear();
  for (const file of typechecked.files) {
    fileTable.set(file.name, {
      mode: file.mode,
      organization: file.organization,
      statusName: file.statusName,
      keyFieldName: file.keyField?.name ?? null,
      recordFields: file.record.fields.map((field) => ({
        name: field.name,
        arrayLength: field.type.kind === "array" ? field.type.length : null,
      })),
    });
  }

  enumTable.clear();
  for (const entry of typechecked.enums) {
    enumTable.set(entry.name, entry.members);
  }

  sqlTable.clear();
  for (const entry of typechecked.sql) {
    sqlTable.set(entry.name, entry);
  }

  functionTable.clear();
  for (const fn of typechecked.functions) {
    functionTable.set(fn.name, lowerType(fn.returnType));
  }

  callTargetTable = typechecked.callTargets;

  const loweredFunctions = typechecked.functions.map((fn) => lowerFunction(fn));
  const recursive = findRecursiveFunctions(loweredFunctions);
  const failing = findFailingFunctions(loweredFunctions);
  const functions = loweredFunctions.map((fn) => ({
    ...fn,
    isRecursive: recursive.has(fn.name),
    canFail: failing.has(fn.name),
  }));
  const transactions = typechecked.transactions
    .map((transaction) => lowerTransaction(transaction))
    .map((transaction) => ({
      ...transaction,
      canFail:
        blockCanFail(transaction.body) ||
        [...collectCalls(transaction.body)].some((callee) =>
          failing.has(callee),
        ),
      postsToLedger: blockPostsToLedger(transaction.body),
    }));
  const files = typechecked.files.map((file) => ({
    kind: "File" as const,
    name: file.name,
    span: file.span,
    organization: file.organization,
    mode: file.mode,
    record: lowerRecord(file.record, recordTypeMap),
    statusName: file.statusName,
    keyFieldName: file.keyField?.name ?? null,
  }));

  return {
    program: {
      kind: "Program",
      sourceFile: moduleDeclaration.span.sourceFile,
      moduleName: moduleDeclaration.name,
      moduleSpan: moduleDeclaration.span,
      records,
      functions,
      transactions,
      files,
      enums: typechecked.enums.map((entry) => ({
        kind: "Enum" as const,
        name: entry.name,
        span: entry.span,
        members: entry.members,
      })),
      sql: typechecked.sql.map((entry) => ({
        kind: "Sql" as const,
        name: entry.name,
        span: entry.span,
        parameters: entry.parameters.map((parameter) => ({
          kind: "Parameter" as const,
          name: parameter.name,
          span: parameter.span,
          type: lowerType(parameter.type),
        })),
        resultRecordName: entry.result?.name ?? null,
        text: entry.text,
        hostVariables: entry.hostVariables,
      })),
      backendRequirements: [
        ...(typechecked.sql.length > 0 ? (["db2-precompiler"] as const) : []),
        ...(typechecked.transactions.some((entry) => entry.isCics)
          ? (["cics-translator"] as const)
          : []),
      ],
    },
    diagnostics: typechecked.diagnostics,
  };
}

/** Declared files and function return types, for lowering references. */
const fileTable = new Map<
  string,
  {
    mode: "input" | "output";
    organization: "sequential" | "indexed" | "relative";
    statusName: string | null;
    keyFieldName: string | null;
    recordFields: { name: string; arrayLength: number | null }[];
  }
>();
const functionTable = new Map<string, IRType>();

/**
 * The concrete function each generic call resolves to, from the typechecker.
 *
 * A generic function has no paragraph of its own, so lowering has to read the
 * instantiation rather than the callee the author wrote.
 */
let callTargetTable: ReadonlyMap<CallExpressionNode, string> = new Map();

/** Declared enums, for lowering member references and switch statements. */
const enumTable = new Map<string, string[]>();

/** Index variables a `for each` already bounds, so they need no range check. */
let boundedIndexNames = new Set<string>();

function indexIsProvenInRange(index: ExpressionNode): boolean {
  if (index.kind === "Identifier") {
    return boundedIndexNames.has(index.name);
  }
  return index.kind === "DecimalLiteral" && !index.text.includes(".");
}

/** Declared SQL statements, for lowering execute statements. */
const sqlTable = new Map<string, ResolvedSql>();

/** File status fields are readable in any body, so they must be in IR scope. */
function addFileStatusSymbols(scopeTypes: Map<string, IRType>): void {
  for (const [, file] of fileTable) {
    if (file.statusName && !scopeTypes.has(file.statusName)) {
      scopeTypes.set(file.statusName, { kind: "string", length: 2 });
    }
  }

  if (sqlTable.size > 0 && !scopeTypes.has("sqlcode")) {
    scopeTypes.set("sqlcode", { kind: "decimal", precision: 9, scale: 0 });
  }
}

/** CICS response variables are compiler-owned storage. */
function addCicsRespSymbols(
  block: { statements: StatementNode[] },
  scopeTypes: Map<string, IRType>,
): void {
  for (const statement of block.statements) {
    if (statement.kind === "CicsStatement" && statement.respName) {
      scopeTypes.set(statement.respName, {
        kind: "decimal",
        precision: 9,
        scale: 0,
      });
    }
    if (statement.kind === "IfStatement") {
      addCicsRespSymbols(statement.thenBranch, scopeTypes);
      if (statement.elseBranch) {
        addCicsRespSymbols(statement.elseBranch, scopeTypes);
      }
    }
    if (statement.kind === "WhileStatement") {
      addCicsRespSymbols(statement.body, scopeTypes);
    }
    if (statement.kind === "SwitchStatement") {
      for (const branch of statement.cases) {
        addCicsRespSymbols(branch.body, scopeTypes);
      }
      if (statement.otherwise) {
        addCicsRespSymbols(statement.otherwise, scopeTypes);
      }
    }
  }
}

/**
 * Functions that can reach themselves, directly or through a cycle.
 *
 * COBOL paragraphs are not reentrant: performing a paragraph that is already
 * active is undefined. Recursive functions therefore have to be emitted
 * differently, so they are identified here rather than in the backend.
 */
/**
 * Works out which functions can abandon their body, following calls.
 *
 * A caller has to test the failure code after performing a callee that can
 * fail, so the property has to be transitive: a function that only calls
 * something that raises can still leave the failure code set on return.
 */
function findFailingFunctions(functions: IRFunction[]): Set<string> {
  const callees = new Map<string, Set<string>>();
  const failing = new Set<string>();

  for (const fn of functions) {
    callees.set(fn.name, collectCalls(fn.body));
    if (blockCanFail(fn.body)) {
      failing.add(fn.name);
    }
  }

  // Propagate until nothing new is marked. The call graph may contain cycles,
  // so a single pass in declaration order is not enough.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (failing.has(fn.name)) {
        continue;
      }
      for (const callee of callees.get(fn.name) ?? []) {
        if (failing.has(callee)) {
          failing.add(fn.name);
          changed = true;
          break;
        }
      }
    }
  }

  return failing;
}

/** True when a block raises directly or guards a computed subscript. */
function blockCanFail(block: IRBlock): boolean {
  for (const statement of block.statements) {
    switch (statement.kind) {
      case "RaiseStatement":
        return true;
      case "IfStatement":
        if (
          expressionNeedsBoundsCheck(statement.condition) ||
          blockCanFail(statement.thenBranch) ||
          (statement.elseBranch ? blockCanFail(statement.elseBranch) : false)
        ) {
          return true;
        }
        break;
      case "WhileStatement":
        if (
          expressionNeedsBoundsCheck(statement.condition) ||
          blockCanFail(statement.body)
        ) {
          return true;
        }
        break;
      case "ForEachStatement":
        if (blockCanFail(statement.body)) {
          return true;
        }
        break;
      case "SwitchStatement":
        if (
          statement.cases.some((entry) => blockCanFail(entry.body)) ||
          (statement.otherwise ? blockCanFail(statement.otherwise) : false)
        ) {
          return true;
        }
        break;
      case "LetStatement":
        if (expressionNeedsBoundsCheck(statement.initializer)) {
          return true;
        }
        break;
      case "ReturnStatement":
      case "ExpressionStatement":
        if (expressionNeedsBoundsCheck(statement.expression)) {
          return true;
        }
        break;
      case "AssignStatement":
        if (
          expressionNeedsBoundsCheck(statement.expression) ||
          expressionNeedsBoundsCheck(statement.target)
        ) {
          return true;
        }
        break;
      case "LedgerStatement":
        if (
          expressionNeedsBoundsCheck(statement.account) ||
          expressionNeedsBoundsCheck(statement.amount)
        ) {
          return true;
        }
        break;
      default:
        break;
    }
  }

  return false;
}

/** True when an expression contains a subscript the compiler could not prove. */
function expressionNeedsBoundsCheck(expression: IRExpression): boolean {
  switch (expression.kind) {
    case "IndexAccess":
      return (
        (expression.needsBoundsCheck && expression.length > 0) ||
        expressionNeedsBoundsCheck(expression.index)
      );
    case "MemberAccess":
      if (!expression.index) {
        return false;
      }
      return (
        (expression.indexNeedsBoundsCheck && expression.indexLength > 0) ||
        expressionNeedsBoundsCheck(expression.index)
      );
    case "BinaryComparison":
    case "BinaryArithmetic":
    case "Logical":
      return (
        expressionNeedsBoundsCheck(expression.left) ||
        expressionNeedsBoundsCheck(expression.right)
      );
    case "Not":
    case "Rounded":
    case "NullableCheck":
      return expressionNeedsBoundsCheck(expression.operand);
    case "Call":
      return expression.args.some(expressionNeedsBoundsCheck);
    default:
      return false;
  }
}

/** True when a block posts to the ledger, directly or in a nested block. */
function blockPostsToLedger(block: IRBlock): boolean {
  for (const statement of block.statements) {
    switch (statement.kind) {
      case "LedgerStatement":
        return true;
      case "IfStatement":
        if (
          blockPostsToLedger(statement.thenBranch) ||
          (statement.elseBranch
            ? blockPostsToLedger(statement.elseBranch)
            : false)
        ) {
          return true;
        }
        break;
      case "WhileStatement":
      case "ForEachStatement":
        if (blockPostsToLedger(statement.body)) {
          return true;
        }
        break;
      case "SwitchStatement":
        if (
          statement.cases.some((entry) => blockPostsToLedger(entry.body)) ||
          (statement.otherwise
            ? blockPostsToLedger(statement.otherwise)
            : false)
        ) {
          return true;
        }
        break;
      default:
        break;
    }
  }

  return false;
}

function findRecursiveFunctions(functions: IRFunction[]): Set<string> {
  const callees = new Map<string, Set<string>>();
  for (const fn of functions) {
    callees.set(fn.name, collectCalls(fn.body));
  }

  const recursive = new Set<string>();
  for (const fn of functions) {
    const seen = new Set<string>();
    const stack = [...(callees.get(fn.name) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (next === fn.name) {
        recursive.add(fn.name);
        break;
      }
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      stack.push(...(callees.get(next) ?? []));
    }
  }

  return recursive;
}

function collectCalls(block: IRBlock): Set<string> {
  const calls = new Set<string>();

  const walkExpression = (expression: IRExpression): void => {
    switch (expression.kind) {
      case "Call":
        calls.add(expression.callee);
        expression.args.forEach(walkExpression);
        return;
      case "BinaryComparison":
      case "BinaryArithmetic":
      case "Logical":
        walkExpression(expression.left);
        walkExpression(expression.right);
        return;
      case "Not":
      case "Rounded":
        walkExpression(expression.operand);
        return;
      case "NullableCheck":
        walkExpression(expression.operand);
        return;
      case "IndexAccess":
        walkExpression(expression.index);
        return;
      default:
        return;
    }
  };

  const walkBlock = (inner: IRBlock): void => {
    for (const statement of inner.statements) {
      switch (statement.kind) {
        case "LetStatement":
          walkExpression(statement.initializer);
          break;
        case "ReturnStatement":
        case "ExpressionStatement":
          walkExpression(statement.expression);
          break;
        case "AssignStatement":
          walkExpression(statement.expression);
          break;
        case "IfStatement":
          walkExpression(statement.condition);
          walkBlock(statement.thenBranch);
          if (statement.elseBranch) {
            walkBlock(statement.elseBranch);
          }
          break;
        case "WhileStatement":
          walkExpression(statement.condition);
          walkBlock(statement.body);
          break;
        case "ForEachStatement":
          walkBlock(statement.body);
          break;
        case "SwitchStatement":
          for (const branch of statement.cases) {
            walkBlock(branch.body);
          }
          if (statement.otherwise) {
            walkBlock(statement.otherwise);
          }
          break;
        default:
          break;
      }
    }
  };

  walkBlock(block);
  return calls;
}

function lowerTransaction(transaction: ResolvedTransaction): IRTransaction {
  const scopeTypes = new Map<string, IRType>();
  addFileStatusSymbols(scopeTypes);
  addCicsRespSymbols(transaction.body, scopeTypes);
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
    failureHandler: transaction.failureHandler
      ? lowerBlock(transaction.failureHandler, scopeTypes)
      : null,
    isEntry: transaction.isEntry,
    isCics: transaction.isCics,
    // Filled in once the call graph is known, because a transaction can also
    // fail through a function it calls.
    canFail: false,
    postsToLedger: false,
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
  addFileStatusSymbols(scopeTypes);
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
    isRecursive: false,
    canFail: false,
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
    case "WhileStatement":
      return {
        kind: "WhileStatement",
        span: statement.span,
        condition: lowerExpression(statement.condition, scopeTypes),
        limit: statement.limit,
        body: lowerBlock(statement.body, scopeTypes),
      };
    case "AssignStatement": {
      const target = lowerExpression(statement.target, scopeTypes);
      if (target.kind !== "Identifier" && target.kind !== "MemberAccess") {
        throw new Error("Assignment target must be an identifier or field.");
      }
      return {
        kind: "AssignStatement",
        span: statement.span,
        target,
        expression: lowerExpression(statement.expression, scopeTypes),
      };
    }
    case "ExpressionStatement":
      return {
        kind: "ExpressionStatement",
        span: statement.span,
        expression: lowerExpression(statement.expression, scopeTypes),
      };
    case "RaiseStatement":
      return {
        kind: "RaiseStatement",
        span: statement.span,
        code: statement.code,
      };
    case "ForEachStatement": {
      const array = lowerExpression(statement.array, scopeTypes);
      const arrayType =
        array.kind === "Identifier" || array.kind === "MemberAccess"
          ? array.resolvedType
          : undefined;
      if (!arrayType || arrayType.kind !== "array") {
        throw new Error("for each requires an array during IR lowering.");
      }

      // The index is a loop-scoped local, so it must be visible to the body.
      const bodyScope = new Map(scopeTypes);
      bodyScope.set(statement.indexName, {
        kind: "decimal",
        precision: Math.max(String(arrayType.length).length, 4),
        scale: 0,
      });

      // PERFORM VARYING already bounds this index, so a runtime range check
      // inside the body would be dead weight on every iteration.
      const previousBounded = boundedIndexNames;
      boundedIndexNames = new Set([...previousBounded, statement.indexName]);
      const loweredBody = lowerBlock(statement.body, bodyScope);
      boundedIndexNames = previousBounded;

      return {
        kind: "ForEachStatement",
        span: statement.span,
        indexName: statement.indexName,
        arrayRecordName:
          array.kind === "MemberAccess"
            ? array.recordName
            : statement.array.kind === "Identifier"
              ? statement.array.name
              : statement.array.member,
        arrayFieldName:
          array.kind === "MemberAccess"
            ? array.member
            : statement.array.kind === "Identifier"
              ? statement.array.name
              : statement.array.member,
        length: arrayType.length,
        body: loweredBody,
      };
    }
    case "CicsStatement":
      return {
        kind: "CicsStatement",
        span: statement.span,
        operation: statement.operation,
        program: statement.program,
        commarea: statement.commarea,
        respName: statement.respName,
      };
    case "SqlStatement":
      return {
        kind: "SqlStatement",
        span: statement.span,
        name: statement.name,
        args: statement.args.map((argument) =>
          lowerExpression(argument, scopeTypes),
        ),
        intoRecord: statement.intoRecord,
      };
    case "SwitchStatement": {
      const subject = lowerExpression(statement.subject, scopeTypes);
      if (subject.resolvedType.kind !== "enum") {
        throw new Error("Switch subject must be an enum during IR lowering.");
      }
      return {
        kind: "SwitchStatement",
        span: statement.span,
        subject,
        enumName: subject.resolvedType.name,
        cases: statement.cases.map((branch) => ({
          member: branch.member,
          body: lowerBlock(branch.body, scopeTypes),
        })),
        otherwise: statement.otherwise
          ? lowerBlock(statement.otherwise, scopeTypes)
          : null,
      };
    }
    case "FileStatement": {
      const file = fileTable.get(statement.fileName);
      if (!file) {
        throw new Error(
          `Unresolved file during IR lowering: ${statement.fileName}`,
        );
      }
      return {
        kind: "FileStatement",
        span: statement.span,
        operation: statement.operation,
        fileName: statement.fileName,
        recordName: statement.recordName,
        fileMode: file.mode,
        fileOrganization: file.organization,
        statusName: file.statusName,
        keyFieldName: file.keyFieldName,
        key: statement.key ? lowerExpression(statement.key, scopeTypes) : null,
        recordFields: file.recordFields,
      };
    }
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
    case "UnaryExpression":
      return {
        kind: "Not",
        span: expression.span,
        operand: lowerExpression(expression.operand, scopeTypes),
        resolvedType: { kind: "bool" },
      };
    case "RoundedExpression": {
      const operand = lowerExpression(expression.operand, scopeTypes);
      return {
        kind: "Rounded",
        span: expression.span,
        operand,
        mode: expression.mode,
        resolvedType: expressionDecimalType(operand) ?? {
          kind: "decimal",
          precision: 18,
          scale: 2,
        },
      };
    }
    case "IndexAccess": {
      const target = lowerExpression(expression.target, scopeTypes);
      if (target.kind !== "Identifier" && target.kind !== "MemberAccess") {
        throw new Error("Index target must be an identifier or field.");
      }
      const element =
        target.resolvedType.kind === "array"
          ? target.resolvedType.element
          : target.resolvedType;
      const arrayLength =
        target.resolvedType.kind === "array" ? target.resolvedType.length : 0;
      // A literal index is proven at compile time by BANK-TYPE-009, and a
      // `for each` index is bounded by its PERFORM VARYING, so neither needs a
      // runtime check.
      const literalIndex = indexIsProvenInRange(expression.index);

      return {
        kind: "IndexAccess",
        span: expression.span,
        target,
        index: lowerExpression(expression.index, scopeTypes),
        length: arrayLength,
        needsBoundsCheck: !literalIndex,
        resolvedType: element,
      };
    }
    case "NullableCheck": {
      const operand = lowerExpression(expression.operand, scopeTypes);
      const inner =
        operand.resolvedType.kind === "nullable"
          ? operand.resolvedType.inner
          : operand.resolvedType;
      return {
        kind: "NullableCheck",
        span: expression.span,
        operation: expression.operation,
        operand,
        resolvedType:
          expression.operation === "isPresent" ? { kind: "bool" } : inner,
      };
    }
    case "EnumMember":
      return {
        kind: "EnumMember",
        span: expression.span,
        enumName: expression.enumName,
        member: expression.member,
        resolvedType: {
          kind: "enum",
          name: expression.enumName,
          members: enumTable.get(expression.enumName) ?? [],
        },
      };
    case "CallExpression": {
      // A generic call names a template, which has no paragraph of its own.
      // The typechecker recorded the instantiation it resolved to.
      const callee = callTargetTable.get(expression) ?? expression.callee;
      const signature = functionTable.get(callee);
      if (!signature) {
        throw new Error(`Unresolved function during IR lowering: ${callee}`);
      }
      return {
        kind: "Call",
        span: expression.span,
        callee,
        args: expression.args.map((argument) =>
          lowerExpression(argument, scopeTypes),
        ),
        resolvedType: signature,
      };
    }
  }
}

function lowerMemberAccessExpression(
  expression: MemberAccessNode,
  scopeTypes: Map<string, IRType>,
): IRMemberAccessExpression | IREnumMemberExpression {
  // `Status.ACTIVE` parses as member access but lowers to an enum member.
  if (
    expression.target.kind === "Identifier" &&
    !scopeTypes.has(expression.target.name) &&
    enumTable.has(expression.target.name)
  ) {
    const enumName = expression.target.name;
    return {
      kind: "EnumMember",
      span: expression.span,
      enumName,
      member: expression.member,
      resolvedType: {
        kind: "enum",
        name: enumName,
        members: enumTable.get(enumName) ?? [],
      },
    };
  }

  // `lines[i].amount`: the record is the array's element type, and the
  // subscript is carried so the backend can emit FIELD OF RECORD (INDEX).
  if (expression.target.kind === "IndexAccess") {
    const indexIsLiteral = indexIsProvenInRange(expression.target.index);
    const arrayTarget = expression.target.target;
    const holderName =
      arrayTarget.kind === "Identifier" ? arrayTarget.name : arrayTarget.member;
    const holderType =
      arrayTarget.kind === "Identifier"
        ? scopeTypes.get(arrayTarget.name)
        : lowerMemberAccessExpression(arrayTarget, scopeTypes).resolvedType;

    const arrayType =
      holderType?.kind === "array"
        ? holderType
        : holderType?.kind === "record"
          ? holderType.fields.find(
              (field) =>
                arrayTarget.kind === "MemberAccess" &&
                field.name === arrayTarget.member,
            )?.type
          : undefined;

    const elementType =
      arrayType && arrayType.kind === "array" ? arrayType.element : undefined;

    if (!elementType || elementType.kind !== "record") {
      throw new Error(
        `Indexed field access requires an array of records: ${holderName}`,
      );
    }

    const field = elementType.fields.find(
      (candidate) => candidate.name === expression.member,
    );
    if (!field) {
      throw new Error(
        `Unresolved field during IR lowering: ${holderName}[..].${expression.member}`,
      );
    }

    return {
      kind: "MemberAccess",
      span: expression.span,
      targetName: holderName,
      recordName: rootRecordName(arrayTarget, scopeTypes),
      member: expression.member,
      index: lowerExpression(expression.target.index, scopeTypes),
      indexLength:
        arrayType && arrayType.kind === "array" ? arrayType.length : 0,
      indexNeedsBoundsCheck: !indexIsLiteral,
      resolvedType: field.type,
    };
  }

  if (expression.target.kind !== "Identifier") {
    throw new Error("Unsupported member access target during IR lowering.");
  }

  const targetName = expression.target.name;
  const targetType = scopeTypes.get(targetName);
  if (!targetType || targetType.kind !== "record") {
    throw new Error(`Unresolved record during IR lowering: ${targetName}`);
  }

  const field = targetType.fields.find(
    (candidate) => candidate.name === expression.member,
  );
  if (!field) {
    throw new Error(
      `Unresolved field during IR lowering: ${targetName}.${expression.member}`,
    );
  }

  return {
    kind: "MemberAccess",
    span: expression.span,
    targetName,
    recordName: targetType.name,
    member: expression.member,
    index: null,
    indexLength: 0,
    indexNeedsBoundsCheck: false,
    resolvedType: field.type,
  };
}

/** The COBOL group item a subscripted field is qualified by. */
function rootRecordName(
  target: IdentifierNode | MemberAccessNode,
  scopeTypes: Map<string, IRType>,
): string {
  if (target.kind === "MemberAccess" && target.target.kind === "Identifier") {
    const holder = scopeTypes.get(target.target.name);
    return holder?.kind === "record" ? holder.name : target.target.name;
  }
  const direct =
    target.kind === "Identifier" ? scopeTypes.get(target.name) : undefined;
  return direct?.kind === "record"
    ? direct.name
    : target.kind === "Identifier"
      ? target.name
      : target.member;
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
):
  | IRBinaryComparisonExpression
  | IRBinaryArithmeticExpression
  | IRLogicalExpression {
  const left = lowerExpression(expression.left, scopeTypes);
  const right = lowerExpression(expression.right, scopeTypes);

  const operator = expression.operator;

  if (operator === "&&" || operator === "||") {
    return {
      kind: "Logical",
      span: expression.span,
      operator,
      left,
      right,
      resolvedType: { kind: "bool" },
    };
  }

  if (COMPARISON_OPERATORS.has(operator)) {
    return {
      kind: "BinaryComparison",
      span: expression.span,
      operator: operator as ComparisonOperator,
      left,
      right,
      resolvedType: { kind: "bool" },
    };
  }

  return {
    kind: "BinaryArithmetic",
    span: expression.span,
    operator: operator as "+" | "-" | "*" | "/",
    left,
    right,
    resolvedType: arithmeticResultType(operator, left, right),
  };
}

const COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!="]);

/** Multiplication adds scales; other operators keep the operand type. */
function arithmeticResultType(
  operator: string,
  left: IRExpression,
  right: IRExpression,
): DecimalIRType {
  const leftType = expressionDecimalType(left);
  const rightType = expressionDecimalType(right);

  if (operator === "*" && leftType && rightType) {
    return {
      kind: "decimal",
      precision: Math.max(leftType.precision, rightType.precision),
      scale: leftType.scale + rightType.scale,
    };
  }

  return decimalExpressionType(left, right);
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
    expression.kind === "BinaryArithmetic" ||
    expression.kind === "Rounded"
  ) {
    return expression.resolvedType;
  }

  if (
    (expression.kind === "Identifier" ||
      expression.kind === "MemberAccess" ||
      expression.kind === "Call") &&
    expression.resolvedType.kind === "decimal"
  ) {
    return expression.resolvedType;
  }

  return null;
}

function lowerType(type: ResolvedType): IRType {
  switch (type.kind) {
    case "currency":
      return {
        kind: "currency",
        code: type.code,
        precision: type.precision,
        scale: type.scale,
      };
    case "enum":
      return { kind: "enum", name: type.name, members: type.members };
    case "nullable":
      return { kind: "nullable", inner: lowerType(type.inner) };
    case "array":
      return {
        kind: "array",
        element: lowerType(type.element),
        length: type.length,
      };
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
