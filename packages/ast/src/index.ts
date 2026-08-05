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
  /**
   * How the value is held: packed decimal by default, `binary` for a counter or
   * subscript, `display` for the zoned decimal much legacy input arrives as.
   *
   * Written as `binary<9>` or `zoned<7, 2>` rather than as an option on
   * `decimal`, because the choice is about the bytes and belongs next to the
   * digit count that decides how many of them there are.
   */
  usage?: "packed" | "binary" | "display" | "native";
}

export interface StringTypeNode extends NodeBase {
  kind: "StringType";
  length: number;
  /**
   * `national<n>` — `PIC N(n) USAGE NATIONAL`, two bytes per character.
   *
   * A field kept in UTF-16 rather than the code page. It is a flag on the
   * string type rather than a type of its own because everything else about it
   * is the same: a fixed run of characters, moved as a whole. What differs is
   * the byte count, and getting that wrong misplaces every field after it.
   */
  national?: boolean;
}

export interface BoolTypeNode extends NodeBase {
  kind: "BoolType";
}

/**
 * `date`, `time`, and `timestamp`.
 *
 * Banking is dates: a value date is not a posting date, an accrual runs between
 * two of them, and a maturity is compared against today. They are separate
 * types rather than aliases for a number so that a date cannot be compared with
 * an amount, or with a plain integer that happens to have eight digits.
 */
