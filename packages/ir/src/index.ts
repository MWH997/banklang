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
  type ReportGroupNode,
  type ReportPageNode,
  type NumericCallNode,
  type SourceSpan,
  type IndexAccessNode,
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
  type StringCallNode,
  type SortProcedureNode,
} from "../../ast/src/index";
import type { EditStyle, NumericUsage } from "../../cobol-ir/src/index";
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
  reports: IRReport[];
  databases: IRDatabase[];
  queues: IRQueue[];
  /** `USE AFTER ERROR` procedures, one per file that declares a handler. */
  fileErrorHandlers: IRFileErrorHandler[];
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

export type BackendRequirement =
  "db2-precompiler" | "cics-translator" | "report-writer-precompiler" | "mq";

export interface IRSql {
  kind: "Sql";
  name: string;
  span: SourceSpan;
  parameters: IRParameter[];
  resultRecordName: string | null;
  /** `statement` runs once; `cursor` is declared, opened, fetched, and closed. */
  form: "statement" | "cursor";
  text: string;
  /** A cursor's SELECT without its INTO, and that INTO on its own. */
  cursorSelect: string | null;
  cursorInto: string | null;
  hostVariables: { name: string; origin: "parameter" | "result" }[];
}

export interface IREnum {
  kind: "Enum";
  name: string;
  span: SourceSpan;
  members: string[];
}

/** A DECLARATIVES section: the file it covers and what it does. */
export interface IRFileErrorHandler {
  kind: "FileErrorHandler";
  fileName: string;
  span: SourceSpan;
  body: IRBlock;
}

/**
 * A `report` declaration, lowered to what the REPORT SECTION needs.
 *
 * The groups are carried through as declared rather than reshaped: COBOL's own
 * report description is already the right structure, so lowering resolves the
 * names and leaves the shape alone.
 */
export interface IRReport {
  kind: "Report";
  span: SourceSpan;
  name: string;
  fileName: string;
  /** The record the report reads its values from, for qualifying references. */
  recordName: string;
  controls: string[];
  page: ReportPageNode | null;
  groups: ReportGroupNode[];
}

