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

export interface BinaryExpressionNode extends NodeBase {
  kind: "BinaryExpression";
  operator: ">" | "+" | "-";
  left: ExpressionNode;
  right: ExpressionNode;
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
  | BinaryExpressionNode;

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

export type StatementNode =
  | LetStatementNode
  | ReturnStatementNode
  | IfStatementNode
  | LedgerStatementNode
  | AuditStatementNode;

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
