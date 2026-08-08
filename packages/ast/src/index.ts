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
  usage?: "packed" | "binary" | "display" | "unsigned" | "native";
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
  /**
   * `WITH HOLD` — a cursor that survives a commit.
   *
   * Db2's Application Programming Guide: "A held cursor does not close after a
   * commit operation. A cursor that is not held closes after a commit
   * operation." A batch that commits inside its own cursor loop — which is what
   * a long run has to do, to stop the log filling and the locks accumulating —
   * loses its position without this, and the next `FETCH` answers -501.
   *
   * Db2 does not close a held cursor on its own and a thread holding an open
   * cursor cannot be reused, so the `CLOSE` matters more here rather than less.
   * The compiler emits it either way.
   */
  hold: boolean;
  /**
   * `rowset <n>` — `WITH ROWSET POSITIONING`, and a `FETCH ... FOR n ROWS`.
   *
   * One `FETCH` per row is one call into Db2 per row. A rowset fetch takes n at
   * a time into host-variable arrays, which for a million-row batch is the
   * difference between a million crossings and fifty thousand.
   *
   * Null for an ordinary cursor. The dimension is an integer constant in 1 to
   * 32767, which is what the Application Programming and SQL Guide allows a
   * host-variable array's `OCCURS` to be.
   */
  rowset: number | null;
  /**
   * `scroll` — `INSENSITIVE SCROLL CURSOR`, which can be read from any row.
   *
   * An ordinary cursor goes forward, once. A scrollable one can start at a
   * given row and can go backward, which is what paging is: a statement screen
   * showing rows 41 to 60, and the same program showing 21 to 40 when the user
   * presses PF7.
   *
   * **`INSENSITIVE` is not a default this leaves to Db2.** Without a
   * sensitivity keyword Db2 chooses `ASENSITIVE`, which resolves to insensitive
   * or to *sensitive dynamic* depending on the statement — and a sensitive
   * cursor sees rows committed by other units of work after it opened. Paging
   * over a result set that is changing underneath is how a reader sees the same
   * transaction on two pages, or never sees it at all, and neither is
   * detectable from inside the program. `INSENSITIVE` fixes the result table at
   * `OPEN`; the pages then agree with each other, which is the property a
   * statement screen is claiming to have.
   *
   * The cost is that Db2 materialises the result table into a declared
   * temporary table, so this is asked for rather than assumed.
   */
  scroll: boolean;
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
  /**
   * `from <expression>` — the row the loop starts at, counting from 1.
   *
   * Null for an ordinary loop, which starts at the first row. Requires the
   * cursor to be declared `scroll`, because a forward-only cursor has no way to
   * begin anywhere but the beginning.
   *
   * Db2 counts a negative position from the end, so `from -20` is "twenty rows
   * from the last", which is the other thing a statement screen wants.
   */
  start: ExpressionNode | null;
  startSpan: SourceSpan | null;
  /**
   * `backward` — read towards the first row rather than away from it.
   *
   * With no `from`, the loop starts at the last row. Requires `scroll` for the
   * same reason.
   */
  backward: boolean;
  backwardSpan: SourceSpan | null;
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
   * `reserved <n>;` — bytes the record has and nothing names, emitted as
   * `FILLER PIC X(n)`.
   *
   * Every copybook on an estate has them, so a record language without one
   * cannot describe the records it has to interoperate with: the importer
   * refused such a copybook rather than laying it out short, which is the right
   * answer and a useless one. A reserved slot is deliberately unreachable —
   * nothing can read it, assign to it, or move a record through it — because
   * COBOL's `FILLER` is not a name, and a program able to write to one would be
   * writing into space the layout says belongs to nobody.
   */
  reserved: boolean;
  /**
   * `redefines otherField` — a second reading of storage another field already
   * occupies.
   *
   * The variant record is how a legacy copybook says "this area means different
   * things depending on the record type", and it is everywhere in a real estate.
   * It must name the field immediately before it, or a redefinition of that
   * same area; it may be longer than what it redefines, which extends the
   * storage area rather than overrunning it.
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
   * `ascending <field>` — the key a table is ordered by, for a binary search.
   *
   * COBOL will bisect a table only if the declaration says it is ordered, which
   * is a promise the program has to keep: `SEARCH ALL` on a table that is not
   * actually sorted does not scan it anyway, it returns the wrong row or none.
   */
  ascendingKey: string | null;
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
  /**
   * Another index access for a table of tables: `rates[i][j]`. COBOL puts every
   * subscript on the innermost data name, so the chain collapses into one
   * reference when it is written out.
   */
  target: MemberAccessNode | IdentifierNode | IndexAccessNode;
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
    | "toNumber"
    | "integerPart"
    | "fractionPart"
    | "sign"
    | "reverse"
    | "textLength";
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
  /**
   * A name, a field, or an element of a table.
   *
   * An element has to be assignable or a table cannot be filled, which is not a
   * table worth having: a rate matrix loaded from a file is written a cell at a
   * time.
   */
  target: IdentifierNode | MemberAccessNode | IndexAccessNode;
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