export interface IRFile {
  kind: "File";
  name: string;
  span: SourceSpan;
  organization: "sequential" | "indexed" | "relative";
  mode: "input" | "output" | "update";
  record: IRRecord;
  statusName: string | null;
  /** `RECORD IS VARYING` — the bounds, and the field holding the used length. */
  recordVarying: { min: number; max: number; lengthName: string } | null;
  keyFieldName: string | null;
  /** Alternate record keys, which allow duplicates. */
  alternateKeyNames: string[];
  /**
   * `LINAGE` — page depth, for a print file that paginates.
   *
   * COBOL counts the lines written and signals `AT END-OF-PAGE` at the footing
   * line, which is where a report writes its totals and the next heading.
   */
  linage: {
    lines: number;
    footingAt: number | null;
    linesAtTop: number | null;
    linesAtBottom: number | null;
  } | null;
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
  /**
   * Restricted data. Carried into the IR so the copybook layout report can say
   * which fields hold it — an auditor reading the evidence should not have to
   * read the BankTS source to find out.
   */
  sensitive: boolean;
  /** `FILLER` — space nothing names, so nothing may move through it either. */
  reserved: boolean;
  /** The field whose storage this one re-reads, for a variant record. */
  redefines: string | null;
  /** The field holding how much of this table the record uses. */
  dependingOn: string | null;
  /** `ASCENDING KEY` — the field the table is ordered by, for a binary search. */
  ascendingKey: string | null;
  /** True when the field is aligned on its natural boundary. */
  synchronized: boolean;
  /** `VALUE` — the literal the field starts as, already in COBOL's spelling. */
  initialValue: string | null;
  /** `JUSTIFIED RIGHT` — right-align an alphanumeric value in the field. */
  justified: boolean;
  /** `BLANK WHEN ZERO` — print spaces rather than zeros. */
  blankWhenZero: boolean;
  /**
   * `RENAMES` — the run of fields this one is a second name for.
   *
   * It carries no storage: the emitters skip it among the record's own entries
   * and write it as a level-66 after them, which is where COBOL requires it.
   */
  renames: { from: string; to: string } | null;
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
   * `nested function` — emitted as a COBOL contained program: its own storage
   * and a real `CALL` boundary, reading the module's records directly because
   * they are `GLOBAL` in the container.
   */
  isNested: boolean;
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

/**
 * One field of a file record, for the per-field mapping a `read` or a `write`
 * generates.
 *
 * An array field carries its bound, because COBOL cannot move an `OCCURS` item
 * without a subscript, and the item its length depends on when it has one — the
 * mapping has to stop at the occurrences the record is actually using rather
 * than at the declared maximum.
 */
export interface IRMappedField {
  name: string;
  arrayLength: number | null;
  dependingOn: string | null;
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
  | IRCursorLoopStatement
  | IRUnitOfWorkStatement
  | IRReturnCodeStatement
  | IRSplitStatement
  | IRSerializeStatement
  | IRXmlParseStatement
  | IRReportStatement
  | IRProgramCallStatement
  | IRDliStatement
  | IRQueueStatement
  | IRSortStatement
  | IRReleaseStatement
  | IRCheckpointStatement
  | IRRestartStatement
  | IRConsoleStatement
  | IRResetStatement
  | IRSearchStatement
  | IRRaiseStatement;

/**
 * Every block nested inside one statement.
 *
 * There are six walkers over the IR — what a block can fail with, what posts to
 * the ledger, which routines it calls, which statements a rule counts — and
 * each of them used to enumerate the block-carrying statement kinds itself.
 * Every one of them missed `QueueStatement`, so a transaction whose only audit
 * event was inside an MQ get was reported as having none, and a ledger posting
 * inside one was invisible to `BANK-LED-001`. A rule that cannot see the code
 * is worse than no rule: it reports a clean program.
 *
 * Adding a statement kind with a block is now one edit here rather than six
 * spread across two packages, and forgetting it is a missing case in a
 * `switch` the compiler checks rather than a silent omission.
 */
export function childBlocks(statement: IRStatement): IRBlock[] {
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
    case "SearchStatement":
      return [statement.body, statement.notFound];
    case "SwitchStatement":
      return [
        ...statement.cases.map((entry) => entry.body),
        ...(statement.otherwise ? [statement.otherwise] : []),
      ];
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
    case "SplitStatement":
    case "ReportStatement":
    case "DliStatement":
    case "ReleaseStatement":
    case "CheckpointStatement":
    case "ConsoleStatement":
    case "ResetStatement":
    case "RaiseStatement":
      return [];
  }
}

/** Every statement in a block, including those nested inside one. */
export function flattenIRStatements(statements: IRStatement[]): IRStatement[] {
  return statements.flatMap((statement) => [
    statement,
    ...childBlocks(statement).flatMap((block) =>
      flattenIRStatements(block.statements),
    ),
  ]);
}

/** `DISPLAY` to the job log, or `ACCEPT` from the job or the clock. */
export interface IRConsoleStatement {
  kind: "ConsoleStatement";
  span: SourceSpan;
  operation: "log" | "accept";
  values: IRExpression[];
  target: IRExpression | null;
  source: "parameter" | "date" | "time" | null;
}

/** `INITIALIZE` — every field to its type's empty value. */
export interface IRResetStatement {
  kind: "ResetStatement";
  span: SourceSpan;
  recordName: string;
}

/** A restart point: the position written down, and the work committed to it. */
export interface IRCheckpointStatement {
  kind: "CheckpointStatement";
  span: SourceSpan;
  fileName: string;
  recordName: string;
  every: number;
  /** True when the program has SQL, so the checkpoint also commits it. */
  commitsSql: boolean;
  recordFields: IRMappedField[];
  /** The key the position is written under, so a rerun can find it again. */
  keyFieldName: string | null;
}

/**
 * Reading back the position a checkpoint wrote.
 *
 * The half without which the other half is decoration: a keyed read of the
 * restart record, and the two branches a batch needs — resume from here, or
 * there is nothing to resume from.
 */
export interface IRRestartStatement {
  kind: "RestartStatement";
  span: SourceSpan;
  fileName: string;
  recordName: string;
  keyFieldName: string | null;
  recordFields: IRMappedField[];
  resumed: IRBlock;
  fresh: IRBlock | null;
}

/**
 * An `INPUT PROCEDURE` or `OUTPUT PROCEDURE` body, run once per record.
 *
 * The loop, the end-of-data test, and the field mapping between the file record
 * and `recordName` are all generated; the body is what the program does with
 * each record in between.
 */
export interface IRSortProcedure {
  recordName: string;
  /** The record's fields, for mapping to and from the FD or SD record. */
  recordFields: IRMappedField[];
  body: IRBlock;
}

/** `SORT` or `MERGE` over declared files, through a generated sort file. */
export interface IRSortStatement {
  kind: "SortStatement";
  span: SourceSpan;
  operation: "sort" | "merge";
  inputs: string[];
  output: string;
  keys: { name: string; descending: boolean }[];
  /** The output record's field names, for the SD the sort runs through. */
  recordFields: string[];
  /** Replaces `USING` when the records need work on the way in. */
  inputProcedure: IRSortProcedure | null;
  /** Replaces `GIVING` when they need work on the way out. */
  outputProcedure: IRSortProcedure | null;
}

/** `RELEASE` — hands a record to a running sort from its input procedure. */
export interface IRReleaseStatement {
  kind: "ReleaseStatement";
  span: SourceSpan;
  recordName: string;
}

/** `UNSTRING source DELIMITED BY d INTO a b c`. */
export interface IRSplitStatement {
  kind: "SplitStatement";
  span: SourceSpan;
  source: IRExpression;
  delimiter: IRExpression;
  targets: IRExpression[];
}

/**
 * `XML PARSE <text> PROCESSING PROCEDURE <section>`.
 *
 * The bindings are carried through rather than lowered to statements: the
 * handler COBOL needs is a state machine over the event registers, and the
 * backend is the only place that knows how to write one.
 */
export interface IRXmlParseStatement {
  kind: "XmlParseStatement";
  span: SourceSpan;
  source: IRExpression;
  bindings: {
    element: string;
    target: IRExpression;
    /** True when the content has to go through `FUNCTION NUMVAL` to land. */
    numeric: boolean;
  }[];
  onError: IRBlock | null;
}

/** An IMS database: a PCB the region passes in, and the segment it holds. */
export interface IRDatabase {
  kind: "Database";
  span: SourceSpan;
  name: string;
  segmentName: string;
  keyName: string;
  record: IRRecord;
  statusName: string | null;
  /** Bytes of the key field, which is how wide the search argument's value is. */
  keyLength: number;
}

/** An IBM MQ queue: a manager to connect to, and the object to open on it. */
export interface IRQueue {
  kind: "Queue";
  span: SourceSpan;
  name: string;
  managerName: string;
  queueName: string;
  direction: "input" | "output";
  record: IRRecord;
  statusName: string | null;
}

/**
 * One MQI operation, which is one or two `CALL`s.
 *
 * `connect` is `MQCONN` then `MQOPEN`, and `disconnect` is `MQCLOSE` then
 * `MQDISC`: neither half is useful alone, and a program that opens without
 * connecting or closes without disconnecting leaves a handle behind.
 */
export interface IRQueueStatement {
  kind: "QueueStatement";
  span: SourceSpan;
  operation: "connect" | "put" | "get" | "disconnect";
  queueName: string;
  recordName: string | null;
  /** Taken when a `get` returned a message. */
  body: IRBlock | null;
  /** Taken when the queue was empty, which MQ reports rather than raises. */
  notFound: IRBlock | null;
}

/** One `CALL "CBLTDLI"` with a function code. */
export interface IRDliStatement {
  kind: "DliStatement";
  span: SourceSpan;
  operation:
    | "getUnique"
    | "getNext"
    | "getHoldUnique"
    | "getHoldNext"
    | "insertSegment"
    | "replaceSegment"
    | "deleteSegment";
  databaseName: string;
  recordName: string | null;
  key: IRExpression | null;
}

/** `CALL <name> USING <record>` and `CANCEL <name>`, both naming the module by value. */
export interface IRProgramCallStatement {
  kind: "ProgramCallStatement";
  span: SourceSpan;
  operation: "call" | "cancel";
  program: IRExpression;
  using: IRExpression | null;
  onError: IRBlock | null;
}

/** `INITIATE`, `GENERATE`, and `TERMINATE`. */
export interface IRReportStatement {
  kind: "ReportStatement";
  span: SourceSpan;
  operation: "initiate" | "generate" | "terminate";
  target: string;
}

/** `JSON GENERATE t FROM r COUNT IN n`, `JSON PARSE t INTO r`, and the XML twins. */
export interface IRSerializeStatement {
  kind: "SerializeStatement";
  span: SourceSpan;
  format: "json" | "xml";
  direction: "generate" | "parse";
  target: IRExpression;
  source: IRExpression;
  count: IRExpression | null;
  onError: IRBlock | null;
}

/** `SEARCH table AT END <notFound> WHEN <condition> <body>`. */
export interface IRSearchStatement {
  kind: "SearchStatement";
  span: SourceSpan;
  elementName: string;
  /** COBOL group the table field is qualified by, and the field itself. */
  arrayRecordName: string;
  arrayFieldName: string;
  condition: IRExpression;
  body: IRBlock;
  notFound: IRBlock;
  /** `SEARCH ALL` — a binary search over a table that declares its order. */
  sorted: boolean;
}

/** `MOVE <n> TO RETURN-CODE` — the step's condition code. */
export interface IRReturnCodeStatement {
  kind: "ReturnCodeStatement";
  span: SourceSpan;
  value: IRExpression;
}

/** `EXEC SQL COMMIT` or `EXEC SQL ROLLBACK` — the batch unit of work. */
export interface IRUnitOfWorkStatement {
  kind: "UnitOfWorkStatement";
  span: SourceSpan;
  operation: "commit" | "rollback";
}

/**
 * A bounded read of a Db2 cursor.
 *
 * The OPEN and CLOSE are generated around the body rather than written, so the
 * cursor cannot be left open — a cursor still holding locks at the end of a
 * batch window is a defect the language can simply make unwritable.
 */
export interface IRCursorLoopStatement {
  kind: "CursorLoopStatement";
  span: SourceSpan;
  cursorName: string;
  args: IRExpression[];
  /** COBOL group item each fetched row lands in. */
  rowRecordName: string;
  /** The most rows the loop may process. */
  limit: number;
  body: IRBlock;
}

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
  operation:
    | "link"
    | "syncpoint"
    | "rollback"
    | "readFile"
    | "writeFile"
    | "rewriteFile"
    | "writeQueue"
    | "readQueue"
    | "returnTransid";
  /** The named resource: a program, dataset, queue, or transaction identifier. */
  program: string | null;
  /** The record the command moves. */
  commarea: string | null;
  respName: string | null;
  /** Record key for a file command. */
  key: IRExpression | null;
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
  target:
    IRIdentifierExpression | IRMemberAccessExpression | IRIndexAccessExpression;
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
  operation:
    | "open"
    | "read"
    | "readNext"
    | "write"
    | "rewrite"
    | "delete"
    | "start"
    | "close";
  fileName: string;
  recordName: string | null;
  /** Mode of the declared file, needed to emit OPEN INPUT vs OPEN OUTPUT. */
  fileMode: "input" | "output" | "update";
  fileOrganization: "sequential" | "indexed" | "relative";
  statusName: string | null;
  keyFieldName: string | null;
  key: IRExpression | null;
  /**
   * The file record's fields, for per-field mapping. An array field carries
   * its bound, because COBOL cannot move an OCCURS item without a subscript.
   */
  recordFields: IRMappedField[];
  /** `AFTER ADVANCING`, on a write to a print file. */
  advancing: number | "page" | null;
  /** `AT END-OF-PAGE` — where a report writes its totals and next heading. */
  atEndOfPage: IRBlock | null;
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
  | IRNullableCheckExpression
  | IRTemporalCallExpression
  | IRNumericCallExpression
  | IRStringCallExpression;

/**
 * A string builtin, lowered to `STRING`, reference modification, or an
 * intrinsic function.
 */
export interface IRStringCallExpression {
  kind: "StringCall";
  span: SourceSpan;
  operation:
    | "trim"
    | "upper"
    | "lower"
    | "substring"
    | "concat"
    | "now"
    | "countOf"
    | "replaceChars";
  args: IRExpression[];
  resolvedType: IRType;
}

/**
 * A calendar-aware builtin, lowered to a COBOL intrinsic function.
 *
 * `INTEGER-OF-DATE` and `DATE-OF-INTEGER` convert between YYYYMMDD and a day
 * number, which is where the calendar actually lives: adding thirty days is
 * addition on the day number, not on the digits of the date.
 */
export interface IRTemporalCallExpression {
  kind: "TemporalCall";
  span: SourceSpan;
  operation: "today" | "addDays" | "daysBetween";
  args: IRExpression[];
  resolvedType: IRType;
}

/**
 * `FUNCTION ABS`, `MOD`, `REM`, `MIN`, `MAX`, `ANNUITY`, `PRESENT-VALUE`,
 * `TEST-NUMVAL`, and `NUMVAL`.
 *
 * COBOL computes all of these itself, which is the point of using them: a
 * repayment factor worked out in a loop rounds differently from the one the
 * language's own intrinsic produces, and the difference shows up in a customer's
 * final instalment.
 */
export interface IRNumericCallExpression {
  kind: "NumericCall";
  span: SourceSpan;
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
  args: IRExpression[];
  resolvedType: IRType;
}

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
  target:
    IRIdentifierExpression | IRMemberAccessExpression | IRIndexAccessExpression;
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
  | EditedIRType
  | DecimalIRType
  | StringIRType
  | BoolIRType
  | TemporalIRType
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
  /** Packed, binary, or zoned decimal. Representation, not meaning. */
  usage: NumericUsage;
}

