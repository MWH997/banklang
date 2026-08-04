export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceSpan {
  sourceFile: string;
  start: SourcePosition;
  end: SourcePosition;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "audit";

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  span: SourceSpan | null;
  hint: string | null;
  backendProfile: string | null;
}

export interface DiagnosticInput {
  id: string;
  severity: DiagnosticSeverity;
  message: string;
  span?: SourceSpan | null;
  hint?: string | null;
  backendProfile?: string | null;
}

export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  return {
    id: input.id,
    severity: input.severity,
    message: input.message,
    span: input.span ?? null,
    hint: input.hint ?? null,
    backendProfile: input.backendProfile ?? null,
  };
}

export function formatSpan(span: SourceSpan | null): string {
  if (!span) {
    return "<unknown>";
  }

  return `${span.sourceFile}:${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.span ? ` ${formatSpan(diagnostic.span)}` : "";
  const hint = diagnostic.hint ? `\n  hint: ${diagnostic.hint}` : "";
  const backendProfile = diagnostic.backendProfile
    ? `\n  backend: ${diagnostic.backendProfile}`
    : "";
  return `${diagnostic.id} ${diagnostic.severity}${location}\n  ${diagnostic.message}${hint}${backendProfile}`;
}

export function astToJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface NodeBase {
  kind: string;
  span: SourceSpan;
}

export interface ModuleDeclarationNode extends NodeBase {
  kind: "ModuleDeclaration";
  name: string;
}

export interface DecimalTypeNode extends NodeBase {
  kind: "DecimalType";
  precision: number;
  scale: number;
}

export interface StringTypeNode extends NodeBase {
  kind: "StringType";
  length: number;
}

export interface BoolTypeNode extends NodeBase {
  kind: "BoolType";
}

export interface TypeReferenceNode extends NodeBase {
  kind: "TypeReference";
  name: string;
  /**
   * Type arguments in `Box<Money>`. Empty for a plain reference.
   *
   * COBOL has no runtime polymorphism, so a reference carrying arguments is
   * resolved by instantiating a concrete record, never by erasure.
   */
  typeArguments: TypeNode[];
}

/** A type parameter name in `record Box<T>` or `function first<T>`. */
export interface TypeParameterNode extends NodeBase {
  kind: "TypeParameter";
  name: string;
}

/**
 * `currency<"BDT", 18, 2>` — a decimal that is nominally typed by its currency
 * code, so two currencies cannot be combined without an explicit conversion.
 */
export interface CurrencyTypeNode extends NodeBase {
  kind: "CurrencyType";
  code: string;
  precision: number;
  scale: number;
}

/** `nullable<T>` — a value that must be checked before it can be used. */
export interface NullableTypeNode extends NodeBase {
  kind: "NullableType";
  inner: TypeNode;
}

/** `T[n]` — a statically bounded array, lowering to COBOL `OCCURS`. */
export interface ArrayTypeNode extends NodeBase {
  kind: "ArrayType";
  element: TypeNode;
  length: number;
}

export type TypeNode =
  | DecimalTypeNode
  | StringTypeNode
  | BoolTypeNode
  | TypeReferenceNode
  | CurrencyTypeNode
  | NullableTypeNode
  | ArrayTypeNode;

/**
 * `sql name(params): ResultRecord { <SQL text> }`
 *
 * The SQL body is captured verbatim. BankLang does not parse SQL: it resolves
 * the `:hostVariable` references, rewrites them to COBOL names, and emits the
 * statement inside `EXEC SQL` / `END-EXEC`.
 */
export interface SqlDeclarationNode extends NodeBase {
  kind: "SqlDeclaration";
  name: string;
  parameters: ParameterNode[];
  resultTypeName: string | null;
  /** Raw SQL text as written. */
  text: string;
  /** `:name` references found in the text, with their positions. */
  hostVariables: { name: string; span: SourceSpan }[];
}

/** `execute selectAccount(args) into row;` */
export interface SqlStatementNode extends NodeBase {
  kind: "SqlStatement";
  name: string;
  args: ExpressionNode[];
  intoRecord: string | null;
}

export interface EnumDeclarationNode extends NodeBase {
  kind: "EnumDeclaration";
  name: string;
  members: string[];
}

export interface TypeAliasDeclarationNode extends NodeBase {
  kind: "TypeAliasDeclaration";
  name: string;
  type: TypeNode;
}

export interface FieldDeclarationNode extends NodeBase {
  kind: "FieldDeclaration";
  name: string;
  type: TypeNode;
}

export interface RecordDeclarationNode extends NodeBase {
  kind: "RecordDeclaration";
  name: string;
  typeParameters: TypeParameterNode[];
  /**
   * `record Savings extends Account` — the base record whose fields are laid
   * out first, so a derived record's leading storage matches the base byte for
   * byte and a copybook cut for the base still reads correctly.
   */
  baseType: TypeReferenceNode | null;
  fields: FieldDeclarationNode[];
}

export interface ParameterNode extends NodeBase {
  kind: "Parameter";
  name: string;
  type: TypeNode;
}

export interface IdentifierNode extends NodeBase {
  kind: "Identifier";
  name: string;
}

export interface DecimalLiteralNode extends NodeBase {
  kind: "DecimalLiteral";
  text: string;
}

export interface BooleanLiteralNode extends NodeBase {
  kind: "BooleanLiteral";
  value: boolean;
}

export interface StringLiteralNode extends NodeBase {
  kind: "StringLiteral";
  value: string;
}

/**
 * Field access on a record-typed identifier, such as `request.amount`.
 * Only single-level access is supported by the current subset.
 */
export interface MemberAccessNode extends NodeBase {
  kind: "MemberAccess";
  /**
   * An index access target supports `statement.lines[i].amount`, which lowers
   * to the COBOL qualified-subscript form `AMOUNT OF STATEMENT (I)`.
   */
  target: IdentifierNode | IndexAccessNode;
  member: string;
}

export type ComparisonOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";
export type ArithmeticOperator = "+" | "-" | "*" | "/";
export type LogicalOperator = "&&" | "||";

export type BinaryOperator =
  ComparisonOperator | ArithmeticOperator | LogicalOperator;

export interface BinaryExpressionNode extends NodeBase {
  kind: "BinaryExpression";
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpressionNode extends NodeBase {
  kind: "UnaryExpression";
  operator: "!";
  operand: ExpressionNode;
}

/** Rounding modes, named after the COBOL `ROUNDED MODE IS` phrases. */
export type RoundingMode =
  "HALF_EVEN" | "HALF_UP" | "HALF_DOWN" | "UP" | "DOWN" | "CEILING" | "FLOOR";

/**
 * `round(expr, "HALF_EVEN")` or `divide(a, b, "HALF_UP")`.
 *
 * Rounding is a distinct node rather than an operator because COBOL attaches
 * `ROUNDED` to the assignment, not to a subexpression. Making it explicit in
 * the source is also the point: an unstated rounding mode is a real defect in
 * financial arithmetic.
 */
export interface RoundedExpressionNode extends NodeBase {
  kind: "RoundedExpression";
  operand: ExpressionNode;
  mode: RoundingMode;
  /** True when written as `divide(a, b, mode)`. */
  isDivision: boolean;
}

/** `Status.ACTIVE` — a member of a declared enum. */
export interface EnumMemberNode extends NodeBase {
  kind: "EnumMember";
  enumName: string;
  member: string;
}

/** `statement.entries[index]` — element access on a bounded array. */
export interface IndexAccessNode extends NodeBase {
  kind: "IndexAccess";
  target: MemberAccessNode | IdentifierNode;
  index: ExpressionNode;
}

/**
 * `isPresent(value)` and `valueOf(value)` for nullable values.
 *
 * `valueOf` is only legal where the compiler can see a preceding `isPresent`
 * check, which is what makes implicit nullable access impossible.
 */
export interface NullableCheckNode extends NodeBase {
  kind: "NullableCheck";
  operation: "isPresent" | "valueOf";
  operand: ExpressionNode;
}

/** A call to a user-declared function. */
export interface CallExpressionNode extends NodeBase {
  kind: "CallExpression";
  callee: string;
  args: ExpressionNode[];
}

export interface LetStatementNode extends NodeBase {
  kind: "LetStatement";
  name: string;
  type: TypeNode;
  expression: ExpressionNode;
}

export type ExpressionNode =
  | IdentifierNode
  | DecimalLiteralNode
  | BooleanLiteralNode
  | StringLiteralNode
  | MemberAccessNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | RoundedExpressionNode
  | CallExpressionNode
  | EnumMemberNode
  | IndexAccessNode
  | NullableCheckNode;

/**
 * A ledger posting operation inside a transaction body.
 * `debit(account, amount)` / `credit(account, amount)`.
 */
export interface LedgerStatementNode extends NodeBase {
  kind: "LedgerStatement";
  operation: "debit" | "credit";
  account: ExpressionNode;
  amount: ExpressionNode;
}

/**
 * An audit event emission inside a transaction body.
 * `audit(eventName, correlationKey)`.
 */
export interface AuditStatementNode extends NodeBase {
  kind: "AuditStatement";
  eventName: ExpressionNode;
  correlation: ExpressionNode;
}

/** `while <condition> { ... }` with a required static bound. */
export interface WhileStatementNode extends NodeBase {
  kind: "WhileStatement";
  condition: ExpressionNode;
  /**
   * Maximum iterations, from the required `limit <n>` clause. Unbounded loops
   * in a transaction are rejected as BANK-TXN-004.
   */
  limit: number;
  body: BlockNode;
}

/**
 * `for each <name> in <arrayExpression> { ... }`
 *
 * The bound comes from the array's declared length, so unlike `while` this
 * needs no explicit limit clause.
 */
export interface ForEachStatementNode extends NodeBase {
  kind: "ForEachStatement";
  /** Loop index variable, readable inside the body. */
  indexName: string;
  /** The array being iterated. */
  array: MemberAccessNode | IdentifierNode;
  body: BlockNode;
}

/** Assignment to an existing local or record field. */
export interface AssignStatementNode extends NodeBase {
  kind: "AssignStatement";
  target: IdentifierNode | MemberAccessNode;
  expression: ExpressionNode;
}

/** `call someFunction(args);` used as a statement for its effect. */
export interface ExpressionStatementNode extends NodeBase {
  kind: "ExpressionStatement";
  expression: ExpressionNode;
}

/** `switch value { case MEMBER { ... } else { ... } }` over an enum. */
export interface SwitchCaseNode extends NodeBase {
  kind: "SwitchCase";
  member: string;
  body: BlockNode;
}

export interface SwitchStatementNode extends NodeBase {
  kind: "SwitchStatement";
  subject: ExpressionNode;
  cases: SwitchCaseNode[];
  otherwise: BlockNode | null;
}

export type FileOperation = "open" | "read" | "write" | "close";

export type FileOrganization = "sequential" | "indexed" | "relative";

/**
 * `read accountInput into record;` and friends.
 *
 * The file name is resolved against declared files, so an operation on an
 * undeclared file is a type error rather than a runtime surprise.
 */
export interface FileStatementNode extends NodeBase {
  kind: "FileStatement";
  operation: FileOperation;
  fileName: string;
  /** Record variable for `read into` / `write from`. */
  recordName: string | null;
  /** Key expression for a keyed read on an indexed file. */
  key: ExpressionNode | null;
}

export type StatementNode =
  | LetStatementNode
  | ReturnStatementNode
  | IfStatementNode
  | LedgerStatementNode
  | AuditStatementNode
  | WhileStatementNode
  | AssignStatementNode
  | ExpressionStatementNode
  | FileStatementNode
  | SwitchStatementNode
  | SqlStatementNode
  | CicsStatementNode
  | ForEachStatementNode
  | RaiseStatementNode;

export interface ReturnStatementNode extends NodeBase {
  kind: "ReturnStatement";
  expression: ExpressionNode;
}

/**
 * `raise "INSUFFICIENT_FUNDS";` — abandons the rest of the body and runs the
 * enclosing `on failure` handler.
 *
 * The code is a literal rather than an expression so that every failure a
 * program can signal is visible in the source, and in the audit report, without
 * running it.
 */
export interface RaiseStatementNode extends NodeBase {
  kind: "RaiseStatement";
  code: string;
  codeSpan: SourceSpan;
}

/**
 * `on failure { ... }` — the handler that runs when the body raises.
 *
 * A handler is declared once, before the statements it covers, so the recovery
 * path is impossible to miss when reading the transaction top to bottom.
 */
export interface FailureHandlerNode extends NodeBase {
  kind: "FailureHandler";
  body: BlockNode;
}

export interface IfStatementNode extends NodeBase {
  kind: "IfStatement";
  condition: ExpressionNode;
  thenBranch: BlockNode;
  elseBranch: BlockNode | null;
}

export interface BlockNode extends NodeBase {
  kind: "Block";
  statements: StatementNode[];
}

export interface FunctionDeclarationNode extends NodeBase {
  kind: "FunctionDeclaration";
  name: string;
  typeParameters: TypeParameterNode[];
  parameters: ParameterNode[];
  returnType: TypeNode;
  body: BlockNode;
}

/**
 * `file Name sequential input record RecordType status statusField;`
 *
 * The `status` clause is optional at parse time so the analyzer can report a
 * missing file status as BANK-FILE-001 rather than a syntax error.
 */
export interface FileDeclarationNode extends NodeBase {
  kind: "FileDeclaration";
  name: string;
  organization: FileOrganization;
  mode: "input" | "output";
  recordTypeName: string;
  statusName: string | null;
  /** Record key field, required for an indexed file. */
  keyField: string | null;
}

export interface TransactionDeclarationNode extends NodeBase {
  kind: "TransactionDeclaration";
  name: string;
  parameters: ParameterNode[];
  body: BlockNode;
  /**
   * Recovery path for a raise anywhere in the body, including inside a function
   * the body calls. A transaction is the unit of work, so it is the only place
   * a handler can sit.
   */
  failureHandler: FailureHandlerNode | null;
  /**
   * True for `entry transaction`, the transaction the program starts at.
   *
   * COBOL enters a program at the first statement of the PROCEDURE DIVISION, so
   * without a designated entry the starting paragraph is whichever declaration
   * happened to be emitted first.
   */
  isEntry: boolean;
  /**
   * A CICS transaction receives its input through DFHCOMMAREA and ends with
   * `EXEC CICS RETURN` instead of `GOBACK`.
   */
  isCics: boolean;
}

/** `link "PROGRAM" commarea record resp status;` and syncpoint operations. */
export type CicsOperation = "link" | "syncpoint" | "rollback";

export interface CicsStatementNode extends NodeBase {
  kind: "CicsStatement";
  operation: CicsOperation;
  /** Target program name for `link`. */
  program: string | null;
  /** COMMAREA record for `link`. */
  commarea: string | null;
  /** Response-code variable, required for `link`. */
  respName: string | null;
}

export type DeclarationNode =
  | TypeAliasDeclarationNode
  | RecordDeclarationNode
  | FunctionDeclarationNode
  | TransactionDeclarationNode
  | FileDeclarationNode
  | EnumDeclarationNode
  | SqlDeclarationNode;

export interface ProgramNode extends NodeBase {
  kind: "Program";
  module: ModuleDeclarationNode;
  declarations: DeclarationNode[];
}

/**
 * A source comment, captured as trivia rather than as an AST node.
 *
 * Comments do not affect compilation, but the formatter must be able to put
 * them back, so the lexer records them instead of discarding them.
 */
export interface CommentTrivia {
  /** Comment text without the leading `//`, trailing whitespace trimmed. */
  text: string;
  span: SourceSpan;
  /**
   * True when the comment is the first thing on its line. A trailing comment
   * stays on the line it annotates; a leading comment gets its own line.
   */
  ownLine: boolean;
}

export interface ParsedProgram {
  program: ProgramNode | null;
  diagnostics: Diagnostic[];
  comments: CommentTrivia[];
}
