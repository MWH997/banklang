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
}

export type TypeNode =
  DecimalTypeNode | StringTypeNode | BoolTypeNode | TypeReferenceNode;

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
  target: IdentifierNode;
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
  | CallExpressionNode;

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

export type FileOperation = "open" | "read" | "write" | "close";

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
  | FileStatementNode;

export interface ReturnStatementNode extends NodeBase {
  kind: "ReturnStatement";
  expression: ExpressionNode;
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
  organization: "sequential";
  mode: "input" | "output";
  recordTypeName: string;
  statusName: string | null;
}

export interface TransactionDeclarationNode extends NodeBase {
  kind: "TransactionDeclaration";
  name: string;
  parameters: ParameterNode[];
  body: BlockNode;
}

export type DeclarationNode =
  | TypeAliasDeclarationNode
  | RecordDeclarationNode
  | FunctionDeclarationNode
  | TransactionDeclarationNode
  | FileDeclarationNode;

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