/**
 * How a file's records are found.
 *
 * `lineSequential` is a text file: records are delimited by a newline rather
 * than laid out at a fixed width, which is what a payment feed, a
 * reconciliation extract or an import from anything that is not a mainframe
 * actually looks like. Enterprise COBOL 6.4 has it as `ORGANIZATION IS LINE
 * SEQUENTIAL` (Language Reference, format 4) for files in the z/OS UNIX file
 * system, and it carries restrictions the other three do not — see
 * `docs/language/files.md` and the checks in the typechecker.
 */
export type FileOrganization =
  "sequential" | "lineSequential" | "indexed" | "relative";

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
  | ProgramCallStatementNode
  | DliStatementNode
  | QueueStatementNode
  | SortStatementNode
  | ReleaseStatementNode
  | CheckpointStatementNode
  | RestartStatementNode
  | SearchStatementNode
  | RaiseStatementNode;

/**
 * Every block nested inside one statement.
 *
 * The source-level twin of the IR's `childBlocks`, and it exists for the same
 * reason. The typechecker had its own version that read a fixed list of
 * property names, and that list was missing `otherwise` — a `switch`'s `else`
 * branch — along with sort procedures and the `on error` blocks. Two checks
 * walk with it, and both were wrong in the quiet direction: a `release` in a
 * `switch` else branch was reported as missing, and a `rewrite` in one was
 * never checked for the read that has to precede it (`BANK-FILE-010`), so a
 * program with a real defect passed.
 *
 * A `switch` over every kind with no `default`, so a statement added with a
 * block and forgotten here is a type error rather than a check that silently
 * stops covering it. The same defect in the backend emitted COBOL that
 * referenced an undeclared field; see `childBlocks` in the IR package.
 */
export function childBlocksOf(statement: StatementNode): BlockNode[] {
  switch (statement.kind) {
    case "IfStatement":
      return [
        statement.thenBranch,
        ...(statement.elseBranch ? [statement.elseBranch] : []),
      ];
    case "WhileStatement":
    case "ForEachStatement":
    case "CursorLoopStatement":
      return [statement.body];
    case "SwitchStatement":
      return [
        ...statement.cases.map((entry) => entry.body),
        ...(statement.otherwise ? [statement.otherwise] : []),
      ];
    case "SearchStatement":
      return [statement.body, statement.notFound];
    case "RestartStatement":
      return [statement.resumed, ...(statement.fresh ? [statement.fresh] : [])];
    case "QueueStatement":
      return [
        ...(statement.body ? [statement.body] : []),
        ...(statement.notFound ? [statement.notFound] : []),
      ];
    case "SortStatement":
      return [
        ...(statement.inputProcedure ? [statement.inputProcedure.body] : []),
        ...(statement.outputProcedure ? [statement.outputProcedure.body] : []),
      ];
    case "FileStatement":
      return statement.atEndOfPage ? [statement.atEndOfPage] : [];
    case "SerializeStatement":
    case "XmlParseStatement":
    case "ProgramCallStatement":
      return statement.onError ? [statement.onError] : [];
    case "LetStatement":
    case "ReturnStatement":
    case "LedgerStatement":
    case "AuditStatement":
    case "AssignStatement":
    case "ExpressionStatement":
    case "SqlStatement":
    case "CicsStatement":
    case "UnitOfWorkStatement":
    case "ReturnCodeStatement":
    case "ConsoleStatement":
    case "ResetStatement":
    case "SplitStatement":
    case "ReportStatement":
    case "DliStatement":
    case "ReleaseStatement":
    case "CheckpointStatement":
    case "RaiseStatement":
      return [];
  }
}