export interface StringIRType {
  kind: "string";
  length: number;
  /**
   * `PIC N(n) USAGE NATIONAL` rather than `PIC X(n)`: `length` counts
   * characters, and each takes two bytes.
   */
  national?: boolean;
}

export interface BoolIRType {
  kind: "bool";
}

/**
 * A date, time, or timestamp.
 *
 * Stored as the mainframe convention rather than as an opaque handle: a date is
 * `PIC 9(8)` holding YYYYMMDD, which is exactly why comparing and sorting dates
 * is ordinary numeric comparison. A timestamp is `PIC X(26)`, the Db2 host
 * variable format, so it can be read from and written to a TIMESTAMP column.
 */
/**
 * A numeric-edited item: a rendering of a number for a human to read.
 *
 * It carries the precision and scale of the value it renders, because the
 * picture is generated from them rather than written out by hand.
 */
export interface EditedIRType {
  kind: "edited";
  style: EditStyle;
  precision: number;
  scale: number;
}

export interface TemporalIRType {
  kind: "temporal";
  unit: "date" | "time" | "timestamp";
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
  // Only an error stops lowering. Bailing on any diagnostic at all meant a
  // warning silently produced no COBOL: a program whose only complaint was an
  // uninstantiated generic (BANK-TYPE-015) compiled to nothing and came back
  // `ok: false`, which is neither what the warning says nor what a warning is.
  if (
    typechecked.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    ) ||
    !typechecked.program
  ) {
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
  databaseStatusTable.clear();
  queueStatusTable.clear();
  for (const queue of typechecked.queues) {
    if (queue.statusName) {
      queueStatusTable.set(queue.name, queue.statusName);
    }
  }
  for (const database of typechecked.databases) {
    if (database.statusName) {
      databaseStatusTable.set(database.name, database.statusName);
    }
  }
  for (const file of typechecked.files) {
    fileTable.set(file.name, {
      mode: file.mode,
      organization: file.organization,
      statusName: file.statusName,
      recordVarying: file.recordVarying,
      keyFieldName: file.keyField?.name ?? null,
      alternateKeyNames: file.alternateKeys.map((field) => field.name),
      // A renames overlaps the run it names, so mapping it too would move the
      // same bytes twice; a reserved slot is `FILLER`, which has no name to
      // move through and whose bytes are nobody's to copy.
      recordFields: file.record.fields
        .filter((field) => !field.renames && !field.reserved)
        .map((field) => ({
          name: field.name,
          arrayLength: field.type.kind === "array" ? field.type.length : null,
          dependingOn: field.dependingOn,
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

  const shared = shareIdenticalInstantiations(
    typechecked.functions.map((fn) => lowerFunction(fn)),
  );
  const loweredFunctions = shared.functions;
  const recursive = findRecursiveFunctions(loweredFunctions);
  const failing = findFailingFunctions(loweredFunctions);
  const functions = loweredFunctions.map((fn) => ({
    ...fn,
    isRecursive: recursive.has(fn.name),
    canFail: failing.has(fn.name),
  }));
  const transactions = typechecked.transactions
    .map((transaction) => lowerTransaction(transaction))
    // A transaction is lowered after the functions it calls have been merged,
    // so its call sites still name instantiations that no longer exist.
    .map((transaction) => ({
      ...transaction,
      body: rewriteCallees(transaction.body, shared.aliases),
      failureHandler: transaction.failureHandler
        ? rewriteCallees(transaction.failureHandler, shared.aliases)
        : null,
    }))
    .map((transaction) => ({
      ...transaction,
      canFail:
        blockCanFail(transaction.body) ||
        [...collectCalls(transaction.body)].some((callee) =>
          failing.has(callee),
        ),
      postsToLedger: blockPostsToLedger(transaction.body),
    }));
  const handlerScope = (): Map<string, IRType> => {
    const scope = new Map<string, IRType>();
    addFileStatusSymbols(scope);
    return scope;
  };
  const fileErrorHandlers = typechecked.fileErrorHandlers.map((handler) => ({
    kind: "FileErrorHandler" as const,
    fileName: handler.fileName,
    span: handler.span,
    // The handler sees the file statuses and nothing else, matching the scope
    // the typechecker gave it.
    body: lowerBlock(handler.body, handlerScope()),
  }));
  const files = typechecked.files.map((file) => ({
    kind: "File" as const,
    name: file.name,
    span: file.span,
    organization: file.organization,
    mode: file.mode,
    record: lowerRecord(file.record, recordTypeMap),
    statusName: file.statusName,
    recordVarying: file.recordVarying,
    keyFieldName: file.keyField?.name ?? null,
    alternateKeyNames: file.alternateKeys.map((field) => field.name),
    linage: file.linage,
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
      databases: typechecked.databases.map((database) => ({
        kind: "Database" as const,
        span: database.span,
        name: database.name,
        segmentName: database.segmentName,
        keyName: database.keyName,
        record: lowerRecord(database.record, recordTypeMap),
        statusName: database.statusName,
        keyLength: 0,
      })),
      queues: typechecked.queues.map((queue) => ({
        kind: "Queue" as const,
        span: queue.span,
        name: queue.name,
        managerName: queue.managerName,
        queueName: queue.queueName,
        direction: queue.direction,
        record: lowerRecord(queue.record, recordTypeMap),
        statusName: queue.statusName,
      })),
      reports: typechecked.reports.map((report) => ({
        kind: "Report" as const,
        span: report.span,
        name: report.name,
        fileName: report.file.name,
        recordName: report.file.record.name,
        controls: report.controls,
        page: report.page,
        groups: report.groups,
      })),
      fileErrorHandlers,
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
        form: entry.form,
        text: entry.text,
        cursorSelect: entry.cursorSelect,
        cursorInto: entry.cursorInto,
        hostVariables: entry.hostVariables,
      })),
      backendRequirements: [
        // Report Writer runs first. It passes EXEC ... END-EXEC through
        // unchanged, so the CICS translator and the Db2 precompiler still see
        // their own blocks; the other way round they would have to read a
        // REPORT SECTION, which neither of them knows.
        ...(typechecked.reports.length > 0
          ? (["report-writer-precompiler"] as const)
          : []),
        // MQ needs no precompiler — the MQI is plain CALLs. What it needs is
        // the copybook library at compile time and the stub and run-time
        // libraries at link and run time.
        ...(typechecked.queues.length > 0 ? (["mq"] as const) : []),
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
    mode: "input" | "output" | "update";
    organization: "sequential" | "indexed" | "relative";
    statusName: string | null;
    recordVarying: { min: number; max: number; lengthName: string } | null;
    keyFieldName: string | null;
    /** The other indexes a browse may walk, by field name. */
    alternateKeyNames: string[];
    recordFields: IRMappedField[];
  }
>();
const functionTable = new Map<string, IRType>();

/** Declared database status field names, which are in scope like a file's. */
const databaseStatusTable = new Map<string, string>();
/**
 * Each queue's status field.
 *
 * MQ reports in a reason code rather than a two-character status, so unlike a
 * file's or a PCB's this one is a number — 2033 is an empty queue, 2085 is a
 * queue that is not there. Typing it as text would let a program compare it
 * with a string and never match.
 */
const queueStatusTable = new Map<string, string>();

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
  for (const [, database] of databaseStatusTable) {
    if (!scopeTypes.has(database)) {
      scopeTypes.set(database, { kind: "string", length: 2 });
    }
  }

  for (const [, queue] of queueStatusTable) {
    if (!scopeTypes.has(queue)) {
      scopeTypes.set(queue, {
        kind: "decimal",
        precision: 9,
        scale: 0,
        usage: "binary",
      });
    }
  }

  for (const [, file] of fileTable) {
    if (file.statusName && !scopeTypes.has(file.statusName)) {
      scopeTypes.set(file.statusName, { kind: "string", length: 2 });
    }
    // The used length of a varying record is the program's to set and read, so
    // it is in scope alongside the file status.
    if (file.recordVarying && !scopeTypes.has(file.recordVarying.lengthName)) {
      scopeTypes.set(file.recordVarying.lengthName, {
        kind: "decimal",
        precision: 4,
        scale: 0,
        usage: "binary",
      });
    }
  }

  if (sqlTable.size > 0 && !scopeTypes.has("sqlcode")) {
    scopeTypes.set("sqlcode", {
      kind: "decimal",
      precision: 9,
      scale: 0,
      usage: "packed",
    });
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
        usage: "packed",
      });
    }
    if (statement.kind === "IfStatement") {
      addCicsRespSymbols(statement.thenBranch, scopeTypes);
      if (statement.elseBranch) {
        addCicsRespSymbols(statement.elseBranch, scopeTypes);
      }
    }
    if (
      statement.kind === "WhileStatement" ||
      statement.kind === "ForEachStatement" ||
      statement.kind === "CursorLoopStatement"
    ) {
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

/** True for a name the typechecker minted for a generic instantiation. */
function isInstantiation(name: string): boolean {
  return name.includes("$");
}

/**
 * Merges instantiations that lower to identical COBOL onto one paragraph.
 *
 * Monomorphisation is the only sound lowering for a language with no boxing,
 * but on its own it copies a paragraph per instantiation whether or not the
 * copies differ. `firstOr<MoneyBDT>` and `firstOr<MoneyUSD>` both emit
 * `PIC S9(16)V99 COMP-3`: two identical paragraphs and two sets of storage for
 * a distinction that exists only in the typechecker. Sharing them changes what
 * is emitted, never what is accepted — currency stays nominally typed, and a
 * BDT amount is still rejected where a USD amount is expected.
 *
 * Only instantiations are merged. A function the author wrote keeps its own
 * paragraph even when another one happens to match it exactly, because that
 * name appears in the source, the source map, and the audit record.
 */
function shareIdenticalInstantiations(functions: IRFunction[]): {
  functions: IRFunction[];
  aliases: Map<string, string>;
} {
  const aliases = new Map<string, string>();
  let current = functions;

  // Merging one group can make another group identical: two instantiations of
  // a caller differ only in the callee they name until those callees merge.
  // Repeat until a round changes nothing.
  for (;;) {
    const groups = new Map<string, IRFunction[]>();
    for (const fn of current) {
      if (!isInstantiation(fn.name)) {
        continue;
      }
      const key = instantiationKey(fn);
      const group = groups.get(key);
      if (group) {
        group.push(fn);
      } else {
        groups.set(key, [fn]);
      }
    }

    const round = new Map<string, string>();
    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }
      // Sorted, so the surviving name depends on which instantiations exist and
      // not on the order the typechecker happened to create them in.
      const names = group.map((fn) => fn.name).sort();
      for (const name of names.slice(1)) {
        round.set(name, names[0]);
      }
    }

    if (round.size === 0) {
      return { functions: current, aliases };
    }

    for (const [from, to] of round) {
      aliases.set(from, to);
    }
    // An alias recorded in an earlier round may now name a function this round
    // merged away, so follow it to the name that survived.
    for (const [from, to] of aliases) {
      aliases.set(from, round.get(to) ?? to);
    }

    current = current
      .filter((fn) => !round.has(fn.name))
      .map((fn) => ({ ...fn, body: rewriteCallees(fn.body, round) }));
  }
}

/**
 * A rendering of a function that compares equal exactly when two functions emit
 * the same COBOL.
 *
 * Spans are dropped: a span places a diagnostic, not a statement. Currency is
 * erased to the decimal it shares a PICTURE with. A record is keyed by its
 * fields rather than its name, because a record parameter is reached through a
 * LINKAGE cell that the caller points at the actual record, so the cell's
 * layout is what reaches the generated program and the record's name does not.
 * The function's own name is replaced, so a self-call still matches.
 */
function instantiationKey(fn: IRFunction): string {
  const parameterSlots = new Map(
    fn.parameters.map((parameter, index) => [parameter.name, `@p${index}`]),
  );

  return JSON.stringify(
    { ...fn, name: "@self" },
    function (this: Record<string, unknown>, key: string, value: unknown) {
      if (key === "span") {
        return undefined;
      }
      if (key === "callee" && value === fn.name) {
        return "@self";
      }
      if (key === "targetName" && typeof value === "string") {
        return parameterSlots.get(value) ?? value;
      }
      if (key === "recordName" && typeof value === "string") {
        // A reference through a parameter renders as that parameter's cell. A
        // reference to anything else renders as the record's own group item, so
        // there the name is exactly what distinguishes the emitted code.
        const target = this.targetName;
        return typeof target === "string" && parameterSlots.has(target)
          ? "@cell"
          : value;
      }
      if (isIRTypeOfKind(value, "currency")) {
        return {
          kind: "decimal",
          precision: value.precision,
          scale: value.scale,
          usage: "packed",
        };
      }
      if (isIRTypeOfKind(value, "record")) {
        return { kind: "@record", fields: value.fields };
      }
      return value;
    },
  );
}

function isIRTypeOfKind<K extends IRType["kind"]>(
  value: unknown,
  kind: K,
): value is Extract<IRType, { kind: K }> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === kind
  );
}

/**
 * Repoints every call in a block at the instantiation that survived merging.
 *
 * The IR is plain data with no cycles, so a serialising walk rewrites every
 * `callee` wherever it appears without this needing to know the shape of every
 * statement and expression that can hold one.
 */
function rewriteCallees(
  block: IRBlock,
  aliases: ReadonlyMap<string, string>,
): IRBlock {
  return JSON.parse(
    JSON.stringify(block, (key, value) =>
      key === "callee" && typeof value === "string"
        ? (aliases.get(value) ?? value)
        : value,
    ),
  ) as IRBlock;
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
    // Everything nested, except a sort procedure. Control may not leave one
    // while the sort is running, so a guard inside a sort procedure does not
    // raise: it sets `SORT-RETURN` to 16, and the `SORT` statement's own check
    // is what reports it in the block that contains the sort. Counting it here
    // would wrap a transaction that cannot fail in a failure handler that
    // cannot run.
    if (
      statement.kind !== "SortStatement" &&
      childBlocks(statement).some(blockCanFail)
    ) {
      return true;
    }

    switch (statement.kind) {
      case "RaiseStatement":
        return true;
      case "IfStatement":
      case "WhileStatement":
        if (expressionNeedsBoundsCheck(statement.condition)) {
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
    case "TemporalCall":
    case "NumericCall":
    case "StringCall":
      return expression.args.some(expressionNeedsBoundsCheck);
    case "Call":
      return expression.args.some(expressionNeedsBoundsCheck);
    default:
      return false;
  }
}

/**
 * What a numeric builtin's result is held in.
 *
 * `abs`, `min`, and `max` give back what they were given. `mod` and `rem` give
 * a whole number. The financial three have no scale of their own — a repayment
 * factor is a ratio, and a parsed number is whatever the field it lands in
 * holds — so they take the widest packed decimal and let the receiving field's
 * picture decide, which is what COMPUTE does anyway.
 */
function numericCallType(
  expression: NumericCallNode,
  args: IRExpression[],
): IRType {
  switch (expression.operation) {
    case "isNumeric":
      return { kind: "bool" };
    case "sign":
      return { kind: "decimal", precision: 1, scale: 0, usage: "packed" };
    case "textLength":
      return { kind: "decimal", precision: 9, scale: 0, usage: "packed" };
    case "reverse":
      return args[0]?.resolvedType ?? { kind: "string", length: 1 };
    case "abs":
    case "min":
    case "max":
    case "mod":
    case "rem":
      return (
        args[0]?.resolvedType ?? {
          kind: "decimal",
          precision: 18,
          scale: 2,
          usage: "packed",
        }
      );
    case "annuity":
    case "presentValue":
    case "toNumber":
    case "integerPart":
    case "fractionPart":
      return { kind: "decimal", precision: 18, scale: 2, usage: "packed" };
  }
}

/** True when a block posts to the ledger, directly or in a nested block. */
function blockPostsToLedger(block: IRBlock): boolean {
  return block.statements.some(
    (statement) =>
      statement.kind === "LedgerStatement" ||
      childBlocks(statement).some(blockPostsToLedger),
  );
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
      case "TemporalCall":
      case "NumericCall":
      case "StringCall":
        expression.args.forEach(walkExpression);
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
        case "WhileStatement":
          walkExpression(statement.condition);
          break;
        default:
          break;
      }
      childBlocks(statement).forEach(walkBlock);
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
      kind: "Field" as const,
      name: field.name,
      span: field.span,
      type: lowerType(field.type),
      sensitive: field.sensitive,
      reserved: field.reserved,
      redefines: field.redefines,
      dependingOn: field.dependingOn,
      ascendingKey: field.ascendingKey,
      synchronized: field.synchronized,
      justified: field.justified,
      blankWhenZero: field.blankWhenZero,
      initialValue: field.initialValue,
      renames: field.renames,
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
    isNested: fn.isNested,
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
      if (
        target.kind !== "Identifier" &&
        target.kind !== "MemberAccess" &&
        target.kind !== "IndexAccess"
      ) {
        throw new Error(
          "Assignment target must be an identifier, a field, or a table element.",
        );
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
    case "ConsoleStatement":
      return {
        kind: "ConsoleStatement",
        span: statement.span,
        operation: statement.operation,
        values: statement.values.map((value) =>
          lowerExpression(value, scopeTypes),
        ),
        target: statement.target
          ? lowerExpression(statement.target, scopeTypes)
          : null,
        source: statement.source,
      };
    case "ResetStatement":
      return {
        kind: "ResetStatement",
        span: statement.span,
        recordName: statement.recordName,
      };
    case "CheckpointStatement": {
      const file = fileTable.get(statement.fileName);
      return {
        kind: "CheckpointStatement",
        span: statement.span,
        fileName: statement.fileName,
        recordName: statement.recordName,
        every: statement.every,
        commitsSql: sqlTable.size > 0,
        recordFields: file?.recordFields ?? [],
        keyFieldName: file?.keyFieldName ?? null,
      };
    }
    case "RestartStatement": {
      const file = fileTable.get(statement.fileName);
      return {
        kind: "RestartStatement",
        span: statement.span,
        fileName: statement.fileName,
        recordName: statement.recordName,
        keyFieldName: file?.keyFieldName ?? null,
        recordFields: file?.recordFields ?? [],
        resumed: lowerBlock(statement.resumed, scopeTypes),
        fresh: statement.fresh ? lowerBlock(statement.fresh, scopeTypes) : null,
      };
    }
    case "SortStatement": {
      const output = fileTable.get(statement.output);
      const fields = output?.recordFields ?? [];
      const lowerProcedure = (
        procedure: SortProcedureNode | null,
      ): IRSortProcedure | null =>
        procedure
          ? {
              recordName: procedure.recordName,
              recordFields: fields,
              body: lowerBlock(procedure.body, scopeTypes),
            }
          : null;

      return {
        kind: "SortStatement",
        span: statement.span,
        operation: statement.operation,
        inputs: statement.inputs,
        output: statement.output,
        keys: statement.keys,
        recordFields: fields.map((field) => field.name),
        inputProcedure: lowerProcedure(statement.inputProcedure),
        outputProcedure: lowerProcedure(statement.outputProcedure),
      };
    }
    case "ReleaseStatement":
      return {
        kind: "ReleaseStatement",
        span: statement.span,
        recordName: statement.recordName,
      };
    case "SplitStatement":
      return {
        kind: "SplitStatement",
        span: statement.span,
        source: lowerExpression(statement.source, scopeTypes),
        delimiter: lowerExpression(statement.delimiter, scopeTypes),
        targets: statement.targets.map((target) =>
          lowerExpression(target, scopeTypes),
        ),
      };
    case "DliStatement":
      return {
        kind: "DliStatement",
        span: statement.span,
        operation: statement.operation,
        databaseName: statement.databaseName,
        recordName: statement.recordName,
        key: statement.key ? lowerExpression(statement.key, scopeTypes) : null,
      };
    case "QueueStatement":
      return {
        kind: "QueueStatement",
        span: statement.span,
        operation: statement.operation,
        queueName: statement.queueName,
        recordName: statement.recordName,
        body: statement.body ? lowerBlock(statement.body, scopeTypes) : null,
        notFound: statement.notFound
          ? lowerBlock(statement.notFound, scopeTypes)
          : null,
      };
    case "ProgramCallStatement":
      return {
        kind: "ProgramCallStatement",
        span: statement.span,
        operation: statement.operation,
        program: lowerExpression(statement.program, scopeTypes),
        using: statement.using
          ? lowerExpression(statement.using, scopeTypes)
          : null,
        onError: statement.onError
          ? lowerBlock(statement.onError, scopeTypes)
          : null,
      };
    case "ReportStatement":
      return {
        kind: "ReportStatement",
        span: statement.span,
        operation: statement.operation,
        target: statement.target,
      };
    case "XmlParseStatement":
      return {
        kind: "XmlParseStatement",
        span: statement.span,
        source: lowerExpression(statement.source, scopeTypes),
        bindings: statement.bindings.map((binding) => {
          const target = lowerExpression(binding.target, scopeTypes);
          return {
            element: binding.element,
            target,
            // Text arrives as characters, so a number has to be converted
            // rather than moved: MOVE would read the digits as a picture.
            numeric:
              target.resolvedType.kind === "decimal" ||
              target.resolvedType.kind === "currency",
          };
        }),
        onError: statement.onError
          ? lowerBlock(statement.onError, scopeTypes)
          : null,
      };
    case "SerializeStatement":
      return {
        kind: "SerializeStatement",
        span: statement.span,
        format: statement.format,
        direction: statement.direction,
        target: lowerExpression(statement.target, scopeTypes),
        source: lowerExpression(statement.source, scopeTypes),
        count: statement.count
          ? lowerExpression(statement.count, scopeTypes)
          : null,
        onError: statement.onError
          ? lowerBlock(statement.onError, scopeTypes)
          : null,
      };
    case "SearchStatement": {
      const array = lowerExpression(statement.array, scopeTypes);
      const arrayType =
        array.kind === "Identifier" || array.kind === "MemberAccess"
          ? array.resolvedType
          : undefined;
      if (!arrayType || arrayType.kind !== "array") {
        throw new Error("search requires a table during IR lowering.");
      }

      // The element is bound for the condition and the body, the way a loop
      // index is, so both can talk about the row rather than a subscript.
      const bodyScope = new Map(scopeTypes);
      bodyScope.set(statement.elementName, arrayType.element);

      return {
        kind: "SearchStatement",
        span: statement.span,
        sorted: statement.sorted,
        elementName: statement.elementName,
        arrayRecordName:
          array.kind === "MemberAccess"
            ? array.recordName
            : array.kind === "Identifier"
              ? array.name
              : "",
        arrayFieldName:
          array.kind === "MemberAccess"
            ? array.member
            : array.kind === "Identifier"
              ? array.name
              : "",
        condition: lowerExpression(statement.condition, bodyScope),
        body: lowerBlock(statement.body, bodyScope),
        notFound: lowerBlock(statement.notFound, bodyScope),
      };
    }
    case "ReturnCodeStatement":
      return {
        kind: "ReturnCodeStatement",
        span: statement.span,
        value: lowerExpression(statement.value, scopeTypes),
      };
    case "UnitOfWorkStatement":
      return {
        kind: "UnitOfWorkStatement",
        span: statement.span,
        operation: statement.operation,
      };
    case "CursorLoopStatement": {
      const cursor = sqlTable.get(statement.cursorName);
      if (!cursor) {
        throw new Error(
          `Unresolved cursor during IR lowering: ${statement.cursorName}.`,
        );
      }
      return {
        kind: "CursorLoopStatement",
        span: statement.span,
        cursorName: statement.cursorName,
        args: statement.args.map((argument) =>
          lowerExpression(argument, scopeTypes),
        ),
        rowRecordName: statement.rowName,
        limit: statement.limit,
        body: lowerBlock(statement.body, scopeTypes),
      };
    }
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
        usage: "packed",
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
        key: statement.key ? lowerExpression(statement.key, scopeTypes) : null,
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
        // A `start` naming an alternate key browses that index instead. The
        // field the statement names is what COBOL takes the key of reference
        // from, and every READ NEXT after it follows the same one.
        keyFieldName:
          (statement.operation === "start" &&
          statement.key?.kind === "MemberAccess" &&
          file.alternateKeyNames.includes(statement.key.member)
            ? statement.key.member
            : null) ?? file.keyFieldName,
        key: statement.key ? lowerExpression(statement.key, scopeTypes) : null,
        recordFields: file.recordFields,
        advancing: statement.advancing,
        atEndOfPage: statement.atEndOfPage
          ? lowerBlock(statement.atEndOfPage, scopeTypes)
          : null,
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

/**
 * The type a string builtin produces, recomputed for the IR.
 *
 * Every length is decided at compile time, because a COBOL field has a fixed
 * one: `substring` takes literal bounds and `concat` sums its arguments.
 */
function stringCallType(
  expression: StringCallNode,
  scopeTypes: Map<string, IRType>,
): IRType {
  const lengthOf = (node: ExpressionNode): number => {
    const lowered = lowerExpression(node, scopeTypes);
    return lowered.resolvedType.kind === "string"
      ? lowered.resolvedType.length
      : 0;
  };

  switch (expression.operation) {
    case "now":
      return { kind: "temporal", unit: "timestamp" };
    case "countOf":
      return { kind: "decimal", precision: 9, scale: 0, usage: "packed" };
    case "replaceChars":
      return { kind: "string", length: lengthOf(expression.args[0]) };
    case "substring":
      return {
        kind: "string",
        length: Number((expression.args[2] as { text?: string }).text ?? "0"),
      };
    case "concat":
      return {
        kind: "string",
        length: expression.args.reduce(
          (total, argument) => total + lengthOf(argument),
          0,
        ),
      };
    default:
      return { kind: "string", length: lengthOf(expression.args[0]) };
  }
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
    case "StringCall":
      return {
        kind: "StringCall",
        span: expression.span,
        operation: expression.operation,
        args: expression.args.map((argument) =>
          lowerExpression(argument, scopeTypes),
        ),
        resolvedType: stringCallType(expression, scopeTypes),
      };
    case "NumericCall": {
      const args = expression.args.map((argument) =>
        lowerExpression(argument, scopeTypes),
      );
      return {
        kind: "NumericCall",
        span: expression.span,
        operation: expression.operation,
        args,
        resolvedType: numericCallType(expression, args),
      };
    }
    case "TemporalCall":
      return {
        kind: "TemporalCall",
        span: expression.span,
        operation: expression.operation,
        args: expression.args.map((argument) =>
          lowerExpression(argument, scopeTypes),
        ),
        resolvedType:
          expression.operation === "daysBetween"
            ? {
                kind: "decimal",
                precision: 9,
                scale: 0,
                usage: "packed",
              }
            : { kind: "temporal", unit: "date" },
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
          usage: "packed",
        },
      };
    }
    case "IndexAccess": {
      const target = lowerExpression(expression.target, scopeTypes);
      // The target of a second subscript is the first one: `rates[i][j]`
      // indexes into the row `rates[i]` names.
      if (
        target.kind !== "Identifier" &&
        target.kind !== "MemberAccess" &&
        target.kind !== "IndexAccess"
      ) {
        throw new Error(
          "Index target must be an identifier, a field, or a table element.",
        );
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
    // A table of tables subscripts through more index accesses, so the name
    // being indexed is whatever sits under all of them.
    let arrayTarget: MemberAccessNode | IdentifierNode | IndexAccessNode =
      expression.target.target;
    while (arrayTarget.kind === "IndexAccess") {
      arrayTarget = arrayTarget.target;
    }
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
    resolvedType: { kind: "decimal", precision, scale, usage: "packed" },
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
      usage: "packed",
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
  return (
    leftType ??
    rightType ?? {
      kind: "decimal",
      precision: 18,
      scale: 2,
      usage: "packed",
    }
  );
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
    case "edited":
      return {
        kind: "edited",
        style: type.style,
        precision: type.precision,
        scale: type.scale,
      };
    case "temporal":
      return { kind: "temporal", unit: type.unit };
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
      return { kind: "string", length: type.length, national: type.national };
    case "bool":
      return { kind: "bool" };
    case "record":
      return {
        kind: "record",
        name: type.name,
        fields: type.fields.map((field) => ({
          kind: "Field" as const,
          name: field.name,
          span: field.span,
          type: lowerType(field.type),
          sensitive: field.sensitive,
          reserved: field.reserved,
          redefines: field.redefines,
          dependingOn: field.dependingOn,
          ascendingKey: field.ascendingKey,
          synchronized: field.synchronized,
          justified: field.justified,
          blankWhenZero: field.blankWhenZero,
          initialValue: field.initialValue,
          renames: field.renames,
        })),
      };
  }
}

function lowerDecimalType(type: DecimalType): DecimalIRType {
  return {
    kind: "decimal",
    precision: type.precision,
    scale: type.scale,
    usage: type.usage ?? "packed",
  };
}