export interface TemporalTypeNode extends NodeBase {
  kind: "TemporalType";
  unit: "date" | "time" | "timestamp";
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

/**
 * `edited<T, "style">` — a field formatted for a human to read.
 *
 * COBOL calls these numeric-edited items, and a `MOVE` into one performs the
 * editing: zero suppression, thousands separators, and the sign convention the
 * style names. The picture is generated from the source type's precision and
 * scale rather than written out, so an 18,2 amount gets the right number of
 * positions without anyone counting them.
 *
 * An edited field is a rendering, not a number. It can be assigned from a value
 * of its inner type and written to a file or a report line; it cannot be
 * compared or computed with, which is also exactly what COBOL allows.
 */
export interface EditedTypeNode extends NodeBase {
  kind: "EditedType";
  inner: TypeNode;
  style: string;
  styleSpan: SourceSpan;
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
  | TemporalTypeNode
  | EditedTypeNode
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
  /**
   * `sql` returns at most one row and is run with `execute`. `cursor` returns a
   * stream and is read with a bounded loop, which lowers to a different set of
   * Db2 statements: `DECLARE`, `OPEN`, `FETCH`, `CLOSE`.
   */
  form: "statement" | "cursor";
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

/**
 * `for each row in accountsByBranch(branchId) limit 1000 { ... }`
 *
 * Reading a cursor is a loop over rows the database supplies, so the language
 * gives it the same shape as any other loop and the same mandatory bound. The
 * `OPEN` and the `CLOSE` are generated around the body rather than written, so
 * a cursor cannot be left open — the defect that holds Db2 locks for the rest of
 * a batch window.
 */
export interface CursorLoopStatementNode extends NodeBase {
  kind: "CursorLoopStatement";
  cursorName: string;
  cursorSpan: SourceSpan;
  args: ExpressionNode[];
  /** Record each fetched row lands in. Must match the cursor's result type. */
  rowName: string;
  rowSpan: SourceSpan;
  /** The most rows the loop may process. Mandatory, as for `while`. */
  limit: number;
  limitSpan: SourceSpan;
  body: BlockNode;
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
  /**
   * `processed: binary<9> = 0;` — a COBOL `VALUE` clause.
   *
   * Working storage starts as whatever the region left there unless a field
   * says otherwise, so a counter with no initial value is a counter that starts
   * at an unpredictable number. Writing it in the record rather than in an
   * opening paragraph keeps the fact next to the field, where it cannot drift
   * out of step when the record gains one.
   *
   * A literal only. COBOL evaluates `VALUE` at compile time, so anything that
   * needs computing belongs in the program.
   */
  initialValue: ExpressionNode | null;
  /**
   * `sensitive nationalId: string<20>` — restricted data that must not reach a
   * log.
   *
   * Marked on the field rather than inferred from its name, because whether a
   * value is restricted is a decision about the data, not a guess from spelling.
   * A field marked here cannot reach an audit event or a ledger account
   * identifier (`BANK-AUD-002`); it can still be read, computed with, and
   * written to a file, which is where such data legitimately lives.
   */
  sensitive: boolean;
  /**
   * `redefines otherField` — a second reading of storage another field already
   * occupies.
   *
   * The variant record is how a legacy copybook says "this area means different
   * things depending on the record type", and it is everywhere in a real estate.
   * The redefining field must be no longer than what it redefines, because
   * COBOL gives it no storage of its own.
   */
  redefines: string | null;
  /**
   * `occurs depending on countField` — a table whose used length is a field.
   *
   * A fixed `OCCURS` reserves the maximum every time. `OCCURS ... DEPENDING ON`
   * says how much of it this record actually uses, which is what makes a
   * variable-length record variable.
   */
  dependingOn: string | null;
  /**
   * `sync` — align the field on its natural boundary.
   *
   * A `SYNCHRONIZED` binary field starts on a halfword, fullword, or doubleword
   * boundary, and the compiler inserts slack bytes before it to get there. That
   * makes it the one layout clause that changes offsets without appearing in
   * any field's own length, which is why a copybook using it and a compiler
   * ignoring it disagree silently.
   */
  synchronized: boolean;
  /**
   * `justified` — right-align the value in the field.
   *
   * COBOL moves an alphanumeric value left-aligned and pads on the right.
   * `JUSTIFIED RIGHT` reverses that, which is how a code or a reference is put
   * into a fixed column without the program counting spaces itself. It is
   * alphanumeric only: a number's alignment is decided by its picture.
   */
  justified: boolean;
  /**
   * `blankWhenZero` — print spaces rather than zeros for a zero value.
   *
   * A statement line with no movement should be blank, not `0.00`, and this is
   * how a report says so without a conditional. Numeric and numeric-edited
   * items only.
   */
  blankWhenZero: boolean;
}

/**
 * `page 60 footing 55 top 3 bottom 3` — the `LINAGE` clause of a print file.
 *
 * It is what makes a report paginate: COBOL counts the lines written and
 * signals `AT END-OF-PAGE` when the footing line is reached, which is where a
 * program writes its totals and its next heading. Without it a report is one
 * unbroken column of text.
 */
export interface FileLinageNode {
  /** Lines in the page body. */
  lines: number;
  /** Line at which END-OF-PAGE is signalled. Defaults to the page depth. */
  footingAt: number | null;
  linesAtTop: number | null;
  linesAtBottom: number | null;
  span: SourceSpan;
}

/**
 * `wholeDate renames yearPart through dayPart;` — a level-66 regrouping.
 *
 * A legacy copybook splits a date into year, month, and day and then wants to
 * move all three at once. `RENAMES` gives that run of fields a second name
 * without a second copy of the storage, which is what distinguishes it from
 * `redefines`: it names a span that is already there rather than a new reading
 * of it.
 */
export interface RenamesDeclarationNode extends NodeBase {
  kind: "RenamesDeclaration";
  name: string;
  from: string;
  to: string;
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
  /** Level-66 regroupings, emitted after the record's own fields. */
  renames: RenamesDeclarationNode[];
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

/**
 * `today()`, `addDays(when, n)`, and `daysBetween(from, to)`.
 *
 * Date arithmetic is not ordinary arithmetic: adding one to 20260131 does not
 * give the first of February. These lower to the COBOL intrinsic functions that
 * know the calendar — `INTEGER-OF-DATE`, `DATE-OF-INTEGER`, `CURRENT-DATE` —
 * rather than to `+` on the stored digits, which is why the language offers
 * them instead of letting a date be added to.
 */
export interface TemporalCallNode extends NodeBase {
  kind: "TemporalCall";
  operation: "today" | "addDays" | "daysBetween";
  args: ExpressionNode[];
}

/**
 * The arithmetic COBOL already knows how to do, including the two it knows
 * because it was written for this industry.
 *
 * `annuity` is the repayment factor of a loan and `presentValue` discounts a
 * series of cash flows: they are COBOL intrinsics, not something this compiler
 * computes, and a bank that reimplements either in a loop gets the rounding
 * wrong. `mod` is what a check digit is. `isNumeric` is how a batch decides
 * whether a field from a flat file can be converted at all, before it tries —
 * which is the difference between rejecting a record and abending on it.
 */
export interface NumericCallNode extends NodeBase {
  kind: "NumericCall";
  operation:
    | "abs"
    | "mod"
    | "rem"
    | "min"
    | "max"
    | "annuity"
    | "presentValue"
    | "isNumeric"
    | "toNumber";
  args: ExpressionNode[];
}

/**
 * `trim`, `upper`, `lower`, `substring`, `concat`, and `now`.
 *
 * COBOL builds strings with `STRING`, takes them apart with reference
 * modification, and folds case with intrinsic functions. Without these a
 * program cannot assemble a narrative, parse a composite key, or mask a card
 * number — and masking is what the `sensitive` declassification rule rests on.
 */
export interface StringCallNode extends NodeBase {
  kind: "StringCall";
  operation:
    | "trim"
    | "upper"
    | "lower"
    | "substring"
    | "concat"
    | "now"
    | "countOf"
    | "replaceChars";
  args: ExpressionNode[];
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
  | NullableCheckNode
  | TemporalCallNode
  | NumericCallNode
  | StringCallNode;

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

/**
 * What a program does to a file.
 *
 * `rewrite` and `delete` update a record in place, which needs the file open
 * for both reading and writing. `start` positions a browse and `readNext` walks
 * it — together the most common VSAM pattern there is, and the reason a master
 * file update was unwritable without them.
 */
export type FileOperation =
  | "open"
  | "read"
  | "readNext"
  | "write"
  | "rewrite"
  | "delete"
  | "start"
  | "close";

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
  /**
   * `advancing <n>` or `advancing page` — `WRITE ... AFTER ADVANCING`.
   *
   * A report line is written after spacing rather than on top of the last one,
   * and a new page is how a heading starts one.
   */
  advancing: number | "page" | null;
  /**
   * `on page { ... }` — `AT END-OF-PAGE`.
   *
   * COBOL signals it when the write reaches the file's footing line, which is
   * where a report writes its totals and the next page's heading. It needs the
   * file to declare a page depth, since otherwise there is no page to end.
   */
  atEndOfPage: BlockNode | null;
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
  | CursorLoopStatementNode
  | UnitOfWorkStatementNode
  | ReturnCodeStatementNode
  | ConsoleStatementNode
  | ResetStatementNode
  | SplitStatementNode
  | SerializeStatementNode
  | XmlParseStatementNode
  | ReportStatementNode
  | SortStatementNode
  | ReleaseStatementNode
  | CheckpointStatementNode
  | SearchStatementNode
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
  /**
   * `nested function` — a COBOL contained program rather than a paragraph.
   *
   * An ordinary function is a paragraph the program `PERFORM`s, sharing all its
   * storage. A nested one is a program inside the program: it has its own
   * storage and a real `CALL` boundary, and it reads the module's records
   * directly because they are emitted `GLOBAL` in the container. That is what
   * it buys — a unit with its own working storage that still sees the shared
   * record, without the parameter plumbing a separate module would need.
   *
   * It cannot recurse. COBOL forbids `LOCAL-STORAGE` in a contained program,
   * and per-invocation locals are what make recursion safe, so a recursive
   * function stays a sibling program instead.
   */
  isNested: boolean;
}

/**
 * `file Name sequential input record RecordType status statusField;`
 *
 * The `status` clause is optional at parse time so the analyzer can report a
 * missing file status as BANK-FILE-001 rather than a syntax error.
 */
/**
 * `on error <file> { ... }` — a DECLARATIVES handler for a file.
 *
 * COBOL runs a `USE AFTER ERROR` procedure when an I/O operation on the file
 * fails, whatever the operation and wherever it was written. A file status
 * check covers the statement that thought to look; this covers the ones that
 * did not, which is what makes it the standard error path rather than a
 * convenience.
 */
export interface FileErrorHandlerNode extends NodeBase {
  kind: "FileErrorHandler";
  fileName: string;
  body: BlockNode;
}

export interface FileDeclarationNode extends NodeBase {
  kind: "FileDeclaration";
  name: string;
  organization: FileOrganization;
  mode: "input" | "output" | "update";
  recordTypeName: string;
  statusName: string | null;
  /** Record key field, required for an indexed file. */
  keyField: string | null;
  /**
   * `alternate <field>, <field>` — alternate record keys.
   *
   * A KSDS is read by its primary key and browsed by any of its alternates. A
   * program that can only name the primary cannot open a file whose alternate
   * index is the whole reason it exists — an account file read by customer, say.
   * Alternates allow duplicates; the primary does not.
   */
  alternateKeys: string[];
  /** `page ...` — page depth, for a print file that paginates. */
  linage: FileLinageNode | null;
}

/**
 * `report <name> on <file> ...` — a COBOL `RD` in the REPORT SECTION.
 *
 * `page ... footing ...` on a file paginates: the program still writes every
 * line itself and counts nothing. A report declares the *shape* and lets the
 * compiler run it — headings repeated on each page, a footing at each change of
 * a control field, and totals that accumulate without a variable to forget to
 * clear. That last part is the reason to have it: a hand-written subtotal that
 * is reset in the wrong place is a report that is wrong and still balances.
 */
export interface ReportDeclarationNode extends NodeBase {
  kind: "ReportDeclaration";
  name: string;
  fileName: string;
  fileSpan: SourceSpan;
  /**
   * Control fields, outermost first. `FINAL` is always the outermost and is
   * implied, so this holds only the named ones.
   */
  controls: { name: string; span: SourceSpan }[];
  page: ReportPageNode | null;
  groups: ReportGroupNode[];
}

/** `page 60 heading 1 firstDetail 4 lastDetail 55` on a report. */
export interface ReportPageNode extends NodeBase {
  kind: "ReportPage";
  limit: number;
  heading: number | null;
  firstDetail: number | null;
  lastDetail: number | null;
  footing: number | null;
}

export type ReportGroupType =
  | "pageHeading"
  | "pageFooting"
  | "detail"
  | "controlHeading"
  | "controlFooting";

/**
 * One report group: what COBOL prints, and when.
 *
 * A `detail` is printed by `generate`. Everything else the compiler prints on
 * its own — a page heading when the page turns, a control footing when the
 * named field changes — which is exactly the bookkeeping a hand-written report
 * gets wrong.
 */
export interface ReportGroupNode extends NodeBase {
  kind: "ReportGroup";
  type: ReportGroupType;
  name: string | null;
  /** The control field a heading or footing belongs to; `null` means FINAL. */
  control: string | null;
  lines: ReportLineNode[];
}

/** `line 1 { ... }` or `line next { ... }` or `line plus 2 { ... }`. */
export interface ReportLineNode extends NodeBase {
  kind: "ReportLine";
  position: { kind: "absolute" | "relative"; value: number };
  columns: ReportColumnNode[];
}

/**
 * `column <n> <source>` — one field of a printed line.
 *
 * The source is a literal, a field the report reads when it prints, `sum` of a
 * field, or the page number. `SUM` is the one that carries its weight: COBOL
 * accumulates it and clears it at the control break, so there is no counter to
 * reset in the wrong place.
 */
export interface ReportColumnNode extends NodeBase {
  kind: "ReportColumn";
  column: number;
  source: ReportSourceNode;
}

/**
 * What one column prints.
 *
 * A field is named bare — `column 1 branch;` — and resolved against the record
 * the report's file holds. Nothing else would mean anything: a report is
 * declared at the top level, where no transaction's variables are in scope, and
 * the record is the only thing it reads.
 */
export type ReportSourceNode =
  | { kind: "ReportLiteral"; value: string; span: SourceSpan }
  | { kind: "ReportField"; field: string; span: SourceSpan }
  | { kind: "ReportSum"; field: string; span: SourceSpan }
  | { kind: "ReportPageNumber"; span: SourceSpan };

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
/**
 * The CICS commands the subset covers.
 *
 * `link` calls another program, `syncpoint` and `rollback` end the unit of
 * work, `readFile` / `writeFile` / `rewriteFile` reach a VSAM dataset through
 * CICS rather than through COBOL file control, `writeQueue` / `readQueue` use
 * temporary storage — the scratchpad an online transaction passes state through
 * — and `returnTransid` hands control back to CICS naming what runs next, which
 * is how a pseudo-conversation continues.
 */
export type CicsOperation =
  | "link"
  | "syncpoint"
  | "rollback"
  | "readFile"
  | "writeFile"
  | "rewriteFile"
  | "writeQueue"
  | "readQueue"
  | "returnTransid";

/**
 * `returnCode = 4;` — the step's condition code.
 *
 * How a batch job tells the next step's `COND=` what happened: 0 ran clean, 4
 * found nothing or warned, 8 failed. Without it every step reports success and
 * a job that found no records looks exactly like one that processed a million.
 */
/**
 * `split source by "," into first, second, third;`
 *
 * COBOL takes a field apart with `UNSTRING`, which is a statement because it
 * writes several receivers at once. Parsing a composite key — a branch, an
 * account, and a suffix in one field — is what legacy input constantly asks for.
 */
/**
 * `sort accountInput into sortedAccounts on accountId, branchId;`
 *
 * A batch that needs its input ordered has three options: a SORT step in the
 * JCL, an internal `SORT`, or reading the file in whatever order it arrives and
 * hoping. This is the second, which is what a program does when the ordering is
 * its own business rather than the job's.
 *
 * `merge` is the same shape over several already-sorted inputs.
 */
/**
 * `checkpoint restartFile from restartRecord every 1000;`
 *
 * A batch that posts money and dies halfway is rerun. Without a record of where
 * it got to, the rerun starts at the beginning and posts everything twice. A
 * checkpoint writes that position and commits the work up to it, so a restart
 * resumes rather than repeats.
 */
export interface CheckpointStatementNode extends NodeBase {
  kind: "CheckpointStatement";
  fileName: string;
  recordName: string;
  /** Records between checkpoints. Too small costs throughput, too large costs rework. */
  every: number;
  everySpan: SourceSpan;
}

/**
 * The body of an `INPUT PROCEDURE` or `OUTPUT PROCEDURE`, run once per record.
 *
 * `recordName` is an existing record variable the record passes through, the
 * same way `read <file> into <record>` uses one. The loop around the body is
 * generated, because hand-writing the end-of-data test is where this shape is
 * usually got wrong.
 */
export interface SortProcedureNode {
  recordName: string;
  recordSpan: SourceSpan;
  body: BlockNode;
  span: SourceSpan;
}

export interface SortStatementNode extends NodeBase {
  kind: "SortStatement";
  operation: "sort" | "merge";
  /** Inputs, in order. A sort takes one; a merge takes two or more. */
  inputs: string[];
  output: string;
  /** Fields to order by, outermost first. */
  keys: { name: string; descending: boolean }[];
  /** Present when the records need work on the way in, replacing `USING`. */
  inputProcedure: SortProcedureNode | null;
  /** Present when they need work on the way out, replacing `GIVING`. */
  outputProcedure: SortProcedureNode | null;
}

/**
 * `release <record>;` — hands a record to the sort from an input procedure.
 *
 * It is the statement an input procedure exists for: the records it does not
 * release are the ones it filters out.
 */
export interface ReleaseStatementNode extends NodeBase {
  kind: "ReleaseStatement";
  recordName: string;
}

export interface SplitStatementNode extends NodeBase {
  kind: "SplitStatement";
  source: ExpressionNode;
  delimiter: ExpressionNode;
  targets: (MemberAccessNode | IdentifierNode)[];
}

/**
 * `xml <text> processing { element "ID" into account.id; } on error { ... };`
 *
 * `XML PARSE` is event-driven: COBOL calls a procedure once per token of the
 * document — a start tag, its content, an end tag — and the procedure decides
 * what to keep by reading the `XML-EVENT` and `XML-TEXT` special registers.
 *
 * Writing that state machine by hand is where an XML reader goes wrong, so the
 * bindings are declared and the compiler generates it: it tracks the element it
 * is inside and moves the content of the ones that were named. What a program
 * actually wants from a document is which elements go in which fields, and that
 * is exactly what this says.
 */
export interface XmlParseStatementNode extends NodeBase {
  kind: "XmlParseStatement";
  source: MemberAccessNode | IdentifierNode;
  bindings: XmlBindingNode[];
  onError: BlockNode | null;
}

/** `element "BALANCE" into account.balance;` — one element, one field. */
export interface XmlBindingNode extends NodeBase {
  kind: "XmlBinding";
  element: string;
  elementSpan: SourceSpan;
  target: MemberAccessNode | IdentifierNode;
}

/**
 * `initiate <report>;`, `generate <group>;`, `terminate <report>;`
 *
 * `initiate` and `terminate` name the report; `generate` names a detail group,
 * because that is the thing being printed. Everything between the two is the
 * compiler's: it turns the page, repeats the heading, and breaks the totals.
 */
export interface ReportStatementNode extends NodeBase {
  kind: "ReportStatement";
  operation: "initiate" | "generate" | "terminate";
  target: string;
  targetSpan: SourceSpan;
}

/**
 * `json <target> from <record> count <length> on error { ... };`
 *
 * `JSON GENERATE` and `XML GENERATE`. A mainframe batch that has to hand a
 * record to something outside the estate — a queue, an API gateway, a file a
 * distributed system reads — otherwise builds the text by hand with `STRING`,
 * which is where the quoting and the escaping go wrong.
 *
 * `count` is the length actually generated: the target is a fixed COBOL field,
 * so without it the caller cannot tell the text from the padding.
 */
export interface SerializeStatementNode extends NodeBase {
  kind: "SerializeStatement";
  format: "json" | "xml";
  /**
   * `generate` writes the document, `parse` reads it back.
   *
   * The two are the same statement with the direction reversed, which is why
   * they share a node: `from` names the record the text comes out of, `into`
   * names the record the text goes into.
   */
  direction: "generate" | "parse";
  target: MemberAccessNode | IdentifierNode;
  source: MemberAccessNode | IdentifierNode;
  count: MemberAccessNode | IdentifierNode | null;
  onError: BlockNode | null;
}

/**
 * `search row in statement.lines where <condition> { ... } else { ... }`
 *
 * A linear scan with `for each` finds a row too, but it runs the whole table
 * every time and says nothing about what it was looking for. `SEARCH` stops at
 * the first match and has an `AT END` for the case where there is none, which
 * is the half a hand-written scan usually forgets.
 */
export interface SearchStatementNode extends NodeBase {
  kind: "SearchStatement";
  /** Name bound to the matching element inside the condition and the body. */
  elementName: string;
  array: MemberAccessNode | IdentifierNode;
  condition: ExpressionNode;
  body: BlockNode;
  /** Runs when no element matched. Required: a search that can fail must say so. */
  notFound: BlockNode;
}

/**
 * `log "MESSAGE", value;` and `accept parameter into field;`
 *
 * `DISPLAY` is how a batch program talks to the job log — the operator's only
 * view of what happened between the return code and the abend. `ACCEPT` reads
 * what the job passed it: a run date, a cycle number, a mode.
 */
export interface ConsoleStatementNode extends NodeBase {
  kind: "ConsoleStatement";
  operation: "log" | "accept";
  /** Values to write, for `log`. */
  values: ExpressionNode[];
  /** Where to read into, and what source, for `accept`. */
  target: MemberAccessNode | IdentifierNode | null;
  source: "parameter" | "date" | "time" | null;
}

/**
 * `reset record;` — set every field to its type's empty value.
 *
 * `INITIALIZE` clears a group in one statement: alphanumerics to spaces,
 * numerics to zero. Doing it field by field is the same thing written out, and
 * drifts the moment the record gains a field.
 */
export interface ResetStatementNode extends NodeBase {
  kind: "ResetStatement";
  recordName: string;
}

export interface ReturnCodeStatementNode extends NodeBase {
  kind: "ReturnCodeStatement";
  value: ExpressionNode;
}

/**
 * `commit;` and `rollback;` — the unit of work, in a batch Db2 program.
 *
 * Deliberately not available inside a `cics transaction`: there, CICS owns the
 * syncpoint and commits Db2's work along with everything else, so an
 * `EXEC SQL COMMIT` is both wrong and rejected by Db2 at run time. Writing one
 * is `BANK-SQL-004`, and the fix is the `syncpoint` statement.
 */
export interface UnitOfWorkStatementNode extends NodeBase {
  kind: "UnitOfWorkStatement";
  operation: "commit" | "rollback";
}

export interface CicsStatementNode extends NodeBase {
  kind: "CicsStatement";
  operation: CicsOperation;
  /**
   * The named resource: a program for `link`, a dataset for a file command, a
   * queue for a queue command, a transaction identifier for `returnTransid`.
   */
  program: string | null;
  /** The record a command reads into or writes from, and the COMMAREA. */
  commarea: string | null;
  /** Response-code variable. Required for every command but `returnTransid`. */
  respName: string | null;
  /** Record key for a file command, which reaches a KSDS by key. */
  key: ExpressionNode | null;
}

export type DeclarationNode =
  | TypeAliasDeclarationNode
  | RecordDeclarationNode
  | FunctionDeclarationNode
  | TransactionDeclarationNode
  | FileDeclarationNode
  | ReportDeclarationNode
  | EnumDeclarationNode
  | FileErrorHandlerNode
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