/**
 * The expressions directly inside one, for a pass that has to look at all of
 * them.
 *
 * The sibling of `childBlocksOf`, and it exists for the same reason: a check
 * that walks the tree by hand grows a hole every time the tree gains a node,
 * and the hole is silent. Written as a `switch` over the union so a new kind of
 * expression is a compile error here rather than a case nobody visits.
 */
export function childExpressionsOf(
  expression: ExpressionNode,
): ExpressionNode[] {
  switch (expression.kind) {
    case "Identifier":
    case "DecimalLiteral":
    case "BooleanLiteral":
    case "StringLiteral":
    case "EnumMember":
      return [];
    case "MemberAccess":
      return [expression.target];
    case "BinaryExpression":
      return [expression.left, expression.right];
    case "UnaryExpression":
      return [expression.operand];
    case "RoundedExpression":
      return [expression.operand];
    case "IndexAccess":
      return [expression.target, expression.index];
    case "NullableCheck":
      return [expression.operand];
    case "CallExpression":
      return expression.args;
    case "TemporalCall":
    case "NumericCall":
    case "StringCall":
      return expression.args;
  }
}

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
  /**
   * Further record layouts the same file carries: `record Head, Detail`.
   *
   * COBOL's several `01` entries under one `FD`, which share one record area
   * and are chosen by name at each `WRITE`. 2,812 of the 6,451 file
   * descriptions in the X-COBOL corpus declare more than one, and 2,663 of
   * those are opened `OUTPUT`: a report or a feed whose heading line and detail
   * lines are different shapes. That is what this is for, and it is the whole
   * of what it is for — a file read with more than one layout is refused, since
   * a `read` cannot know which of them arrived.
   */
  alternateRecordTypeNames: { name: string; span: SourceSpan }[];
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
  /**
   * `varying <min> to <max> length <field>` — a variable-length record.
   *
   * A fixed-length file pads every record to the longest one it might hold,
   * which for a feed whose records differ by hundreds of bytes is most of the
   * dataset. `RECORD IS VARYING` writes only what the record uses, and the
   * length field is how the program says how much that is — set before a write,
   * read after a read.
   */
  recordVarying: { min: number; max: number; lengthName: string } | null;
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

/**
 * `database accountDb pcb segment "ACCTSEG" key "ACCTID" record Seg status s;`
 *
 * An IMS database, reached through DL/I. The program does not open it or read
 * it with COBOL file control: the region hands it a PCB, and every operation is
 * `CALL "CBLTDLI"` with a function code, that PCB, a segment area, and a search
 * argument.
 *
 * The segment and key names live on the declaration because the search argument
 * is built from them and does not change per call — which is also what stops
 * every statement having to repeat an eight-character name that must match the
 * DBD exactly.
 */
export interface DatabaseDeclarationNode extends NodeBase {
  kind: "DatabaseDeclaration";
  name: string;
  /** The segment this program is sensitive to, as the DBD spells it. */
  segmentName: string;
  /** The key field within that segment, as the DBD spells it. */
  keyName: string;
  recordTypeName: string;
  /** Where the PCB's two-character status code is read from. */
  statusName: string | null;
}

/**
 * `getUnique <db> into <record> key <value>;` and the rest of DL/I.
 *
 * Each becomes one `CALL "CBLTDLI"`. The status the call leaves in the PCB is
 * the whole error model — spaces mean it worked, `GE` means not found, `GB`
 * means the end of the database — which is why a database, like a file, has to
 * declare somewhere to read it from.
 */
export interface DliStatementNode extends NodeBase {
  kind: "DliStatement";
  operation:
    | "getUnique"
    | "getNext"
    | "getHoldUnique"
    | "getHoldNext"
    | "insertSegment"
    | "replaceSegment"
    | "deleteSegment";
  databaseName: string;
  databaseSpan: SourceSpan;
  /** The record the segment is read into or written from. */
  recordName: string | null;
  recordSpan: SourceSpan | null;
  /** The key a `getUnique` looks for. */
  key: ExpressionNode | null;
}

/**
 * `queue <name> manager <mgr> name <q> <input|output> record <R> status <s>;`
 *
 * An IBM MQ queue. Unlike a file, a queue is not opened by file control: the
 * program connects to a queue manager, opens the queue as an *object* described
 * by an MQOD, and every operation is a `CALL` on the MQI with a completion code
 * and a reason code coming back.
 *
 * The manager and queue names live on the declaration for the same reason the
 * DL/I segment name does — they are built into the object descriptor once, and
 * each is 48 characters, which is what `MQOD-OBJECTNAME` and the `MQCONN`
 * queue-manager name carry.
 */
export interface QueueDeclarationNode extends NodeBase {
  kind: "QueueDeclaration";
  name: string;
  /** The queue manager to connect to, as it is defined to MQ. */
  managerName: string;
  /** The queue itself, as it is defined to the queue manager. */
  queueName: string;
  /** Which MQOO_* option the open asks for, and so which calls are allowed. */
  direction: "input" | "output";
  recordTypeName: string;
  /**
   * Where the reason code is read from.
   *
   * Required, and for the reason a file's status is: the completion code and
   * reason code the MQI leaves are the entire error model, and a `get` that
   * found no message is reported the same way as one that worked.
   */
  statusName: string | null;
}

/**
 * `connect <q>;`, `put <q> from <r>;`, `get <q> into <r> { } else { }`,
 * `disconnect <q>;`
 *
 * Each becomes one or more `CALL` on the MQI. `connect` is `MQCONN` followed by
 * `MQOPEN`, and `disconnect` is `MQCLOSE` followed by `MQDISC`, because neither
 * half is useful alone and forgetting the second is how a program leaves a
 * queue open and a connection handle dangling at the end of a batch.
 */
export interface QueueStatementNode extends NodeBase {
  kind: "QueueStatement";
  operation: "connect" | "put" | "get" | "disconnect";
  queueName: string;
  queueSpan: SourceSpan;
  /** The record a message is built from or read into. */
  recordName: string | null;
  recordSpan: SourceSpan | null;
  /** Taken when a `get` returned a message. */
  body: BlockNode | null;
  /** Taken when the queue was empty, which is not a failure. */
  notFound: BlockNode | null;
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
 * `restart restartFile into restartRecord { ... } else { ... }`
 *
 * The other half of a checkpoint, and the half that makes it worth anything: a
 * position written down and never read back is a rerun that still starts at the
 * beginning. This reads the position the last run committed and gives the
 * program somewhere to resume from — and, when there is none, somewhere to
 * start fresh.
 *
 * The key field of `recordName` has to hold the key of the position being
 * looked for before the statement runs, the same way a keyed `read` works.
 */
export interface RestartStatementNode extends NodeBase {
  kind: "RestartStatement";
  fileName: string;
  recordName: string;
  /** Run when a position was found; `recordName` holds it. */
  resumed: BlockNode;
  /** Run when there was none. Absent means a fresh start needs nothing done. */
  fresh: BlockNode | null;
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
 * `call <name> using <record> on error { ... };` and `cancel <name>;`
 *
 * A dynamic `CALL`: the program being called is named by a *value*, not written
 * into the source. That is how a bank dispatches — a product code selects the
 * module that prices it, and a new product ships as a new load module without
 * relinking anything that calls it.
 *
 * `ON EXCEPTION` is what makes it safe. A static call that cannot be resolved
 * fails at link time, where someone sees it; a dynamic one fails at run time, in
 * the middle of a batch, and without a handler that is an abend rather than a
 * rejected record.
 *
 * `CANCEL` drops the loaded module so the next call gets it fresh — which
 * matters when its working storage is state the caller does not want carried
 * from one invocation to the next.
 */
export interface ProgramCallStatementNode extends NodeBase {
  kind: "ProgramCallStatement";
  operation: "call" | "cancel";
  program: ExpressionNode;
  /** The record handed over, which the callee reads through its LINKAGE. */
  using: MemberAccessNode | IdentifierNode | null;
  onError: BlockNode | null;
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
  /**
   * `search sorted` — COBOL `SEARCH ALL`, a binary search.
   *
   * A linear scan of a rate table with a thousand bands reads five hundred rows
   * to find one; a binary search reads ten. COBOL will do it only if the table
   * says it is ordered, which is what `ascending` on the declaration is for, and
   * only on equality against that key — anything else has no ordering to
   * bisect on.
   */
  sorted: boolean;
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

/**
 * `test postsBothLegs for postAccounts { ... }` — a zUnit test case.
 *
 * The one declaration that is not compiled into the program. It describes a run
 * of the program under IBM's z/OS Automated Unit Testing Framework: what the
 * step is started with, and what the program must ask the ledger and the audit
 * trail to do. `packages/zunit` turns it into the three artifacts the runner
 * needs; the COBOL emitter ignores it entirely.
 *
 * The shape is dictated by what a zUnit driver can actually see. It runs in its
 * own program, so the program under test's WORKING-STORAGE is not reachable:
 * the observable surface is the LINKAGE the program is entered with and the
 * calls it makes, and the expectations here are exactly those two things.
 * `docs/zunit.md` records where each piece of the
 * generated artifact comes from.
 */
export interface TestDeclarationNode extends NodeBase {
  kind: "TestDeclaration";
  /** Names the test, and so the `TEST_<name>` entry point the runner calls. */
  name: string;
  /** The entry transaction the case runs, which is the whole program. */
  transactionName: string;
  transactionSpan: SourceSpan;
  /** Kept in source order: the expectations are an ordered sequence. */
  steps: TestStepNode[];
}

export type TestStepNode =
  TestGivenNode | TestExpectLedgerNode | TestExpectAuditNode;

/** `given runDate = 20260805;` — one field of the step's PARM. */
export interface TestGivenNode extends NodeBase {
  kind: "TestGiven";
  parameter: string;
  value: ExpressionNode;
}

/** `expect debit("0001", 100.00);` — the next call the ledger receives. */
export interface TestExpectLedgerNode extends NodeBase {
  kind: "TestExpectLedger";
  operation: "debit" | "credit";
  account: ExpressionNode;
  amount: ExpressionNode;
}

/** `expect audit("POSTED", "IDEM-1");` — the next call the audit trail gets. */
export interface TestExpectAuditNode extends NodeBase {
  kind: "TestExpectAudit";
  event: ExpressionNode;
  correlation: ExpressionNode;
}

export type DeclarationNode =
  | TypeAliasDeclarationNode
  | RecordDeclarationNode
  | FunctionDeclarationNode
  | TransactionDeclarationNode
  | FileDeclarationNode
  | DatabaseDeclarationNode
  | QueueDeclarationNode
  | ReportDeclarationNode
  | EnumDeclarationNode
  | FileErrorHandlerNode
  | TestDeclarationNode
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
