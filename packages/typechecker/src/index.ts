import {
  copybookMemberName,
  EDIT_STYLES,
  type EditStyle,
  type NumericUsage,
} from "../../cobol-ir/src/index";
import {
  createDiagnostic,
  type BinaryExpressionNode,
  type BlockNode,
  type CursorLoopStatementNode,
  type EditedTypeNode,
  type MemberAccessNode,
  type NumericCallNode,
  type TemporalCallNode,
  type ReturnCodeStatementNode,
  type SearchStatementNode,
  type CheckpointStatementNode,
  type ConsoleStatementNode,
  type ReleaseStatementNode,
  type RestartStatementNode,
  type SortProcedureNode,
  type SortStatementNode,
  type ReportDeclarationNode,
  type ReportGroupNode,
  type ReportPageNode,
  type DatabaseDeclarationNode,
  type QueueDeclarationNode,
  type QueueStatementNode,
  type DliStatementNode,
  type ProgramCallStatementNode,
  type ReportStatementNode,
  type SerializeStatementNode,
  type XmlParseStatementNode,
  type SplitStatementNode,
  type UnitOfWorkStatementNode,
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
  type StringCallNode,
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
  type RaiseStatementNode,
  type FailureHandlerNode,
} from "../../ast/src/index";
import {
  describeTypeNode,
  instantiateFunction,
  instantiateRecord,
  mangleInstantiation,
} from "./generics";

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
  /**
   * How the value is held in storage: packed decimal by default, binary for a
   * counter or subscript, zoned decimal for the unpacked numbers a great deal
   * of legacy input arrives as.
   *
   * Usage is representation, not meaning. Two numbers with the same precision
   * and scale are the same value whatever bytes hold them, so usage takes no
   * part in type compatibility — only in the picture and the byte count.
   */
  usage?: NumericUsage;
}

export interface StringType {
  kind: "string";
  length: number;
  /**
   * True for a written literal, which fits any string field long enough to
   * hold it. COBOL `MOVE` pads with spaces, so this is not a silent truncation.
   */
  literal?: boolean;
  /**
   * `national<n>` — `PIC N(n) USAGE NATIONAL`, two bytes to a character.
   *
   * A different storage width is a different record layout, so a national and
   * an alphanumeric of the same character count are not the same type. Mixing
   * them would move UTF-16 bytes into a field that reads them as EBCDIC.
   */
  national?: boolean;
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
  | EditedType
  | DecimalType
  | StringType
  | BoolType
  | TemporalType
  | RecordType
  | CurrencyType
  | EnumType
  | NullableType
  | ArrayType;

/**
 * `date`, `time`, or `timestamp`.
 *
 * A date is nominally typed: it may be compared with another date but not with
 * an amount, and not with a plain integer that happens to have eight digits.
 * The storage is the mainframe convention — `PIC 9(8)` as YYYYMMDD — precisely
 * so that comparison and sorting are the ordinary numeric ones.
 */
/**
 * `edited<T, "style">` — a rendering of a number, not a number.
 *
 * It carries the precision and scale of what it renders so the picture can be
 * generated. Assignment from the inner type is the formatting step, which is
 * what a COBOL `MOVE` into a numeric-edited item does.
 */
export interface EditedType {
  kind: "edited";
  style: EditStyle;
  precision: number;
  scale: number;
  /** What it renders, for the message when something else is assigned. */
  source: string;
}

export interface TemporalType {
  kind: "temporal";
  unit: "date" | "time" | "timestamp";
}

export interface ResolvedEnum {
  name: string;
  span: SourceSpan;
  members: string[];
}

export interface ResolvedField {
  name: string;
  span: SourceSpan;
  type: ResolvedType;
  /** The field whose storage this one re-reads, for a variant record. */
  redefines: string | null;
  /** The field holding how much of this table the record uses. */
  dependingOn: string | null;
  /** `ASCENDING KEY` — the field the table is ordered by, for a binary search. */
  ascendingKey: string | null;
  /** True when the field is aligned on its natural boundary. */
  synchronized: boolean;
  /** `JUSTIFIED RIGHT` — right-align an alphanumeric value in the field. */
  justified: boolean;
  /** `BLANK WHEN ZERO` — print spaces rather than zeros. */
  blankWhenZero: boolean;
  /** `VALUE` — the compile-time literal the field starts as, as COBOL spells it. */
  initialValue: string | null;
  /**
   * `RENAMES` — the run of fields this one is a second name for.
   *
   * It is a field so that `legacy.wholeDate` resolves like any other, and it
   * carries no storage: the emitters skip it in the record's own entries and
   * write it as a level-66 after them.
   */
  renames: { from: string; to: string } | null;
  /** Restricted data: it must not reach an audit event or the ledger journal. */
  sensitive: boolean;
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
  /** `nested function` — a COBOL contained program rather than a paragraph. */
  isNested: boolean;
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
  /** The `on failure` block, if the transaction declares one. */
  failureHandler: BlockNode | null;
  /** True for the transaction the generated program starts at. */
  isEntry: boolean;
  isCics: boolean;
}

/** A DECLARATIVES handler, resolved against the file it covers. */
export interface ResolvedFileErrorHandler {
  fileName: string;
  span: SourceSpan;
  body: BlockNode;
}

export interface ResolvedFileLinage {
  lines: number;
  footingAt: number | null;
  linesAtTop: number | null;
  linesAtBottom: number | null;
}

export interface ResolvedFile {
  name: string;
  span: SourceSpan;
  organization: FileOrganization;
  keyField: ResolvedField | null;
  /** Alternate record keys, which allow duplicates. */
  alternateKeys: ResolvedField[];
  /** `LINAGE` — page depth, for a print file that paginates. */
  linage: ResolvedFileLinage | null;
  mode: "input" | "output" | "update";
  record: ResolvedRecord;
  statusName: string | null;
  /** `RECORD IS VARYING` — the bounds, and the field holding the used length. */
  recordVarying: { min: number; max: number; lengthName: string } | null;
}

/**
 * A `report` declaration, resolved against the file it is written to.
 *
 * The file's record is the report's source of values: every field a column
 * names has to be one of its fields, because that record is what the program
 * fills before it generates a detail.
 */
/** A `database` declaration, resolved against the record its segment holds. */
export interface ResolvedDatabase {
  name: string;
  span: SourceSpan;
  segmentName: string;
  keyName: string;
  record: ResolvedRecord;
  statusName: string | null;
}

/** A `queue` declaration, resolved against the record its message holds. */
export interface ResolvedQueue {
  name: string;
  span: SourceSpan;
  managerName: string;
  queueName: string;
  direction: "input" | "output";
  record: ResolvedRecord;
  statusName: string | null;
}

export interface ResolvedReport {
  name: string;
  span: SourceSpan;
  file: ResolvedFile;
  controls: string[];
  page: ReportPageNode | null;
  groups: ReportGroupNode[];
  /** Detail group names, which is what `generate` may name. */
  detailNames: string[];
}

export interface ResolvedSql {
  name: string;
  span: SourceSpan;
  parameters: ResolvedParameter[];
  result: ResolvedRecord | null;
  /** `statement` is run with `execute`; `cursor` is read with a bounded loop. */
  form: "statement" | "cursor";
  text: string;
  /**
   * A cursor's SELECT with its `INTO` clause removed, and that clause on its
   * own. `DECLARE CURSOR` may not carry an `INTO` — Db2 puts the row's
   * destination on the `FETCH`, which is where the row actually arrives.
   * Writing it on the SELECT is how the query reads, so the author writes it
   * there and the compiler moves it to the statement that needs it.
   *
   * Null for a plain statement, whose `INTO` stays where it was written.
   */
  cursorSelect: string | null;
  cursorInto: string | null;
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
  /** `report` declarations, which become the REPORT SECTION. */
  reports: ResolvedReport[];
  /** `database` declarations, which become PCBs and DL/I calls. */
  databases: ResolvedDatabase[];
  queues: ResolvedQueue[];
  /** `on error <file>` handlers, which become DECLARATIVES. */
  fileErrorHandlers: ResolvedFileErrorHandler[];
  enums: ResolvedEnum[];
  sql: ResolvedSql[];
  /**
   * The concrete function a generic call resolves to, keyed by the call node.
   *
   * Lowering reads this instead of the written callee, because a generic call
   * names a template that no COBOL paragraph corresponds to.
   */
  callTargets: ReadonlyMap<CallExpressionNode, string>;
  /** Base record name for each record declared with `extends`. */
  recordBases: ReadonlyMap<string, string>;
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
      reports: [],
      databases: [],
      queues: [],
      fileErrorHandlers: [],
      enums: [],
      sql: [],
      callTargets: new Map(),
      recordBases: new Map(),
    };
  }

  const diagnostics: Diagnostic[] = [];
  const aliases: Record<string, ResolvedType> = {};
  const records: ResolvedRecord[] = [];
  recordSink = records;
  const recordMap = new Map<string, ResolvedRecord>();
  const functions: ResolvedFunction[] = [];
  const transactions: ResolvedTransaction[] = [];
  const files: ResolvedFile[] = [];
  const reports: ResolvedReport[] = [];
  const databases: ResolvedDatabase[] = [];
  const queues: ResolvedQueue[] = [];
  const fileErrorHandlers: ResolvedFileErrorHandler[] = [];
  const enums: ResolvedEnum[] = [];
  const sqlStatements: ResolvedSql[] = [];

  // Resolve record and alias declarations first so function signatures can
  // reference them, then collect signatures so a function may call one
  // declared later in the file.
  functionSignatures = new Map();
  declaredFiles = new Map();
  enumMap = new Map();
  sqlMap = new Map();
  genericRecords = new Map();
  genericFunctions = new Map();
  pendingInstantiations = new Map();
  instantiatedFunctions = new Set();
  callTargets = new Map();
  recordBases = new Map();

  // Pass 0: index the generic declarations. They are templates, not types, so
  // they are never resolved directly — only their instantiations are.
  for (const declaration of program.declarations) {
    if (
      declaration.kind === "RecordDeclaration" &&
      declaration.typeParameters.length > 0
    ) {
      genericRecords.set(declaration.name, declaration);
    }
    if (
      declaration.kind === "FunctionDeclaration" &&
      declaration.typeParameters.length > 0
    ) {
      genericFunctions.set(declaration.name, declaration);
    }
  }

  // Records may extend a record declared further down the file, so bases are
  // resolved on demand from this index rather than in declaration order.
  const recordDeclarations = new Map<string, RecordDeclarationNode>();
  for (const declaration of program.declarations) {
    if (
      declaration.kind === "RecordDeclaration" &&
      declaration.typeParameters.length === 0
    ) {
      recordDeclarations.set(declaration.name, declaration);
    }
  }
  pendingRecordDeclarations = recordDeclarations;

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

    if (
      declaration.kind === "RecordDeclaration" &&
      declaration.typeParameters.length === 0
    ) {
      ensureRecordResolved(
        declaration.name,
        aliases,
        recordMap,
        diagnostics,
        declaration.span,
        [],
      );
    }
  }

  // Pass 2: files and function signatures, so a body can call a function
  // declared later in the file and reference any declared file.
  for (const declaration of program.declarations) {
    if (declaration.kind === "FunctionDeclaration") {
      if (declaration.typeParameters.length > 0) {
        // A generic function has no single signature. Its instantiations are
        // registered when a call site fixes the type arguments.
        continue;
      }
      registerFunctionSignature(declaration, aliases, recordMap);
      continue;
    }

    if (declaration.kind === "FileErrorHandler") {
      fileErrorHandlers.push({
        fileName: declaration.fileName,
        span: declaration.span,
        body: declaration.body,
      });
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

  declaredDatabases = new Map();
  for (const declaration of program.declarations) {
    if (declaration.kind !== "DatabaseDeclaration") {
      continue;
    }
    const resolved = resolveDatabase(declaration, recordMap, diagnostics);
    if (resolved) {
      databases.push(resolved);
      declaredDatabases.set(resolved.name, resolved);
    }
  }

  declaredQueues = new Map();
  for (const declaration of program.declarations) {
    if (declaration.kind !== "QueueDeclaration") {
      continue;
    }
    const resolved = resolveQueue(declaration, recordMap, diagnostics);
    if (resolved) {
      queues.push(resolved);
      declaredQueues.set(resolved.name, resolved);
    }
  }

  // Pass 2b: reports, which resolve against files and so come after them.
  declaredReports = new Map();
  for (const declaration of program.declarations) {
    if (declaration.kind !== "ReportDeclaration") {
      continue;
    }
    const resolvedReport = resolveReport(declaration, diagnostics);
    if (resolvedReport) {
      reports.push(resolvedReport);
      declaredReports.set(resolvedReport.name, resolvedReport);
    }
  }

  // Pass 3: bodies.
  for (const declaration of program.declarations) {
    if (declaration.kind === "FunctionDeclaration") {
      if (declaration.typeParameters.length > 0) {
        continue;
      }
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

  // Pass 4: the instantiations those bodies asked for.
  //
  // Checking an instantiated body can request further instantiations, so this
  // runs to a fixpoint rather than once over a fixed list. Draining a worklist
  // here rather than recursing from the call site keeps the resolver's own
  // per-body state (loop depth, nullable guards, CICS context) intact.
  drainInstantiations(aliases, recordMap, functions, diagnostics);

  reportUnusedGenerics(program, diagnostics);
  reportUnheldDliUpdates(program, diagnostics);
  reportUnreadFileUpdates(program, diagnostics);
  reportRecursiveNestedFunctions(program, diagnostics);
  validateFileErrorHandlers(fileErrorHandlers, aliases, recordMap, diagnostics);

  checkSingleEntryPoint(transactions, diagnostics);
  checkCopybookMemberNames(records, diagnostics);
  checkDdNames(files, diagnostics);

  return {
    program,
    diagnostics,
    aliases,
    records,
    functions,
    transactions,
    files,
    reports,
    databases,
    queues,
    fileErrorHandlers,
    enums,
    sql: sqlStatements,
    callTargets,
    recordBases,
  };
}

/**
 * Resolves every function instantiation a body asked for, including any the
 * instantiated bodies themselves request.
 */
function drainInstantiations(
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  functions: ResolvedFunction[],
  diagnostics: Diagnostic[],
): void {
  // A generic that instantiates itself at a new type would expand forever, so
  // the depth is capped and reported rather than left to exhaust memory.
  const limit = 200;
  let expanded = 0;

  while (pendingInstantiations.size > 0) {
    const [name, request] = pendingInstantiations.entries().next().value as [
      string,
      InstantiationRequest,
    ];
    pendingInstantiations.delete(name);

    expanded += 1;
    if (expanded > limit) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-014",
          severity: "error",
          message: `Generic expansion did not terminate after ${limit} instantiations, starting at ${name}.`,
          span: request.span,
          hint: "A generic function that calls itself at a new type argument expands forever. Fix the recursion so the type arguments stop changing.",
          backendProfile: null,
        }),
      );
      pendingInstantiations.clear();
      return;
    }

    const resolved = resolveFunction(
      request.declaration,
      aliases,
      recordMap,
      diagnostics,
    );
    if (resolved) {
      functions.push(resolved);
    }
  }
}

/**
 * A program has at most one entry transaction.
 *
 * COBOL starts at the first statement of the PROCEDURE DIVISION and has no way
 * to choose between two starting points, so a second `entry` would silently
 * never run.
 */
function checkSingleEntryPoint(
  transactions: ResolvedTransaction[],
  diagnostics: Diagnostic[],
): void {
  const entries = transactions.filter((transaction) => transaction.isEntry);
  for (const extra of entries.slice(1)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TXN-010",
        severity: "error",
        message: `${extra.name} is a second entry transaction; ${entries[0].name} is already the entry point.`,
        span: extra.span,
        hint: "A program starts in one place. Drop `entry` from all but one transaction.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }
}

/**
 * Reports a generic declaration that is never instantiated.
 *
 * Monomorphisation means an uninstantiated generic contributes no COBOL at all.
 * Staying silent would let a template with a type error ship unnoticed.
 */
/**
 * Reports a `nested function` that can reach itself.
 *
 * COBOL forbids `LOCAL-STORAGE` in a contained program, so a nested function's
 * locals sit in `WORKING-STORAGE` — one copy, shared by every invocation. A
 * recursive one would therefore overwrite its own locals on the way down and
 * read the innermost call's values on the way back out: it compiles, it runs,
 * and it returns the wrong number. An ordinary recursive function is emitted as
 * a sibling program with `LOCAL-STORAGE`, which is what makes recursion safe.
 */
function reportRecursiveNestedFunctions(
  program: ProgramNode,
  diagnostics: Diagnostic[],
): void {
  const declarations = program.declarations.filter(
    (declaration): declaration is FunctionDeclarationNode =>
      declaration.kind === "FunctionDeclaration",
  );
  const callees = new Map<string, Set<string>>(
    declarations.map((declaration) => [
      declaration.name,
      collectCalledNames(declaration.body),
    ]),
  );

  for (const declaration of declarations) {
    if (!declaration.isNested) {
      continue;
    }
    const seen = new Set<string>();
    const stack = [...(callees.get(declaration.name) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (next === declaration.name) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-027",
            severity: "error",
            message: `Nested function ${declaration.name} can reach itself.`,
            span: declaration.span,
            hint: "A contained COBOL program cannot have LOCAL-STORAGE, so its locals are one copy shared by every invocation and a recursive call would overwrite them. Drop `nested`: an ordinary recursive function is emitted as a sibling program, which is what makes recursion safe.",
            backendProfile: "ibm-enterprise-cobol-zos",
          }),
        );
        break;
      }
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      stack.push(...(callees.get(next) ?? []));
    }
  }
}

/** Every function name a block calls, however deeply nested. */
function collectCalledNames(block: BlockNode): Set<string> {
  const called = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const node = value as { kind?: string; callee?: string };
    if (node.kind === "CallExpression" && typeof node.callee === "string") {
      called.add(node.callee);
    }
    for (const [key, child] of Object.entries(value)) {
      // A span is position data, not structure, and walking it finds nothing.
      if (key !== "span") {
        walk(child);
      }
    }
  };

  walk(block.statements);
  return called;
}

function reportUnusedGenerics(
  program: ProgramNode,
  diagnostics: Diagnostic[],
): void {
  for (const declaration of program.declarations) {
    if (
      declaration.kind === "FunctionDeclaration" &&
      declaration.typeParameters.length > 0 &&
      !instantiatedFunctions.has(declaration.name)
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-015",
          severity: "warning",
          message: `Generic function ${declaration.name} is never called, so no COBOL is generated for it.`,
          span: declaration.span,
          hint: "Call it, or remove it. A generic is a template: an uninstantiated one is never type checked against real types.",
          backendProfile: null,
        }),
      );
    }
  }
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

  const cursor =
    declaration.form === "cursor"
      ? resolveCursorText(declaration, result, diagnostics)
      : { select: null, into: null };

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    result,
    form: declaration.form,
    text: declaration.text,
    cursorSelect: cursor.select,
    cursorInto: cursor.into,
    hostVariables,
  };
}

/**
 * Splits a cursor's SELECT from the `INTO` clause that names where a row lands.
 *
 * A cursor with nowhere to put a row is not a cursor anyone can read, so both
 * halves of that binding — a result record and an `INTO` — are required rather
 * than defaulted. Defaulting would mean binding the SELECT list to the record's
 * fields positionally, and this compiler does not parse SQL well enough to know
 * whether that lines up.
 */
function resolveCursorText(
  declaration: SqlDeclarationNode,
  result: ResolvedRecord | null,
  diagnostics: Diagnostic[],
): { select: string | null; into: string | null } {
  if (!result) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-006",
        severity: "error",
        message: `Cursor ${declaration.name} declares no result record.`,
        span: declaration.span,
        hint: `Write \`cursor ${declaration.name}(...): <Record> { ... }\`.`,
        backendProfile: null,
      }),
    );
    return { select: null, into: null };
  }

  const match = /\bINTO\b([\s\S]*?)\bFROM\b/i.exec(declaration.text);
  if (!match) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-006",
        severity: "error",
        message: `Cursor ${declaration.name} has no INTO clause, so a fetched row has nowhere to go.`,
        span: declaration.span,
        hint: `Write \`INTO :${result.fields[0]?.name ?? "field"}, ...\` between the select list and FROM.`,
        backendProfile: null,
      }),
    );
    return { select: null, into: null };
  }

  return {
    select:
      `${declaration.text.slice(0, match.index)}FROM${declaration.text.slice(
        match.index + match[0].length,
      )}`.trim(),
    into: match[1].trim(),
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

  // An alternate key is a second way into the same record, so it names a field
  // of that record like the primary does. Unlike the primary it allows
  // duplicates, which is usually the reason it exists.
  const alternateKeys: ResolvedField[] = [];
  for (const name of declaration.alternateKeys) {
    const field = record?.fields.find((entry) => entry.name === name);
    if (!field) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-004",
          severity: "error",
          message: `Record ${record?.name ?? declaration.recordTypeName} has no field named ${name} to use as an alternate key.`,
          span: declaration.span,
          hint: "An alternate key is a field of the record the file holds.",
          backendProfile: null,
        }),
      );
      continue;
    }
    if (declaration.organization !== "indexed") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-004",
          severity: "error",
          message: `Only an indexed file has alternate keys, but ${declaration.name} is ${declaration.organization}.`,
          span: declaration.span,
          hint: "Declare the file as indexed.",
          backendProfile: null,
        }),
      );
      break;
    }
    alternateKeys.push(field);
  }

  // A page depth is what makes a report paginate, so it belongs to a file the
  // program writes sequentially. COBOL allows LINAGE only there.
  const linage = declaration.linage;
  if (linage) {
    if (
      declaration.organization !== "sequential" ||
      declaration.mode !== "output"
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-007",
          severity: "error",
          message: `A page depth describes a print file, and ${declaration.name} is ${declaration.organization} ${declaration.mode}.`,
          span: linage.span,
          hint: "Declare the report as `sequential output`.",
          backendProfile: null,
        }),
      );
    }
    if (linage.lines < 1) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-007",
          severity: "error",
          message: "A page has to have at least one line on it.",
          span: linage.span,
          hint: "Write `page 60`, the depth of the page body.",
          backendProfile: null,
        }),
      );
    }
    // The footing is where END-OF-PAGE is signalled, so it has to be a line
    // that exists — past the end it would never be reached.
    if (
      linage.footingAt !== null &&
      (linage.footingAt < 1 || linage.footingAt > linage.lines)
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-007",
          severity: "error",
          message: `The footing is at line ${linage.footingAt} of a ${linage.lines}-line page.`,
          span: linage.span,
          hint: "Put the footing on a line the page has, so end of page is reached.",
          backendProfile: null,
        }),
      );
    }
  }

  return {
    name: declaration.name,
    span: declaration.span,
    organization: declaration.organization,
    keyField,
    alternateKeys,
    mode: declaration.mode,
    record,
    statusName: declaration.statusName,
    recordVarying: validateRecordVarying(declaration, recordMap, diagnostics),
    linage: linage
      ? {
          lines: linage.lines,
          footingAt: linage.footingAt,
          linesAtTop: linage.linesAtTop,
          linesAtBottom: linage.linesAtBottom,
        }
      : null,
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

  // A transaction is a program entry point, so its record parameters live in
  // working storage — one COBOL group per record *type*. Two parameters of the
  // same type would therefore be two names for one piece of storage: writing
  // through either would be visible through the other, silently. A function is
  // different: its record parameters are LINKAGE cells the caller rebinds, so
  // each one addresses its own argument.
  const recordParameters = new Map<string, string>();
  for (const parameter of parameters) {
    if (parameter.type.kind !== "record") {
      continue;
    }
    const earlier = recordParameters.get(parameter.type.name);
    if (earlier) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-022",
          severity: "error",
          message: `${parameter.name} and ${earlier} both hold ${parameter.type.name}, so they would be one piece of storage.`,
          span: parameter.span,
          hint: "A transaction's records live in working storage, one group per record type. Declare a second record type, or pass one parameter and fill it twice.",
          backendProfile: null,
        }),
      );
      continue;
    }
    recordParameters.set(parameter.type.name, parameter.name);
  }

  declareFileStatusSymbols(scope);

  // CICS response variables are compiler-owned storage, like file statuses.
  currentTransactionIsCics = declaration.isCics;
  cicsRespCaptured = new Set();
  declareCicsRespSymbols(declaration.body, scope);

  sqlExecuted = false;
  sqlCodeTested = false;
  sqlCodeFailureTested = false;
  sensitiveLocals = new Set();
  checkpointSeen = false;
  validateTransactionBody(
    declaration.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );

  // The handler shares the transaction's scope, so it can report on the same
  // records the body was working with. It runs after the body has abandoned its
  // work, which is exactly when those values matter.
  if (declaration.failureHandler) {
    validateFailureHandler(
      declaration.failureHandler,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
    );
  }

  checkSqlCodeHandled(declaration.span, diagnostics);

  return {
    name: declaration.name,
    span: declaration.span,
    parameters,
    locals,
    body: declaration.body,
    failureHandler: declaration.failureHandler?.body ?? null,
    isEntry: declaration.isEntry,
    isCics: declaration.isCics,
  };
}

/**
 * Checks an `on failure` block.
 *
 * A handler may not raise: there would be nothing left to catch it, and a
 * failure path that can itself fail is how a transaction ends up half-posted
 * with no record of why.
 */
function validateFailureHandler(
  handler: FailureHandlerNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
): void {
  const raised = findRaiseStatement(handler.body);
  if (raised) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TXN-009",
        severity: "error",
        message: "An `on failure` handler cannot raise.",
        span: raised.span,
        hint: "The handler is the last line of defence; there is no outer handler to catch it. Record the failure and return.",
        backendProfile: null,
      }),
    );
  }

  validateTransactionBody(
    handler.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
}

/** Finds the first raise anywhere inside a block, including nested blocks. */
function findRaiseStatement(block: BlockNode): RaiseStatementNode | null {
  for (const statement of block.statements) {
    switch (statement.kind) {
      case "RaiseStatement":
        return statement;
      case "IfStatement": {
        const found =
          findRaiseStatement(statement.thenBranch) ??
          (statement.elseBranch
            ? findRaiseStatement(statement.elseBranch)
            : null);
        if (found) {
          return found;
        }
        break;
      }
      case "WhileStatement":
      case "ForEachStatement":
      case "CursorLoopStatement":
      case "SearchStatement": {
        const found = findRaiseStatement(statement.body);
        if (found) {
          return found;
        }
        break;
      }
      case "SwitchStatement": {
        for (const entry of statement.cases) {
          const found = findRaiseStatement(entry.body);
          if (found) {
            return found;
          }
        }
        if (statement.otherwise) {
          const found = findRaiseStatement(statement.otherwise);
          if (found) {
            return found;
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** Widest failure code the generated `BANK-FAILURE-CODE` field can hold. */
const FAILURE_CODE_LENGTH = 32;

/**
 * Checks a raise statement.
 *
 * The code has to survive into the generated COBOL literal, so it is bounded to
 * the width of the failure field. Truncating it silently would mean the handler
 * compared against a code that no longer matched what the source said.
 */
function validateRaiseStatement(
  statement: RaiseStatementNode,
  diagnostics: Diagnostic[],
): void {
  if (statement.code.trim().length === 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TXN-008",
        severity: "error",
        message: "A failure code cannot be empty.",
        span: statement.codeSpan,
        hint: 'Name the failure, such as `raise "INSUFFICIENT_FUNDS";`.',
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.code.length > FAILURE_CODE_LENGTH) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TXN-008",
        severity: "error",
        message: `Failure code ${statement.code} is ${statement.code.length} characters; the limit is ${FAILURE_CODE_LENGTH}.`,
        span: statement.codeSpan,
        hint: `BANK-FAILURE-CODE is PIC X(${FAILURE_CODE_LENGTH}), and a truncated code would not match the handler that tests it.`,
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }
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
      case "CursorLoopStatement":
      case "UnitOfWorkStatement":
      case "ReturnCodeStatement":
      case "SplitStatement":
      case "SerializeStatement":
      case "XmlParseStatement":
      case "ReportStatement":
      case "ProgramCallStatement":
      case "DliStatement":
      case "QueueStatement":
      case "SortStatement":
      case "ReleaseStatement":
      case "CheckpointStatement":
      case "RestartStatement":
      case "ConsoleStatement":
      case "ResetStatement":
      case "SearchStatement":
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
      case "RaiseStatement":
        validateRaiseStatement(statement, diagnostics);
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
    case "UnitOfWorkStatement":
      validateUnitOfWorkStatement(statement, diagnostics);
      return true;
    case "SplitStatement":
      validateSplitStatement(statement, scope, aliases, recordMap, diagnostics);
      return true;
    case "ReportStatement":
      validateReportStatement(statement, diagnostics);
      return true;
    case "DliStatement":
      validateDliStatement(statement, scope, aliases, recordMap, diagnostics);
      return true;
    case "QueueStatement":
      validateQueueStatement(statement, scope, diagnostics);
      if (statement.body) {
        validateTransactionBody(
          statement.body,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
      }
      if (statement.notFound) {
        validateTransactionBody(
          statement.notFound,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
      }
      return true;
    case "ProgramCallStatement":
      validateProgramCallStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (statement.onError) {
        validateTransactionBody(
          statement.onError,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
      }
      return true;
    case "XmlParseStatement":
      validateXmlParseStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (statement.onError) {
        validateTransactionBody(
          statement.onError,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
      }
      return true;
    case "SerializeStatement":
      validateSerializeStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (statement.onError) {
        // The handler is ordinary code, so the banking checks have to see into
        // it the same way they see into an end-of-page body.
        validateTransactionBody(
          statement.onError,
          scope,
          aliases,
          recordMap,
          locals,
          diagnostics,
        );
      }
      return true;
    case "SortStatement":
      validateSortStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    case "ReleaseStatement":
      validateReleaseStatement(statement, diagnostics);
      return true;
    case "ConsoleStatement":
      validateConsoleStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      return true;
    case "ResetStatement":
      if (scope.get(statement.recordName)?.kind !== "record") {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `reset clears a record, and ${statement.recordName} is not one.`,
            span: statement.span,
            hint: "Reset a record-typed parameter or local.",
            backendProfile: null,
          }),
        );
      }
      return true;
    case "CheckpointStatement":
      validateCheckpointStatement(statement, scope, diagnostics);
      checkpointSeen = true;
      return true;
    case "RestartStatement":
      validateRestartStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    case "SearchStatement":
      validateSearchStatement(
        statement,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
      return true;
    case "ReturnCodeStatement":
      validateReturnCodeStatement(
        statement,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      return true;
    case "CursorLoopStatement":
      validateCursorLoopStatement(
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

  // `returnTransid` ends the task, so there is no response to come back to.
  // Every other command has one, and an outcome nobody looks at is the defect
  // BANK-CICS-001 exists for.
  if (statement.operation !== "returnTransid" && !statement.respName) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-CICS-001",
        severity: "error",
        message: `The response code of ${statement.operation}${statement.program ? ` "${statement.program}"` : ""} is not captured.`,
        span: statement.span,
        hint: "Add `resp <status>` and test the status.",
        backendProfile: null,
      }),
    );
  }

  // A file command reaches a KSDS, which is addressed by key.
  if (
    (statement.operation === "readFile" ||
      statement.operation === "writeFile") &&
    !statement.key
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-CICS-002",
        severity: "error",
        message: `A ${statement.operation} command needs the record key it addresses.`,
        span: statement.span,
        hint: `Write \`${statement.operation} "FILE" into <record> key <value> resp <status>;\`.`,
        backendProfile: null,
      }),
    );
  }

  {
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

  // A syncpoint inside a loop commits partial work on each pass. A file or
  // queue command inside one is ordinary work, not a commit boundary.
  if (
    (statement.operation === "syncpoint" ||
      statement.operation === "rollback") &&
    inLoopBody
  ) {
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

  // A cursor returns a stream. `execute` would fetch nothing at all, because
  // the row arrives on a FETCH the compiler only generates inside a loop.
  if (declared.form === "cursor") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-005",
        severity: "error",
        message: `${statement.name} is a cursor, so it is read row by row rather than executed once.`,
        span: statement.span,
        hint: `Write \`for each <row> in ${statement.name}(...) limit <n> { ... }\`.`,
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

/**
 * `for each <row> in <cursor>(args) limit <n> { ... }`
 *
 * The generated loop tests SQLCODE itself to decide when the rows have run out,
 * so a cursor loop does not put the body under `BANK-SQL-001`. An `execute` in
 * the body still does: that outcome is the author's to interpret.
 */
/**
 * `commit;` and `rollback;`.
 *
 * Inside a CICS transaction, CICS owns the syncpoint and commits Db2's work
 * along with everything else, so an `EXEC SQL COMMIT` is not merely redundant —
 * Db2 rejects it at run time. That is exactly the ambiguity `BANK-SQL-004` was
 * reserved for.
 */
/**
 * `returnCode = <n>;`
 *
 * The value lands in COBOL's `RETURN-CODE`, a halfword, and reaches the job as
 * the step's condition code. A value outside 0–4095 is not a condition code any
 * `COND=` can test.
 */
/**
 * `split source by "," into a, b, c;`
 *
 * Every receiver has to be a string the compiler can name a length for, because
 * `UNSTRING` writes into fixed fields.
 */
/**
 * `sort <inputs> into <output> on <keys>;`
 *
 * Every file named has to exist and be usable in the direction the statement
 * needs it, and every key has to be a field of the record being sorted — a key
 * that is not in the record sorts on nothing.
 */
/** True when the body being checked writes a restart point. */
let checkpointSeen = false;

/**
 * The record a `release` may name, or null outside a sort input procedure.
 *
 * `RELEASE` hands a record to a sort that is running, so it means nothing
 * anywhere else — COBOL rejects it outright.
 */
let sortInputRecord: string | null = null;

/** Every block a statement encloses, for walks that do not care which is which. */
function nestedBlocksOf(statement: StatementNode): BlockNode[] {
  const candidates = [
    (statement as { body?: BlockNode }).body,
    (statement as { thenBranch?: BlockNode }).thenBranch,
    (statement as { elseBranch?: BlockNode | null }).elseBranch,
    (statement as { notFound?: BlockNode }).notFound,
    (statement as { resumed?: BlockNode }).resumed,
    (statement as { fresh?: BlockNode | null }).fresh,
  ];
  const cases = (statement as { cases?: { body: BlockNode }[] }).cases ?? [];
  return [...candidates, ...cases.map((entry) => entry.body)].filter(
    (block): block is BlockNode => Boolean(block),
  );
}

/**
 * `checkpoint <file> from <record> every <n>;`
 *
 * The file has to be one the program can write, because that is where the
 * position is recorded, and the interval has to be a positive whole number of
 * records: too small costs throughput, too large costs rework, and zero is
 * neither.
 */
/**
 * `log` and `accept`.
 *
 * A restricted value must not be written to the job log for the same reason it
 * must not reach an audit event: the log outlives the run and is read widely.
 */
/**
 * `on error <file> { ... }`
 *
 * The handler runs when an I/O operation on that file fails, whatever the
 * operation and wherever it was written, so it needs a file that exists and at
 * most one handler for it — COBOL allows a file in only one `USE` procedure.
 */
function validateFileErrorHandlers(
  handlers: ResolvedFileErrorHandler[],
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();

  for (const handler of handlers) {
    const file = declaredFiles.get(handler.fileName);
    if (!file) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `Unresolved file: ${handler.fileName}.`,
          span: handler.span,
          hint: "Declare the file before handling its errors.",
          backendProfile: null,
        }),
      );
      continue;
    }

    if (seen.has(handler.fileName)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-005",
          severity: "error",
          message: `${handler.fileName} already has an error handler.`,
          span: handler.span,
          hint: "COBOL allows a file in one USE procedure, so put every case in the one handler.",
          backendProfile: null,
        }),
      );
      continue;
    }
    seen.add(handler.fileName);

    // The handler runs outside any transaction, so it sees the file's status
    // and nothing else: there is no record in scope and no ledger to post to.
    const scope = new Map<string, ResolvedType>();
    declareFileStatusSymbols(scope);
    const locals: ResolvedLocal[] = [];
    validateBranchBody(
      handler.body,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
      false,
    );
  }
}

function validateConsoleStatement(
  statement: ConsoleStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  for (const value of statement.values) {
    checkNotSensitive(value, scope, "the job log", diagnostics);
    inferExpressionType(value, scope, aliases, recordMap, diagnostics);
  }

  if (!statement.target) {
    return;
  }

  const target = inferExpressionType(
    statement.target,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  // `accept date` and `accept time` deliver the clock; `accept parameter`
  // delivers whatever the job passed, which is text.
  const expected =
    statement.source === "date"
      ? "date"
      : statement.source === "time"
        ? "time"
        : "string";
  const actual =
    target?.kind === "temporal" ? target.unit : (target?.kind ?? null);

  if (actual && actual !== expected) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `accept ${statement.source} delivers ${expected}, but the target is ${describeType(target as ResolvedType)}.`,
        span: statement.span,
        hint:
          statement.source === "parameter"
            ? "A job parameter arrives as text; parse it afterwards."
            : "Accept the clock into a date or a time.",
        backendProfile: null,
      }),
    );
  }
}

function validateCheckpointStatement(
  statement: CheckpointStatementNode,
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
        hint: "Declare the file the restart position is written to.",
        backendProfile: null,
      }),
    );
  } else {
    validateRestartFile(file, statement.span, "write", diagnostics);
  }

  if (!scope.has(statement.recordName)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved record: ${statement.recordName}.`,
        span: statement.span,
        hint: "Pass a record-typed parameter holding the restart position.",
        backendProfile: null,
      }),
    );
  }

  if (!Number.isInteger(statement.every) || statement.every <= 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-003",
        severity: "error",
        message:
          "A checkpoint interval must be a positive whole number of records.",
        span: statement.everySpan,
        hint: "Write `every 1000`.",
        backendProfile: null,
      }),
    );
  }
}

/**
 * The shape a restart file has to have, for both halves of checkpoint/restart.
 *
 * Keyed and opened for update, because the position has to survive being read
 * back. A sequential output file is rewritten from the start by the next OPEN,
 * so a rerun that dies before its own first checkpoint destroys the position it
 * was resuming from and the run after that starts from the beginning — which is
 * the failure the whole mechanism exists to prevent. A single keyed record,
 * rewritten in place, has no such window.
 */
function validateRestartFile(
  file: ResolvedFile,
  span: SourceSpan,
  direction: "read" | "write",
  diagnostics: Diagnostic[],
): void {
  const wrong =
    file.organization !== "indexed"
      ? `${file.name} is ${file.organization}, and a restart position has to be keyed.`
      : file.mode !== "update"
        ? `${file.name} is declared as ${file.mode}, and a restart position has to be readable and writable in the same run.`
        : null;

  if (wrong) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-003",
        severity: "error",
        message:
          direction === "write"
            ? `Cannot write a restart position to ${file.name}. ${wrong}`
            : `Cannot read a restart position from ${file.name}. ${wrong}`,
        span,
        hint: `Declare it \`file ${file.name} indexed update record <Record> key <field> status <field>;\`.`,
        backendProfile: null,
      }),
    );
  }
}

/**
 * `restart <file> into <record> { ... } else { ... }`
 *
 * A checkpoint that nothing reads back is a rerun that still starts at the
 * beginning, so this is the statement that makes the other one mean something.
 * The record has to be the one the file holds, because the position read out of
 * the file is moved into it field by field.
 */
function validateRestartStatement(
  statement: RestartStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const file = declaredFiles.get(statement.fileName);
  if (!file) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved file: ${statement.fileName}.`,
        span: statement.span,
        hint: "Declare the file the restart position was written to.",
        backendProfile: null,
      }),
    );
  } else {
    validateRestartFile(file, statement.span, "read", diagnostics);
  }

  const bound = scope.get(statement.recordName);
  if (bound?.kind !== "record") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved record: ${statement.recordName}.`,
        span: statement.span,
        hint: "Name a record-typed parameter or local to read the position into.",
        backendProfile: null,
      }),
    );
  } else if (file && bound.name !== file.record.name) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-003",
        severity: "error",
        message: `${statement.recordName} holds ${bound.name}, and ${file.name} holds ${file.record.name}.`,
        span: statement.span,
        hint: `Read the position into a variable declared as ${file.record.name}.`,
        backendProfile: null,
      }),
    );
  }

  for (const block of [statement.resumed, statement.fresh]) {
    if (block) {
      validateBranchBody(
        block,
        scope,
        aliases,
        recordMap,
        locals,
        diagnostics,
        inTransaction,
      );
    }
  }
}

function validateSortStatement(
  statement: SortStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const reject = (message: string, hint: string): void => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-005",
        severity: "error",
        message,
        span: statement.span,
        hint,
        backendProfile: null,
      }),
    );
  };

  if (statement.operation === "merge" && statement.inputs.length < 2) {
    reject(
      "A merge combines two or more already-sorted inputs.",
      "Use `sort` for a single input, or name the other files.",
    );
  }

  const output = declaredFiles.get(statement.output);
  if (!output) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved file: ${statement.output}.`,
        span: statement.span,
        hint: "Declare the output file before sorting into it.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (output.mode === "input") {
    reject(
      `Cannot sort into ${output.name}, which is declared as input.`,
      "Declare the destination as output.",
    );
  }

  for (const name of statement.inputs) {
    const input = declaredFiles.get(name);
    if (!input) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `Unresolved file: ${name}.`,
          span: statement.span,
          hint: "Declare every file the sort reads.",
          backendProfile: null,
        }),
      );
      continue;
    }
    if (input.mode === "output") {
      reject(
        `Cannot sort from ${input.name}, which is declared as output.`,
        "Declare the source as input.",
      );
    }
    // The sort moves whole records, so every file has to hold the same one.
    if (input.record.name !== output.record.name) {
      reject(
        `${input.name} holds ${input.record.name} but ${output.name} holds ${output.record.name}.`,
        "A sort moves whole records, so every file it touches holds the same record.",
      );
    }
  }

  for (const key of statement.keys) {
    if (!output.record.fields.some((field) => field.name === key.name)) {
      reject(
        `${key.name} is not a field of ${output.record.name}, so it sorts on nothing.`,
        `Available fields: ${output.record.fields.map((field) => field.name).join(", ")}.`,
      );
    }
  }

  // COBOL gives MERGE no input procedure: a merge's whole premise is that its
  // inputs already arrive in order, and a procedure that could drop or reorder
  // records would break it.
  if (statement.operation === "merge" && statement.inputProcedure) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-006",
        severity: "error",
        message: "A merge has no input procedure.",
        span: statement.inputProcedure.span,
        hint: "Sort the records instead, or filter them into a file the merge reads.",
        backendProfile: null,
      }),
    );
  }

  for (const procedure of [
    statement.inputProcedure,
    statement.outputProcedure,
  ]) {
    if (!procedure) {
      continue;
    }
    validateSortProcedure(
      procedure,
      procedure === statement.inputProcedure,
      output,
      scope,
      aliases,
      recordMap,
      locals,
      diagnostics,
      inTransaction,
    );
  }
}

/**
 * The body of one procedure, and the record it works through.
 *
 * The record is an ordinary record variable, so the body reads and assigns its
 * fields exactly as the rest of the program does; only the loop around it is
 * generated.
 */
function validateSortProcedure(
  procedure: SortProcedureNode,
  isInput: boolean,
  output: ResolvedFile,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const bound = scope.get(procedure.recordName);
  const holdsTheRecord =
    bound?.kind === "record" && bound.name === output.record.name;

  if (!holdsTheRecord) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-006",
        severity: "error",
        message: bound
          ? `${procedure.recordName} does not hold ${output.record.name}, which is the record the sort moves.`
          : `Unresolved record: ${procedure.recordName}.`,
        span: procedure.recordSpan,
        hint: `Name a variable declared as ${output.record.name}.`,
        backendProfile: null,
      }),
    );
  }

  const enclosing = sortInputRecord;
  sortInputRecord = isInput ? procedure.recordName : null;
  validateBranchBody(
    procedure.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
    inTransaction,
  );
  sortInputRecord = enclosing;

  // An input procedure that releases nothing sorts an empty file. There is no
  // reading of that program under which it is what was meant.
  if (isInput && !releasesSomething(procedure.body)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-006",
        severity: "error",
        message:
          "This input procedure never releases a record, so it sorts nothing.",
        span: procedure.span,
        hint: `Write \`release ${procedure.recordName};\` for the records the sort should see.`,
        backendProfile: null,
      }),
    );
  }
}

/**
 * `release <record>;`
 *
 * `RELEASE` hands a record to a sort that is running, so it means nothing
 * outside an input procedure, and it can only hand over the record that
 * procedure is working through.
 */
function validateReleaseStatement(
  statement: ReleaseStatementNode,
  diagnostics: Diagnostic[],
): void {
  if (!sortInputRecord) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-006",
        severity: "error",
        message:
          "release hands a record to a running sort, and none is running here.",
        span: statement.span,
        hint: "Write it inside a sort's `input` procedure.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.recordName !== sortInputRecord) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-006",
        severity: "error",
        message: `The sort takes ${sortInputRecord}, not ${statement.recordName}.`,
        span: statement.span,
        hint: `Write \`release ${sortInputRecord};\`.`,
        backendProfile: null,
      }),
    );
  }
}

/** True when any branch of the body hands a record to the sort. */
function releasesSomething(block: BlockNode): boolean {
  return block.statements.some((statement) => {
    if (statement.kind === "ReleaseStatement") {
      return true;
    }
    return nestedBlocksOf(statement).some((nested) =>
      releasesSomething(nested),
    );
  });
}

function validateSplitStatement(
  statement: SplitStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const source = inferExpressionType(
    statement.source,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  const delimiter = inferExpressionType(
    statement.delimiter,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (
    (source && source.kind !== "string") ||
    (delimiter && delimiter.kind !== "string")
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "split takes a string apart at a string delimiter.",
        span: statement.span,
        hint: 'Write `split key by "-" into branch, account;`.',
        backendProfile: null,
      }),
    );
  }

  for (const target of statement.targets) {
    const type = inferExpressionType(
      target,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    if (type && type.kind !== "string") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message: `A split target is ${describeType(type)}; a split writes strings.`,
          span: target.span,
          hint: "Split into string<n> fields and convert afterwards.",
          backendProfile: null,
        }),
      );
    }
  }
}

/**
 * `json <text> from <record> ...;` and `json <text> into <record> ...;`
 *
 * Either way the text side has to be text and the record side a record, and a
 * generated length has somewhere whole-numbered to go.
 *
 * The rule that matters most is about restricted data, and it points in only
 * one direction. Generating puts a record into text that leaves the program, so
 * a `sensitive` field would be a card number written into a payload in clear —
 * the same escape `BANK-AUD-002` covers for an audit event. Parsing is the
 * reverse: text arriving from outside is written into the record, and a field
 * marked `sensitive` is exactly where restricted data belongs.
 */
function validateSerializeStatement(
  statement: SerializeStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const verb = `${statement.format} ${statement.direction === "generate" ? "from" : "into"}`;
  const target = inferExpressionType(
    statement.target,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (target && (target.kind !== "string" || target.national)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${verb} works through ${describeType(target)}; it works through text.`,
        span: statement.target.span,
        hint:
          statement.direction === "generate"
            ? `Generate into a string<n> wide enough for the ${statement.format}, and read the length from the \`count\` field.`
            : `Parse from a string<n> holding the ${statement.format} document.`,
        backendProfile: null,
      }),
    );
  }

  const source = inferExpressionType(
    statement.source,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (source && source.kind !== "record") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${verb} ${describeType(source)}, which is not a record.`,
        span: statement.source.span,
        hint: "COBOL matches the document against the group's own field names, so there has to be a group.",
        backendProfile: null,
      }),
    );
  }

  if (statement.count) {
    const count = inferExpressionType(
      statement.count,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    if (count && (!isDecimalType(count) || count.scale !== 0)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-003",
          severity: "error",
          message: `The count field holds ${describeType(count)}, which is not a length.`,
          span: statement.count.span,
          hint: "Declare it as binary<n> or decimal<n, 0>.",
          backendProfile: null,
        }),
      );
    }
  }

  if (statement.direction === "generate" && source?.kind === "record") {
    const restricted = source.fields.filter((field) => field.sensitive);
    if (restricted.length > 0) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-AUD-002",
          severity: "error",
          message: `${source.name} carries restricted data in ${restricted.map((field) => field.name).join(", ")}, so it cannot be generated as ${statement.format}.`,
          span: statement.source.span,
          hint: "Serialised text leaves the program. Copy the fields that may leave into a record without them — a masked value derived through a function is the declassification point.",
          backendProfile: null,
        }),
      );
    }
  }

  // `XML PARSE` has no form that fills a record. In Enterprise COBOL, as in
  // GnuCOBOL, it is event-driven — `XML PARSE <text> PROCESSING PROCEDURE
  // <para>` — and the handler walks XML-EVENT and XML-TEXT itself, moving what
  // it recognises. There is no COBOL for `xml payload into account` to become,
  // so the compiler says what does exist rather than emitting something no
  // compiler accepts.
  if (statement.direction === "parse" && statement.format === "xml") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-026",
        severity: "error",
        message: "xml has no form that parses into a record.",
        span: statement.span,
        hint: "`JSON PARSE` fills a record from a document; `XML PARSE` does not — it is event-driven, and the handler moves what it recognises itself. Use `json <text> into <record>`, or take the document apart with `split` and `substring`.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
    return;
  }

  // Parsing is the one construct here whose COBOL the local validator accepts
  // and then does not run, so the compiler says so rather than letting the
  // evidence imply a check that did not happen.
  if (statement.direction === "parse") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-025",
        severity: "warning",
        message: `${statement.format} parse cannot be checked locally.`,
        span: statement.span,
        hint: `Enterprise COBOL implements \`${statement.format.toUpperCase()} PARSE\`; GnuCOBOL 3.2.0 does not, so the local build runs it through the precompiler into BANKJSON — a scan, not IBM's parser. The record is populated and JSON-STATUS is set, but nesting, arrays and escape sequences are past what the stub attempts. Verify the program on z/OS before relying on what it reads — see runtime/README.md and zos/README.md.`,
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }
}

/**
 * `xml <text> processing { element "ID" into account.id; } ...`
 *
 * The document is text and each binding names a field to put an element in.
 * COBOL hands the content over as characters, so a field it can be moved into
 * is text or a number — anything else has no defined conversion and would be a
 * silent misread of the document.
 */
function validateXmlParseStatement(
  statement: XmlParseStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const source = inferExpressionType(
    statement.source,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (source && (source.kind !== "string" || source.national)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `xml parses ${describeType(source)}; it parses text.`,
        span: statement.source.span,
        hint: "Parse from a string<n> holding the document.",
        backendProfile: null,
      }),
    );
  }

  if (statement.bindings.length === 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-026",
        severity: "error",
        message: "This xml statement binds no elements, so it reads nothing.",
        span: statement.span,
        hint: 'Name the elements to keep: `element "BALANCE" into account.balance;`.',
        backendProfile: null,
      }),
    );
  }

  const seen = new Set<string>();
  for (const binding of statement.bindings) {
    if (seen.has(binding.element)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-026",
          severity: "error",
          message: `Element ${binding.element} is bound twice, so the second binding would never be reached.`,
          span: binding.elementSpan,
          hint: "One element goes to one field. Bind it once.",
          backendProfile: null,
        }),
      );
    }
    seen.add(binding.element);

    const target = inferExpressionType(
      binding.target,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    if (!target) {
      continue;
    }
    const readable =
      (target.kind === "string" && !target.national) ||
      isDecimalType(target) ||
      target.kind === "currency";
    if (!readable) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-026",
          severity: "error",
          message: `Element ${binding.element} is read into ${describeType(target)}, which text cannot be moved into.`,
          span: binding.target.span,
          hint: "COBOL hands the content over as characters. Read it into a string<n> or a number, and convert afterwards.",
          backendProfile: null,
        }),
      );
    }
  }

  // The whole statement is unrunnable locally, which is a stronger caveat than
  // the one JSON PARSE carries: GnuCOBOL does not even take the exception
  // branch, so a document that failed to parse looks exactly like one that
  // worked.
  diagnostics.push(
    createDiagnostic({
      id: "BANK-TYPE-025",
      severity: "warning",
      message: "xml parse cannot be checked locally.",
      span: statement.span,
      hint: "Enterprise COBOL implements `XML PARSE`; GnuCOBOL 3.2.0 does not, so the local build runs it through the precompiler, which drives the generated handler from BANKXML — a scan, not IBM's parser. The handler is entered and the fields are filled, but attributes, namespaces, entity references and CDATA are past what the stub attempts. Verify the program on z/OS — see runtime/README.md and zos/README.md.",
      backendProfile: "ibm-enterprise-cobol-zos",
    }),
  );
}

/**
 * `search row in table where <condition> { ... } else { ... }`
 *
 * The element name is bound to one entry of the table for the condition and the
 * body, the way a loop index is, so the condition can talk about the row it is
 * testing rather than about a subscript.
 */
/**
 * `varying <min> to <max> length <field>`.
 *
 * The bounds have to make sense as lengths, and a file that varies has to be
 * sequential: an indexed or relative dataset addresses records by position or
 * key, which a varying length would move.
 */
function validateRecordVarying(
  declaration: FileDeclarationNode,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): { min: number; max: number; lengthName: string } | null {
  const varying = declaration.recordVarying;
  if (!varying) {
    return null;
  }

  const reject = (message: string, hint: string): null => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-009",
        severity: "error",
        message,
        span: declaration.span,
        hint,
        backendProfile: null,
      }),
    );
    return null;
  };

  // The depending item lives outside the record whose length it gives. Inside
  // it, it would be part of the data it is measuring — and the generated
  // `DEPENDING ON` names it bare, which resolves twice, because the record is
  // laid out in working storage and again inside the FD. Both compilers reject
  // that: cobc with "is ambiguous; needs qualification", and there is no
  // qualification that fixes it, since the item may not be in the record at all.
  const record = recordMap.get(declaration.recordTypeName);
  if (
    record?.fields.some(
      (field: { name: string }) => field.name === varying.lengthName,
    )
  ) {
    return reject(
      `${varying.lengthName} is a field of ${declaration.recordTypeName}, so it cannot be the length ${declaration.name} varies by.`,
      `Declare the length outside the record — the field that says how much of a record is in use is not part of the record it measures.`,
    );
  }

  if (varying.min <= 0 || varying.min > varying.max) {
    return reject(
      `${declaration.name} varies from ${varying.min} to ${varying.max}, which is not a range of lengths.`,
      "The shortest record has to be at least one character and no longer than the longest.",
    );
  }

  if (declaration.organization !== "sequential") {
    return reject(
      `${declaration.name} is ${declaration.organization}, so its records cannot vary in length.`,
      "An indexed or relative dataset addresses a record by key or by position, which a varying length would move. A varying record belongs to a sequential file.",
    );
  }

  return varying;
}

/** The `ascending` key the searched table declares, if it declares one. */
function searchedTableKey(
  array: MemberAccessNode | IdentifierNode,
  scope: Map<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
): string | null {
  if (array.kind !== "MemberAccess" || array.target.kind !== "Identifier") {
    return null;
  }
  const holder = scope.get(array.target.name);
  const record =
    holder?.kind === "record" ? recordMap.get(holder.name) : undefined;
  return (
    record?.fields.find((field) => field.name === array.member)?.ascendingKey ??
    null
  );
}

/** True when the condition is `<element>.<key> == <value>`, which is all COBOL bisects on. */
function testsKeyForEquality(
  statement: SearchStatementNode,
  key: string,
): boolean {
  const condition = statement.condition;
  if (condition.kind !== "BinaryExpression" || condition.operator !== "==") {
    return false;
  }
  const names = (side: ExpressionNode): boolean =>
    side.kind === "MemberAccess" &&
    side.target.kind === "Identifier" &&
    side.target.name === statement.elementName &&
    side.member === key;
  return names(condition.left) || names(condition.right);
}

function validateSearchStatement(
  statement: SearchStatementNode,
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

  // COBOL will bisect a table only if the declaration says it is ordered, and
  // only on equality against that key — anything else has no ordering to cut in
  // half. Both are checked here rather than found later as a wrong answer.
  if (statement.sorted) {
    const key = searchedTableKey(statement.array, scope, recordMap);
    if (!key) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-028",
          severity: "error",
          message: `${statement.elementName} searches a table that does not declare an order.`,
          span: statement.span,
          hint: "Add `ascending <field>` to the table's declaration, and keep it sorted. A binary search on an unsorted table returns the wrong row rather than falling back to a scan.",
          backendProfile: null,
        }),
      );
    } else if (!testsKeyForEquality(statement, key)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-028",
          severity: "error",
          message: `A sorted search has to test ${key} for equality.`,
          span: statement.condition.span,
          hint: `Write \`${statement.elementName}.${key} == <value>\`. Bisecting needs the key the table is ordered by; any other test has no ordering to cut in half.`,
          backendProfile: null,
        }),
      );
    }
  }

  if (arrayType.kind !== "array") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `Cannot search ${describeType(arrayType)}, which is not a table.`,
        span: statement.array.span,
        hint: "Search a field declared as T[n].",
        backendProfile: null,
      }),
    );
    return;
  }

  const shadowed = scope.get(statement.elementName);
  scope.set(statement.elementName, arrayType.element);

  const condition = inferExpressionType(
    statement.condition,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (condition && !isBoolType(condition)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: "A search condition must be bool.",
        span: statement.condition.span,
        hint: "Compare a field of the element with the value being looked for.",
        backendProfile: null,
      }),
    );
  }

  validateBranchBody(
    statement.body,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
    inTransaction,
  );
  validateBranchBody(
    statement.notFound,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
    inTransaction,
  );

  if (shadowed) {
    scope.set(statement.elementName, shadowed);
  } else {
    scope.delete(statement.elementName);
  }
}

function validateReturnCodeStatement(
  statement: ReturnCodeStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const type = inferExpressionType(
    statement.value,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );

  if (type && (!isDecimalType(type) || type.scale !== 0)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `A return code is a whole number, not ${describeType(type)}.`,
        span: statement.span,
        hint: "Write `returnCode = 4;`.",
        backendProfile: null,
      }),
    );
    return;
  }

  const literal = literalWholeNumber(statement.value);
  if (literal !== null && (literal < 0 || literal > 4095)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${literal} is not a condition code; RETURN-CODE holds 0 to 4095.`,
        span: statement.span,
        hint: "Conventionally 0 ran clean, 4 warned, 8 failed, 12 or more is fatal.",
        backendProfile: null,
      }),
    );
  }
}

function validateUnitOfWorkStatement(
  statement: UnitOfWorkStatementNode,
  diagnostics: Diagnostic[],
): void {
  if (!currentTransactionIsCics) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      id: "BANK-SQL-004",
      severity: "error",
      message: `\`${statement.operation}\` has no meaning inside a CICS transaction, where CICS owns the unit of work.`,
      span: statement.span,
      hint:
        statement.operation === "commit"
          ? "Write `syncpoint resp <status>;`, which commits Db2's work with everything else."
          : "Write `rollback resp <status>;`, the CICS command, which backs out Db2's work too.",
      backendProfile: null,
    }),
  );
}

function validateCursorLoopStatement(
  statement: CursorLoopStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  locals: ResolvedLocal[],
  diagnostics: Diagnostic[],
  inTransaction: boolean,
): void {
  const declared = sqlMap.get(statement.cursorName);
  if (!declared) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved cursor: ${statement.cursorName}.`,
        span: statement.cursorSpan,
        hint: "Declare the cursor before the transaction that reads it.",
        backendProfile: null,
      }),
    );
    return;
  }

  if (declared.form !== "cursor") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-005",
        severity: "error",
        message: `${statement.cursorName} is a SQL statement, not a cursor, so it returns at most one row.`,
        span: statement.cursorSpan,
        hint: `Write \`execute ${statement.cursorName}(...) into <record>;\`, or declare it with \`cursor\`.`,
        backendProfile: null,
      }),
    );
    return;
  }

  if (statement.args.length !== declared.parameters.length) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-003",
        severity: "error",
        message: `Cursor ${statement.cursorName} expects ${declared.parameters.length} argument(s) but received ${statement.args.length}.`,
        span: statement.cursorSpan,
        hint: "Pass one value per declared parameter.",
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
          message: `Argument ${index + 1} of ${statement.cursorName} expects ${describeType(expected)} but received ${describeType(actual)}.`,
          span: statement.args[index].span,
          hint: "A host variable must match the declared parameter layout.",
          backendProfile: null,
        }),
      );
    }
  }

  const row = scope.get(statement.rowName);
  if (!row) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved record variable: ${statement.rowName}.`,
        span: statement.rowSpan,
        hint: "Pass a record-typed parameter and fetch into it.",
        backendProfile: null,
      }),
    );
  } else if (
    row.kind !== "record" ||
    !declared.result ||
    row.name !== declared.result.name
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-003",
        severity: "error",
        message: `Cursor ${statement.cursorName} returns ${declared.result?.name ?? "no record"}, but ${statement.rowName} is ${describeType(row)}.`,
        span: statement.rowSpan,
        hint: "Fetch into a record of the cursor's declared result type.",
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
        span: statement.limitSpan,
        hint: "Write `limit 1000`.",
        backendProfile: null,
      }),
    );
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
    // A branch, on the same terms a `for each` body has always allowed one.
    // Rejecting it here was an oversight rather than a rule: `switch` was
    // permitted and `if` was not, and the read-ahead a file loop needs — read,
    // then act only if the read found something — could not be written at all.
    // What the diagnostic is actually for is keeping `return` out of a loop,
    // and `inLoopBody` still does that inside the branch.
    if (inTransaction && inner.kind === "IfStatement") {
      validateTransactionBranch(
        inner,
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
        message: `A ${inner.kind} is not allowed inside a loop body.`,
        span: inner.span,
        hint: "Loop bodies carry effects; move returns outside the loop.",
        backendProfile: null,
      }),
    );
  }
  inLoopBody = previousInLoop;
}

/**
 * Follows restricted data across an assignment.
 *
 * A local takes on whatever it was assigned, and loses it when overwritten with
 * something unrestricted. A record field cannot: its marking is part of the
 * record's declaration and therefore part of its copybook, so assigning
 * restricted data into a field not marked `sensitive` would reclassify it
 * silently and defeat the marking everywhere downstream.
 */
function trackSensitiveAssignment(
  statement: AssignStatementNode,
  scope: Map<string, ResolvedType>,
  diagnostics: Diagnostic[],
): void {
  const sensitive = isSensitiveExpression(statement.expression, scope);

  if (statement.target.kind === "Identifier") {
    if (sensitive) {
      sensitiveLocals.add(statement.target.name);
    } else {
      sensitiveLocals.delete(statement.target.name);
    }
    return;
  }

  if (!sensitive || statement.target.kind !== "MemberAccess") {
    return;
  }

  const field = sensitiveFieldOf(statement.target, scope);
  if (field && !field.sensitive) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SEC-001",
        severity: "error",
        message: `Restricted data is assigned to ${field.name}, which is not marked sensitive.`,
        span: statement.span,
        hint: `Mark ${field.name} sensitive, or derive an unrestricted value through a function first.`,
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
  trackSensitiveAssignment(statement, scope, diagnostics);

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

/**
 * The alternate key a `start` names, if it names one.
 *
 * `start accountMaster key account.customerId` is a browse on the alternate
 * index over `customerId`. COBOL takes the key of reference from the data item
 * the START names and every subsequent READ NEXT follows that index, so the
 * field in the expression is the whole declaration — there is no separate
 * syntax to add. Returns null when the expression is anything else, which
 * leaves the primary key as the one to check against.
 */
export function alternateKeyNamed(
  key: ExpressionNode,
  file: ResolvedFile,
): ResolvedField | null {
  if (key.kind !== "MemberAccess") {
    return null;
  }
  return file.alternateKeys.find((field) => field.name === key.member) ?? null;
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

  // What each operation needs the file to have been opened for. `update` is
  // COBOL's I-O: the same OPEN serves the read that finds a record and the
  // rewrite that puts it back, which is what a master file update is.
  const readingOperations = new Set(["read", "readNext", "start"]);
  const writingOperations = new Set(["write", "rewrite", "delete"]);

  if (readingOperations.has(statement.operation) && file.mode === "output") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-001",
        severity: "error",
        message: `Cannot ${statement.operation} from ${file.name}, which is declared as output.`,
        span: statement.span,
        hint: "Declare the file as input, or as update to both read and write it.",
        backendProfile: null,
      }),
    );
  }

  if (writingOperations.has(statement.operation) && file.mode === "input") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-001",
        severity: "error",
        message: `Cannot ${statement.operation} to ${file.name}, which is declared as input.`,
        span: statement.span,
        hint: "Declare the file as output, or as update to both read and write it.",
        backendProfile: null,
      }),
    );
  }

  // Updating a record in place means finding it first, so these only make sense
  // on a file the program can also read.
  if (
    (statement.operation === "rewrite" || statement.operation === "delete") &&
    file.mode !== "update"
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-005",
        severity: "error",
        message: `${statement.operation} needs ${file.name} open for update, not ${file.mode}.`,
        span: statement.span,
        hint: `Declare it as \`file ${file.name} ${file.organization} update record ...\`, which opens I-O.`,
        backendProfile: null,
      }),
    );
  }

  // Enterprise COBOL has no DELETE for a sequential file: a record is removed
  // by leaving it out of the file the next program writes, not by deleting it
  // in place. GnuCOBOL compiles the statement, which is why nothing local
  // caught this.
  if (statement.operation === "delete" && file.organization === "sequential") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-011",
        severity: "error",
        message: `delete needs a keyed or relative file, and ${file.name} is sequential.`,
        span: statement.span,
        hint: "A sequential file has no record to address for removal. Copy the records worth keeping into a new file, or declare this one indexed or relative.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }

  // A browse walks an index. There is no order to walk on a sequential file
  // that the program is not already reading in order.
  if (
    (statement.operation === "start" || statement.operation === "readNext") &&
    file.organization !== "indexed"
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-005",
        severity: "error",
        message: `${statement.operation} browses an index, but ${file.name} is ${file.organization}.`,
        span: statement.span,
        hint: "Declare the file as indexed with a record key, or read it sequentially.",
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
          message: `Only an indexed file supports a key, but ${file.name} is ${file.organization}.`,
          span: statement.span,
          hint: "Declare the file as indexed with a record key.",
          backendProfile: null,
        }),
      );
    } else {
      // A browse may walk an alternate index, and that is nearly always why the
      // alternate exists — an account file read by customer. COBOL decides the
      // key of reference from the field the START names, so naming an alternate
      // key's own field is how the program asks for it. A `read ... key` still
      // has to be the primary: READ with a KEY names a random read, and Db2 is
      // not in this; a duplicate alternate has no single record to fetch.
      const browseKey =
        statement.operation === "start"
          ? alternateKeyNamed(statement.key, file)
          : null;
      const declaredKey = browseKey ?? file.keyField;
      const keyType = inferExpressionType(
        statement.key,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
      if (
        keyType &&
        declaredKey &&
        !typesCompatible(declaredKey.type, keyType)
      ) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-004",
            severity: "error",
            message: `Key expression is ${describeType(keyType)} but the record key ${declaredKey.name} is ${describeType(declaredKey.type)}.`,
            span: statement.key.span,
            hint:
              file.alternateKeys.length > 0 && statement.operation === "start"
                ? `The key must be the record key ${declaredKey.name} or an alternate: ${file.alternateKeys.map((key) => key.name).join(", ")}.`
                : "The key must match the declared record key field.",
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

  // AFTER ADVANCING spaces a report line; a keyed file has no lines to space.
  if (statement.advancing !== null && file.organization !== "sequential") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-007",
        severity: "error",
        message: `\`advancing\` writes a report line, and ${file.name} is ${file.organization}.`,
        span: statement.span,
        hint: "Declare the report as `sequential output`.",
        backendProfile: null,
      }),
    );
  }

  // COBOL signals AT END-OF-PAGE from the LINAGE counter, so without a declared
  // page depth there is no page for the write to reach the end of.
  if (statement.atEndOfPage && !file.linage) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-007",
        severity: "error",
        message: `${file.name} declares no page depth, so a write never reaches the end of one.`,
        span: statement.span,
        hint: `Declare it with \`page <lines>\`, and a footing if the totals go above the last line.`,
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
  checkNotSensitive(
    statement.account,
    scope,
    "the ledger journal",
    diagnostics,
  );

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
  if (!amountType) {
    return;
  }

  // Currency is the type the ledger interface was designed for: it is a decimal
  // that also carries its unit. Rejecting it would leave every currency-typed
  // balance unpostable.
  if (amountType.kind !== "decimal" && amountType.kind !== "currency") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `The ${statement.operation} amount argument must be a decimal or currency value.`,
        span: statement.amount.span,
        hint: "Pass a decimal or currency amount so the posting stays exact.",
        backendProfile: null,
      }),
    );
    return;
  }

  checkFitsLedgerInterface(statement, amountType, diagnostics);
}

/** Integer and fraction digits `BANK-LEDGER-AMOUNT PIC S9(16)V99` can hold. */
const LEDGER_INTEGER_DIGITS = 16;
const LEDGER_SCALE = 2;

/**
 * Checks that a posted amount fits the ledger interface without truncation.
 *
 * The interface is a fixed `PIC S9(16)V99`, so an amount with a wider integer
 * part or a finer scale loses digits in the `MOVE`. COBOL truncates silently,
 * and a silently truncated posting is the worst possible failure mode here.
 */
function checkFitsLedgerInterface(
  statement: LedgerStatementNode,
  amountType: DecimalType | CurrencyType,
  diagnostics: Diagnostic[],
): void {
  // A literal widens to whatever it is assigned to, so its written scale is not
  // a claim about the value's real precision.
  if (amountType.kind === "decimal" && amountType.literal) {
    return;
  }

  const integerDigits = amountType.precision - amountType.scale;
  if (amountType.scale > LEDGER_SCALE) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-LED-004",
        severity: "error",
        message: `A ${statement.operation} amount with scale ${amountType.scale} does not fit the ledger interface, which is PIC S9(${LEDGER_INTEGER_DIGITS})V${"9".repeat(LEDGER_SCALE)}.`,
        span: statement.amount.span,
        hint: `Round to ${LEDGER_SCALE} decimal places with an explicit mode before posting, so the rounding is stated rather than left to a truncating MOVE.`,
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
    return;
  }

  if (integerDigits > LEDGER_INTEGER_DIGITS) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-LED-004",
        severity: "error",
        message: `A ${statement.operation} amount with ${integerDigits} integer digits does not fit the ledger interface, which holds ${LEDGER_INTEGER_DIGITS}.`,
        span: statement.amount.span,
        hint: `Narrow the amount type to at most decimal<${LEDGER_INTEGER_DIGITS + LEDGER_SCALE}, ${LEDGER_SCALE}>. The MOVE into BANK-LEDGER-AMOUNT would drop the high-order digits without a runtime error.`,
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }
}

/**
 * Locals currently holding restricted data, for the body being checked.
 *
 * A local assigned from a `sensitive` field carries that data onward, so the
 * check has to follow it. Tracked per body and cleared between them, like the
 * other body-scoped state in this module.
 */
let sensitiveLocals = new Set<string>();

/**
 * True when an expression can carry data from a `sensitive` field.
 *
 * Reads a field's own marking, follows locals through `sensitiveLocals`, and
 * treats any operand of a computation as carrying the whole expression's
 * sensitivity — an amount derived from a restricted value is still derived from
 * it.
 *
 * A call is deliberately not followed. Passing a restricted value into a
 * function is the declassification point: `maskPan(card.number)` is untainted,
 * and the compiler does not check that `maskPan` masks anything. That is a
 * stated limit rather than an oversight — following taint across a call would
 * need per-function summaries, and a language with no closures and no higher
 * order functions can express masking no other way.
 */
function isSensitiveExpression(
  expression: ExpressionNode,
  scope: Map<string, ResolvedType>,
): boolean {
  switch (expression.kind) {
    case "Identifier":
      return sensitiveLocals.has(expression.name);
    case "MemberAccess":
      return sensitiveFieldOf(expression, scope)?.sensitive ?? false;
    case "IndexAccess":
      return isSensitiveExpression(expression.target, scope);
    case "BinaryExpression":
      return (
        isSensitiveExpression(expression.left, scope) ||
        isSensitiveExpression(expression.right, scope)
      );
    case "UnaryExpression":
    case "RoundedExpression":
    case "NullableCheck":
      return isSensitiveExpression(expression.operand, scope);
    default:
      return false;
  }
}

/**
 * `trim`, `upper`, `lower`, `substring`, `concat`, and `now`.
 *
 * Every result has a length the compiler can name, because a COBOL field has a
 * fixed one. `substring` therefore takes literal bounds: a length decided at run
 * time has no `PIC X(n)` to land in.
 */
function inferStringCall(
  expression: StringCallNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const args = expression.args.map((argument) =>
    inferExpressionType(argument, scope, aliases, recordMap, diagnostics),
  );

  const reject = (message: string, hint: string): null => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message,
        span: expression.span,
        hint,
        backendProfile: null,
      }),
    );
    return null;
  };

  const stringLength = (type: ResolvedType | null): number | null =>
    type?.kind === "string" ? type.length : null;

  switch (expression.operation) {
    case "now":
      if (args.length !== 0) {
        return reject("now() takes no arguments.", "Write `now()`.");
      }
      return { kind: "temporal", unit: "timestamp" };

    case "countOf": {
      const length = stringLength(args[0]);
      if (args.length !== 2 || length === null || args[1]?.kind !== "string") {
        return reject(
          "countOf expects a string and the characters to count.",
          'Write `countOf(narrative, ",")`.',
        );
      }
      return { kind: "decimal", precision: 9, scale: 0 };
    }

    case "replaceChars": {
      const length = stringLength(args[0]);
      const from = args[1]?.kind === "string" ? args[1].length : null;
      const to = args[2]?.kind === "string" ? args[2].length : null;
      if (
        args.length !== 3 ||
        length === null ||
        from === null ||
        to === null
      ) {
        return reject(
          "replaceChars expects a string, the characters to replace, and what to replace them with.",
          'Write `replaceChars(reference, " ", "0")`.',
        );
      }
      if (from !== to) {
        // INSPECT CONVERTING maps character to character, so the two sets have
        // to be the same size. Anything else is a substitution, not a
        // conversion, and COBOL has no single statement for it.
        return reject(
          `replaceChars converts character by character, so "${from}" characters cannot become "${to}".`,
          "Give both sides the same number of characters.",
        );
      }
      return { kind: "string", length, literal: true };
    }

    case "trim":
    case "upper":
    case "lower": {
      const length = stringLength(args[0]);
      if (args.length !== 1 || length === null) {
        return reject(
          `${expression.operation} expects one string.`,
          `Write \`${expression.operation}(name)\`.`,
        );
      }
      return { kind: "string", length, literal: true };
    }

    case "substring": {
      const length = stringLength(args[0]);
      const [, startNode, lengthNode] = expression.args;
      const start = literalWholeNumber(startNode);
      const width = literalWholeNumber(lengthNode);
      if (args.length !== 3 || length === null) {
        return reject(
          "substring expects a string, a start position, and a length.",
          "Write `substring(cardNumber, 13, 4)`.",
        );
      }
      if (start === null || width === null) {
        return reject(
          "substring bounds must be written as whole numbers.",
          "A length decided at run time has no fixed COBOL field to land in.",
        );
      }
      if (start < 1 || width < 1 || start + width - 1 > length) {
        return reject(
          `substring(${start}, ${width}) falls outside a string<${length}>.`,
          "Positions start at 1, and the slice must end inside the string.",
        );
      }
      return { kind: "string", length: width, literal: true };
    }

    case "concat": {
      if (args.length < 2) {
        return reject(
          "concat expects at least two strings.",
          'Write `concat(prefix, "-", suffix)`.',
        );
      }
      let total = 0;
      for (const type of args) {
        const length = stringLength(type);
        if (length === null) {
          return reject(
            "concat joins strings.",
            "Convert a number to a string before joining it.",
          );
        }
        total += length;
      }
      return { kind: "string", length: total, literal: true };
    }
  }
}

/** A literal whole number written in the source, or null for anything else. */
function literalWholeNumber(node: ExpressionNode | undefined): number | null {
  if (!node || node.kind !== "DecimalLiteral" || node.text.includes(".")) {
    return null;
  }
  return Number(node.text);
}

/** A whole number of days, the type `daysBetween` returns and `addDays` takes. */
const DAY_COUNT: ResolvedType = {
  kind: "decimal",
  precision: 9,
  scale: 0,
};

/**
 * `today()`, `addDays(when, days)`, and `daysBetween(from, to)`.
 *
 * Adding a day to 20260131 is not adding one to the digits, so the arguments
 * are checked as calendar values rather than as numbers that happen to fit.
 */
/**
 * `abs`, `mod`, `rem`, `min`, `max`, `annuity`, `presentValue`, `isNumeric`,
 * and `toNumber`.
 *
 * Each is a COBOL intrinsic, so the checking here is about arity and about
 * what the intrinsic will accept — not about the arithmetic, which COBOL does.
 *
 * `annuity`, `presentValue`, and `toNumber` come back `rounded`, meaning they
 * take the scale of whatever they are assigned to. That is not a shortcut: a
 * repayment factor has no natural scale of its own, and the only scale that
 * matters is the one the money it multiplies is held at.
 */
function inferNumericCall(
  expression: NumericCallNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const args = expression.args.map((argument) =>
    inferExpressionType(argument, scope, aliases, recordMap, diagnostics),
  );

  const reject = (message: string, hint: string): null => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message,
        span: expression.span,
        hint,
        backendProfile: null,
      }),
    );
    return null;
  };

  const arity: Record<NumericCallNode["operation"], number> = {
    abs: 1,
    mod: 2,
    rem: 2,
    min: 2,
    max: 2,
    annuity: 2,
    presentValue: 2,
    isNumeric: 1,
    toNumber: 1,
    integerPart: 1,
    fractionPart: 1,
    sign: 1,
    reverse: 1,
    textLength: 1,
  };
  if (args.length !== arity[expression.operation]) {
    return reject(
      `${expression.operation} takes ${arity[expression.operation]} argument${arity[expression.operation] === 1 ? "" : "s"}.`,
      "Check the argument list against the reference.",
    );
  }
  if (args.some((argument) => argument === null)) {
    return null;
  }

  const numeric = (type: ResolvedType | null): boolean =>
    type !== null && (isDecimalType(type) || type.kind === "currency");

  // A rounded result takes the target's scale, which is what these have: a
  // repayment factor is a ratio, and a parsed number is whatever the field it
  // lands in holds.
  const rounded: ResolvedType = {
    kind: "decimal",
    precision: 18,
    scale: 2,
    rounded: true,
  };

  switch (expression.operation) {
    case "isNumeric":
    case "toNumber": {
      const text = args[0];
      if (!text || text.kind !== "string" || text.national) {
        return reject(
          `${expression.operation} reads text.`,
          "Pass a string<n> field holding the characters to examine.",
        );
      }
      return expression.operation === "isNumeric" ? { kind: "bool" } : rounded;
    }
    case "reverse": {
      const text = args[0];
      if (!text || text.kind !== "string" || text.national) {
        return reject(
          "reverse turns text back to front.",
          "Pass a string<n>. A number has no order to reverse.",
        );
      }
      // Same characters, same width, opposite order.
      return { kind: "string", length: text.length };
    }
    case "textLength": {
      const text = args[0];
      if (!text || text.kind !== "string" || text.national) {
        return reject(
          "textLength measures text.",
          "Pass a string<n>. A COBOL field's declared width is fixed; this is what it actually holds.",
        );
      }
      // A count, whose width is the receiving field's business rather than
      // this function's — the same reason `round` takes the target's scale.
      return { ...rounded, scale: 0 };
    }
    case "abs":
    case "integerPart":
    case "fractionPart": {
      if (!numeric(args[0])) {
        return reject(
          `${expression.operation} takes a number.`,
          "Pass a decimal, a binary, or a currency amount.",
        );
      }
      // `integerPart` drops the fraction, so it comes back rounded and takes
      // the target's scale — usually zero, which is the point of asking.
      return expression.operation === "abs" ? args[0] : rounded;
    }
    case "sign": {
      if (!numeric(args[0])) {
        return reject(
          "sign takes a number.",
          "Pass a decimal, a binary, or a currency amount.",
        );
      }
      // -1, 0, or 1: which way an amount moves, without comparing it twice.
      // Held in whatever whole-number field it is put in.
      return { ...rounded, scale: 0 };
    }
    case "mod":
    case "rem": {
      // COBOL's MOD and REM are defined on integers, and a check digit — the
      // reason to have them — is integer arithmetic.
      for (const argument of args) {
        if (!argument || !isDecimalType(argument) || argument.scale !== 0) {
          return reject(
            `${expression.operation} takes whole numbers.`,
            "Declare both as binary<n> or decimal<n, 0>.",
          );
        }
      }
      return args[1];
    }
    case "min":
    case "max": {
      if (!numeric(args[0]) || !numeric(args[1])) {
        return reject(
          `${expression.operation} compares two numbers.`,
          "Pass two decimals, or two amounts of the same currency.",
        );
      }
      if (!typesCompatible(args[0] as ResolvedType, args[1] as ResolvedType)) {
        return reject(
          `${expression.operation} compares ${describeType(args[0] as ResolvedType)} with ${describeType(args[1] as ResolvedType)}.`,
          "Both sides have to be the same type, for the same reason a comparison does.",
        );
      }
      return args[0];
    }
    case "annuity":
    case "presentValue": {
      if (!numeric(args[0])) {
        return reject(
          `${expression.operation} takes a rate per period as its first argument.`,
          "A monthly rate is the annual rate divided by twelve, as a fraction: `decimal<9, 6>` holding 0.005 for 0.5%.",
        );
      }
      if (expression.operation === "annuity") {
        const periods = args[1];
        if (!periods || !isDecimalType(periods) || periods.scale !== 0) {
          return reject(
            "annuity takes a whole number of periods.",
            "Declare the term as binary<n> or decimal<n, 0>.",
          );
        }
      } else if (!numeric(args[1])) {
        return reject(
          "presentValue discounts an amount.",
          "Pass the cash flow to discount as a decimal or a currency amount.",
        );
      }
      return rounded;
    }
  }
}

function inferTemporalCall(
  expression: TemporalCallNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  const args = expression.args.map((argument) =>
    inferExpressionType(argument, scope, aliases, recordMap, diagnostics),
  );

  const reject = (message: string, hint: string): null => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message,
        span: expression.span,
        hint,
        backendProfile: null,
      }),
    );
    return null;
  };

  const isDate = (type: ResolvedType | null): boolean =>
    type?.kind === "temporal" && type.unit === "date";

  switch (expression.operation) {
    case "today":
      if (args.length !== 0) {
        return reject("today() takes no arguments.", "Write `today()`.");
      }
      return { kind: "temporal", unit: "date" };

    case "addDays":
      if (args.length !== 2 || !isDate(args[0])) {
        return reject(
          "addDays expects a date and a whole number of days.",
          "Write `addDays(valueDate, 30)`.",
        );
      }
      if (args[1] && !typesCompatible(DAY_COUNT, args[1])) {
        return reject(
          `addDays expects a whole number of days but received ${describeType(args[1])}.`,
          "A day count is decimal<9, 0>; a fraction of a day is not a date.",
        );
      }
      return { kind: "temporal", unit: "date" };

    case "daysBetween":
      if (args.length !== 2 || !isDate(args[0]) || !isDate(args[1])) {
        return reject(
          "daysBetween expects two dates.",
          "Write `daysBetween(openedOn, today())`.",
        );
      }
      return DAY_COUNT;
  }
}

/** The declared field a member access reads, when it resolves to one. */
function sensitiveFieldOf(
  expression: MemberAccessNode,
  scope: Map<string, ResolvedType>,
): ResolvedField | null {
  const target =
    expression.target.kind === "Identifier"
      ? scope.get(expression.target.name)
      : null;
  if (!target || target.kind !== "record") {
    return null;
  }
  return (
    target.fields.find((field) => field.name === expression.member) ?? null
  );
}

/**
 * Reports restricted data escaping into a log.
 *
 * An audit event and a ledger posting are both written to a durable record that
 * outlives the transaction and is read by people who have no business seeing a
 * card number. A field marked `sensitive` may be read, computed with, and
 * written to a file; it may not be written here.
 */
function checkNotSensitive(
  expression: ExpressionNode,
  scope: Map<string, ResolvedType>,
  destination: string,
  diagnostics: Diagnostic[],
): void {
  if (!isSensitiveExpression(expression, scope)) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      id: "BANK-AUD-002",
      severity: "error",
      message: `A value marked sensitive reaches ${destination}.`,
      span: expression.span,
      hint: "Pass an idempotency key or another unrestricted identifier, or derive a masked value through a function first.",
      backendProfile: null,
    }),
  );
}

function validateAuditStatement(
  statement: AuditStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  checkNotSensitive(statement.correlation, scope, "the audit log", diagnostics);

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

/**
 * Resolves a record, and its base first, memoising into `recordMap`.
 *
 * `inProgress` carries the chain of records currently being resolved so a cycle
 * is reported against the declaration that closes it instead of overflowing the
 * stack.
 */
function ensureRecordResolved(
  name: string,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
  inProgress: string[],
): ResolvedRecord | null {
  const existing = recordMap.get(name);
  if (existing) {
    return existing;
  }

  if (inProgress.includes(name)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-016",
        severity: "error",
        message: `Record inheritance forms a cycle: ${[...inProgress, name].join(" extends ")}.`,
        span,
        hint: "A record cannot extend itself, directly or through another record.",
        backendProfile: null,
      }),
    );
    return null;
  }

  const declaration = pendingRecordDeclarations.get(name);
  if (!declaration) {
    return null;
  }

  const resolved = resolveRecord(declaration, aliases, recordMap, diagnostics, [
    ...inProgress,
    name,
  ]);
  if (!resolved) {
    return null;
  }

  recordSink.push(resolved);
  recordMap.set(resolved.name, resolved);
  return resolved;
}

function resolveRecord(
  declaration: RecordDeclarationNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  inProgress: string[],
): ResolvedRecord | null {
  const fields: ResolvedField[] = [];

  // Base fields are laid out first so the derived record's leading storage is
  // byte-for-byte the base record's storage. That is what makes a base-typed
  // parameter safe to satisfy with a derived record, and what lets an existing
  // copybook for the base still read a derived record correctly.
  if (declaration.baseType) {
    const base = resolveBaseRecord(
      declaration.baseType,
      aliases,
      recordMap,
      diagnostics,
      inProgress,
    );
    if (base) {
      recordBases.set(declaration.name, base.name);
      fields.push(...base.fields);
    }
  }

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

    const inherited = fields.find((existing) => existing.name === field.name);
    if (inherited) {
      // Redeclaring an inherited field would put two fields of the same name in
      // one COBOL group, which is ambiguous however it is qualified.
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-017",
          severity: "error",
          message: `Field ${field.name} is already declared by the base record.`,
          span: field.span,
          hint: "Rename the field. A derived record extends the base layout; it cannot replace part of it.",
          backendProfile: null,
        }),
      );
      continue;
    }

    fields.push({
      name: field.name,
      span: field.span,
      type: resolved,
      initialValue: resolveInitialValue(field, resolved, diagnostics),
      sensitive: field.sensitive,
      redefines: field.redefines,
      dependingOn: field.dependingOn,
      ascendingKey: field.ascendingKey,
      synchronized: field.synchronized,
      justified: field.justified,
      blankWhenZero: field.blankWhenZero,
      renames: null,
    });
  }

  validateVariantFields(declaration, fields, diagnostics);
  fields.push(...resolveRenames(declaration, fields, diagnostics));

  return {
    name: declaration.name,
    span: declaration.span,
    fields,
  };
}

/**
 * `wholeDate renames yearPart through dayPart;`
 *
 * A `RENAMES` names a run of fields that is already there, so both ends have to
 * be fields of this record and the first has to come before the last. It gets
 * no storage: the group it names is exactly the bytes those fields occupy,
 * which is why it is typed as the alphanumeric span a group move would treat it
 * as.
 */
function resolveRenames(
  declaration: RecordDeclarationNode,
  fields: ResolvedField[],
  diagnostics: Diagnostic[],
): ResolvedField[] {
  const resolved: ResolvedField[] = [];

  for (const entry of declaration.renames) {
    const reject = (message: string, hint: string): void => {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-COPY-004",
          severity: "error",
          message,
          span: entry.span,
          hint,
          backendProfile: null,
        }),
      );
    };

    const from = fields.findIndex((field) => field.name === entry.from);
    const to = fields.findIndex((field) => field.name === entry.to);

    if (from === -1 || to === -1) {
      reject(
        `${entry.name} renames ${from === -1 ? entry.from : entry.to}, which is not a field of ${declaration.name}.`,
        "A renames names a run of fields that is already there.",
      );
      continue;
    }
    if (from > to) {
      reject(
        `${entry.name} renames ${entry.from} through ${entry.to}, which are the wrong way round.`,
        "The first field has to be declared before the last.",
      );
      continue;
    }
    // COBOL forbids renaming across a variable-occurrence item: the run's
    // length would depend on a count, and a 66-level has no length of its own.
    const variable = fields
      .slice(from, to + 1)
      .find((field) => field.dependingOn);
    if (variable) {
      reject(
        `${entry.name} renames a run containing ${variable.name}, whose length depends on a count.`,
        "A renames has no length of its own, so the run it names must be fixed.",
      );
      continue;
    }

    // A group move treats the run as alphanumeric, whatever the pictures
    // inside it are, so that is the type the name carries.
    const bytes = declaredRunLength(fields.slice(from, to + 1));

    resolved.push({
      name: entry.name,
      span: entry.span,
      type: { kind: "string", length: bytes },
      // A renames is a second name for storage that is already initialised by
      // the fields it covers, so it carries no VALUE of its own.
      initialValue: null,
      ascendingKey: null,
      sensitive: fields.slice(from, to + 1).some((field) => field.sensitive),
      redefines: null,
      dependingOn: null,
      synchronized: false,
      justified: false,
      blankWhenZero: false,
      renames: { from: entry.from, to: entry.to },
    });
  }

  return resolved;
}

/**
 * Bytes a field occupies.
 *
 * Mirrors the emitter's layout rules rather than importing them: the
 * typechecker runs before lowering, and the checks that need this only compare
 * declared fields rather than describing a whole record.
 */
function declaredByteLength(type: ResolvedType): number {
  switch (type.kind) {
    case "string":
      // A national character is two bytes, which is the whole reason the type
      // exists: a record holding one does not line up if it is counted as one.
      return type.national ? type.length * 2 : type.length;
    case "bool":
      return 1;
    case "temporal":
      return type.unit === "date" ? 8 : type.unit === "time" ? 6 : 26;
    case "decimal":
    case "currency": {
      const usage =
        type.kind === "decimal" ? (type.usage ?? "packed") : "packed";
      if (usage === "binary") {
        return type.precision <= 4 ? 2 : type.precision <= 9 ? 4 : 8;
      }
      if (usage === "display") {
        return type.precision + 1;
      }
      if (usage === "unsigned") {
        return type.precision;
      }
      return Math.ceil((type.precision + 1) / 2);
    }
    case "enum":
      return Math.max(...type.members.map((member) => member.length), 1);
    case "nullable":
      return declaredByteLength(type.inner) + 2;
    case "array":
      return declaredByteLength(type.element) * type.length;
    case "record":
      return declaredRunLength(type.fields);
    case "edited":
      return 0;
  }
}

/**
 * Bytes a run of declared fields occupies.
 *
 * A renames adds nothing: it is a second name for fields already counted. A
 * redefines usually adds nothing either, because it re-reads storage that is
 * already there — but COBOL permits a redefinition longer than what it
 * redefines and then extends the storage area, so the run has to grow by the
 * overhang. Counting nothing for it makes the record shorter here than the one
 * the emitter lays out, and a `renames` over such a run would name fewer bytes
 * than a group move actually touches.
 */
function declaredRunLength(fields: readonly ResolvedField[]): number {
  let offset = 0;
  /** Where the field currently being redefined starts. */
  let anchor = 0;

  for (const field of fields) {
    if (field.renames) {
      continue;
    }
    if (field.redefines) {
      offset = Math.max(offset, anchor + declaredByteLength(field.type));
      continue;
    }
    anchor = offset;
    offset += declaredByteLength(field.type);
  }

  return offset;
}

/**
 * `redefines` and `depending on`.
 *
 * A redefining field is a second reading of storage another field already
 * occupies, so it must name the area immediately before it. It may be longer:
 * COBOL then extends the storage area rather than overrunning it.
 *
 * `depending on` names the field holding how much of a table this record uses,
 * which must be a whole number declared before the table: COBOL reads it to
 * decide the record's length, and cannot read a field it has not reached.
 */
function validateVariantFields(
  declaration: RecordDeclarationNode,
  fields: ResolvedField[],
  diagnostics: Diagnostic[],
): void {
  /**
   * The area a `redefines` may name: the last field that took new storage,
   * plus every redefinition of it written since.
   *
   * COBOL requires the redefinitions of an area to follow its description with
   * nothing in between that defines new character positions, and allows each to
   * name either the original or the redefinition before it. Anything else names
   * an area that is no longer the one being described.
   */
  const redefinable = new Set<string>();

  fields.forEach((field, index) => {
    const earlier = fields.slice(0, index);

    if (field.redefines) {
      const target = earlier.find((entry) => entry.name === field.redefines);
      if (!target) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.name} redefines ${field.redefines}, which is not declared before it in ${declaration.name}.`,
            span: field.span,
            hint: "A redefining field re-reads storage that already exists, so the field it redefines has to come first.",
            backendProfile: null,
          }),
        );
      } else if (!redefinable.has(field.redefines)) {
        // Enterprise COBOL and GnuCOBOL both reject this outright — "REDEFINES
        // must follow the original definition". Left to itself the layout
        // reports the redefinition at the last field's offset instead of the
        // one it names, so the copybook describes the alternate reading at a
        // position the dataset does not have, and the compile fails anyway.
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.name} redefines ${field.redefines}, which is not the field immediately before it in ${declaration.name}.`,
            span: field.span,
            hint: "COBOL requires the redefinitions of an area to follow it with no field in between that takes storage of its own. Move the redefining field up to sit under what it redefines.",
            backendProfile: null,
          }),
        );
      } else if (target.type.kind === "array") {
        // A redefined item cannot carry OCCURS: the redefinition names one area
        // and a table is a repetition of one, so there is no single area to
        // alias. Redefine the group holding the table instead.
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.name} redefines ${target.name}, which is a table.`,
            span: field.span,
            hint: "COBOL forbids OCCURS on a redefined item. Redefine a field that is not a table, or wrap the table in a record and redefine that.",
            backendProfile: null,
          }),
        );
      }

      // A further redefinition may name this one, and every earlier reading of
      // the same area stays namable; a field that takes storage ends the run.
      redefinable.add(field.name);
    } else if (!field.renames) {
      redefinable.clear();
      redefinable.add(field.name);
    }

    // COBOL allows neither end of a redefinition to be variable length: the
    // area's size has to be known to lay out what follows it. GnuCOBOL rejects
    // it as "cannot be variable length"; the compiler used to emit
    // `REDEFINES ... OCCURS 1 TO n DEPENDING ON`, which no COBOL accepts.
    if (field.redefines && field.dependingOn) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-COPY-004",
          severity: "error",
          message: `${field.name} both redefines ${field.redefines} and depends on ${field.dependingOn}.`,
          span: field.span,
          hint: "A redefinition names a fixed area, so neither it nor what it redefines can vary in length.",
          backendProfile: null,
        }),
      );
    }

    if (field.dependingOn) {
      if (field.type.kind !== "array") {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.name} has a depending clause but is not a table.`,
            span: field.span,
            hint: "`depending on` says how much of a table is used, so it applies to a T[n] field.",
            backendProfile: null,
          }),
        );
      }

      const counter = earlier.find((entry) => entry.name === field.dependingOn);
      if (!counter) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.name} depends on ${field.dependingOn}, which is not declared before it in ${declaration.name}.`,
            span: field.span,
            hint: "COBOL reads the count to decide the record's length, and cannot read a field it has not reached.",
            backendProfile: null,
          }),
        );
      } else if (!isDecimalType(counter.type) || counter.type.scale !== 0) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${field.dependingOn} holds ${describeType(counter.type)}, which is not a count of entries.`,
            span: field.span,
            hint: "Declare it as binary<n> or decimal<n, 0>.",
            backendProfile: null,
          }),
        );
      }

      // Anything after the table is *variably located*: its position is the
      // start of the table plus the count times the entry, so it moves every
      // time the count does. The copybook and the layout report can only state
      // the offset it has when the table is full, which is an offset the
      // dataset does not have on any other record — and a copybook that names a
      // byte position nothing is at is worse than no copybook.
      //
      // IBM calls this complex ODO and permits it. GnuCOBOL refuses it outright
      // ("cannot have OCCURS DEPENDING because of ..."), so a program built
      // this way could not be executed locally either. The convention it stands
      // against is ordinary: a variable-length record ends with its table.
      const following = fields
        .slice(index + 1)
        .filter((entry) => !entry.renames && !entry.redefines);
      if (following.length > 0) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-COPY-004",
            severity: "error",
            message: `${following[0].name} follows ${field.name}, whose length depends on ${field.dependingOn}.`,
            span: following[0].span,
            hint: "A field after a table whose length varies moves with the count, so no copybook can give it an offset. Put the varying table last in the record.",
            backendProfile: null,
          }),
        );
      }
    }

    // JUSTIFIED reverses the padding on an alphanumeric MOVE. A number's
    // alignment is decided by its picture, so COBOL allows the clause only on
    // an alphanumeric item and rejects the program otherwise.
    if (field.justified && field.type.kind !== "string") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-COPY-005",
          severity: "error",
          message: `${field.name} holds ${describeType(field.type)}, which cannot be justified.`,
          span: field.span,
          hint: "`justified` right-aligns text. A number's alignment comes from its picture.",
          backendProfile: null,
        }),
      );
    }

    // BLANK WHEN ZERO is a rendering of a number, so there has to be one.
    if (
      field.blankWhenZero &&
      !isDecimalType(field.type) &&
      field.type.kind !== "currency" &&
      field.type.kind !== "edited"
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-COPY-005",
          severity: "error",
          message: `${field.name} holds ${describeType(field.type)}, which has no zero to blank.`,
          span: field.span,
          hint: "`blankWhenZero` applies to a number or an edited field.",
          backendProfile: null,
        }),
      );
    }

    // A national field is the one place this compiler emits a layout its own
    // validator does not agree with, so it says so rather than letting the
    // evidence imply a check that did not happen.
    if (field.type.kind === "string" && field.type.national) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-024",
          severity: "warning",
          message: `${field.name} is national, so its layout cannot be checked locally.`,
          span: field.span,
          hint: "Enterprise COBOL holds a national character in two bytes (UTF-16), which is the width reported here. GnuCOBOL 3.2.0 allocates four inside a group and warns that its USAGE NATIONAL handling is unfinished, so every field after this one sits at a different offset there. Verify the record on z/OS before relying on it — see zos/README.md.",
          backendProfile: "ibm-enterprise-cobol-zos",
        }),
      );
    }
  });
}

/**
 * Instantiates `Box<Money>` into a concrete record named `Box$dec18_2`.
 *
 * The instantiation is memoised on the mangled name, so two references to the
 * same instantiation share one record and one COBOL group rather than emitting
 * duplicate storage under different names.
 */
function instantiateGenericRecord(
  node: TypeReferenceNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): ResolvedType | null {
  const generic = genericRecords.get(node.name);
  if (!generic) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-019",
        severity: "error",
        message: `${node.name} is not generic, so it takes no type arguments.`,
        span,
        hint: `Write ${node.name} without a type argument list.`,
        backendProfile: null,
      }),
    );
    return null;
  }

  if (node.typeArguments.length !== generic.typeParameters.length) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-018",
        severity: "error",
        message: `${node.name} expects ${generic.typeParameters.length} type argument(s) but received ${node.typeArguments.length}.`,
        span,
        hint: `Declared as ${node.name}<${generic.typeParameters.map((parameter) => parameter.name).join(", ")}>.`,
        backendProfile: null,
      }),
    );
    return null;
  }

  // Type arguments are normalised through the resolver before they name an
  // instantiation, so `Slot<BDT>` and `Slot<currency<"BDT", 18, 2>>` are one
  // record rather than two identical ones under different names.
  const normalized: TypeNode[] = [];
  for (const argument of node.typeArguments) {
    const resolvedArgument = resolveTypeNode(
      argument,
      aliases,
      recordMap,
      diagnostics,
      span,
    );
    if (!resolvedArgument) {
      return null;
    }
    const normalizedNode = typeToTypeNode(resolvedArgument, argument.span);
    if (!normalizedNode) {
      return null;
    }
    normalized.push(normalizedNode);
  }

  const mangled = mangleInstantiation(node.name, normalized);
  const existing = recordMap.get(mangled);
  if (existing) {
    return {
      kind: "record",
      name: existing.name,
      span: existing.span,
      fields: existing.fields,
    };
  }

  const substitution = new Map<string, TypeNode>();
  generic.typeParameters.forEach((parameter, index) => {
    substitution.set(parameter.name, normalized[index]);
  });

  const declaration = instantiateRecord(generic, substitution, mangled);

  // Registered before its fields resolve so a self-referential instantiation
  // is caught as a cycle rather than expanding forever.
  pendingRecordDeclarations.set(mangled, declaration);

  const resolved = ensureRecordResolved(
    mangled,
    aliases,
    recordMap,
    diagnostics,
    span,
    [],
  );
  if (!resolved) {
    return null;
  }

  return {
    kind: "record",
    name: resolved.name,
    span: resolved.span,
    fields: resolved.fields,
  };
}

function resolveBaseRecord(
  baseType: TypeReferenceNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  inProgress: string[],
): ResolvedRecord | null {
  const baseName =
    baseType.typeArguments.length > 0
      ? mangleInstantiation(baseType.name, baseType.typeArguments)
      : baseType.name;

  if (baseType.typeArguments.length > 0) {
    const instantiated = resolveTypeNode(
      baseType,
      aliases,
      recordMap,
      diagnostics,
      baseType.span,
    );
    if (instantiated?.kind === "record") {
      return recordMap.get(instantiated.name) ?? null;
    }
    return null;
  }

  const resolved = ensureRecordResolved(
    baseName,
    aliases,
    recordMap,
    diagnostics,
    baseType.span,
    inProgress,
  );
  if (resolved) {
    return resolved;
  }

  if (!recordMap.has(baseName) && !pendingRecordDeclarations.has(baseName)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Unresolved base record: ${baseType.name}.`,
        span: baseType.span,
        hint: "A record can only extend another record declared in this module.",
        backendProfile: null,
      }),
    );
  }
  return null;
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
  sqlCodeFailureTested = false;
  sensitiveLocals = new Set();
  checkpointSeen = false;
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
    isNested: declaration.isNested,
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

/**
 * True for `if <condition> { ... raise "..."; }` with no else branch.
 *
 * The then-branch has to end in a raise for this to be a guard: if it could
 * fall through, the statements after it would run in both cases and the `if`
 * would need an else to say what the function returns.
 */
function isGuardClause(statement: StatementNode): statement is IfStatementNode {
  return (
    statement.kind === "IfStatement" &&
    statement.elseBranch === null &&
    blockAlwaysRaises(statement.thenBranch)
  );
}

/** True when every path out of a block raises. */
function blockAlwaysRaises(block: BlockNode): boolean {
  const last = block.statements[block.statements.length - 1];
  if (!last) {
    return false;
  }

  if (last.kind === "RaiseStatement") {
    return true;
  }

  if (last.kind === "IfStatement") {
    return (
      blockAlwaysRaises(last.thenBranch) &&
      last.elseBranch !== null &&
      blockAlwaysRaises(last.elseBranch)
    );
  }

  return false;
}

function validateGuardClause(
  statement: IfStatementNode,
  returnType: ResolvedType,
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
        hint: "Compare a decimal expression or use a bool value in the condition.",
        backendProfile: null,
      }),
    );
  }

  const previousGuards = guardedNullables;
  const guards = new Set(previousGuards);
  collectGuards(statement.condition, guards);
  guardedNullables = guards;
  validateBlock(
    statement.thenBranch,
    returnType,
    scope,
    aliases,
    recordMap,
    locals,
    diagnostics,
  );
  guardedNullables = previousGuards;
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

    // A guard clause — `if <bad> { raise "..."; }` with no else — reads as a
    // precondition, not as a branch that has to produce a value. The block
    // continues after it, because control only reaches the next statement when
    // the guard did not fire.
    if (isGuardClause(statement)) {
      validateGuardClause(
        statement,
        returnType,
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
    case "CursorLoopStatement":
    case "UnitOfWorkStatement":
    case "ReturnCodeStatement":
    case "SplitStatement":
    case "DliStatement":
    case "QueueStatement":
    case "SerializeStatement":
    case "XmlParseStatement":
    case "ReportStatement":
    case "ProgramCallStatement":
    case "SortStatement":
    case "ReleaseStatement":
    case "CheckpointStatement":
    case "RestartStatement":
    case "ConsoleStatement":
    case "ResetStatement":
    case "SearchStatement":
      // Effect statements are validated by validateBlock before the terminal
      // statement is resolved, so nothing further is needed here.
      return null;
    case "RaiseStatement":
      // A raise abandons the body, so control never reaches the end of the
      // function and the missing return is not a defect. Reporting the declared
      // type here is what lets `if ... { return x; } else { raise "..."; }`
      // satisfy the terminal-statement rule.
      validateRaiseStatement(statement, diagnostics);
      return returnType;
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

  // A local initialised from restricted data carries it onward, so the checks
  // that matter downstream can follow it.
  if (isSensitiveExpression(statement.expression, scope)) {
    sensitiveLocals.add(statement.name);
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
    case "StringCall":
      return inferStringCall(
        expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
    case "NumericCall":
      return inferNumericCall(
        expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
    case "TemporalCall":
      return inferTemporalCall(
        expression,
        scope,
        aliases,
        recordMap,
        diagnostics,
      );
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

/** Declared reports, for resolving initiate, generate, and terminate. */
let declaredReports = new Map<string, ResolvedReport>();

/**
 * Reports a `replaceSegment` or `deleteSegment` with no get-hold before it.
 *
 * DL/I will not update a segment the program has not held. `REPL` or `DLET`
 * after a plain `getUnique` comes back `DJ` — no preceding get-hold — and the
 * update silently does not happen, because the status is the only thing that
 * says so.
 *
 * A hold earlier in an enclosing block covers a branch inside it, because every
 * path through the branch has already passed the hold. A hold *inside* a branch
 * does not travel back out, because the path that skipped the branch reaches
 * the update unheld — which is the case worth catching.
 */
function reportUnheldDliUpdates(
  program: ProgramNode,
  diagnostics: Diagnostic[],
): void {
  const walk = (block: BlockNode, enclosing: ReadonlySet<string>): void => {
    const held = new Set(enclosing);
    for (const statement of block.statements) {
      if (statement.kind === "DliStatement") {
        if (
          statement.operation === "getHoldUnique" ||
          statement.operation === "getHoldNext"
        ) {
          held.add(statement.databaseName);
        }
        if (
          (statement.operation === "replaceSegment" ||
            statement.operation === "deleteSegment") &&
          !held.has(statement.databaseName)
        ) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-DLI-002",
              severity: "error",
              message: `${statement.operation} on ${statement.databaseName} is not preceded by a get-hold.`,
              span: statement.span,
              hint: "DL/I will not update a segment the program has not held: it answers `DJ` and the update does not happen. Read it with `getHoldUnique` or `getHoldNext` first.",
              backendProfile: "ibm-enterprise-cobol-zos",
            }),
          );
        }
      }

      for (const nested of [
        (statement as { body?: BlockNode }).body,
        (statement as { notFound?: BlockNode }).notFound,
        (statement as { thenBranch?: BlockNode }).thenBranch,
        (statement as { elseBranch?: BlockNode | null }).elseBranch,
        (statement as { onError?: BlockNode | null }).onError,
        (statement as { resumed?: BlockNode }).resumed,
        (statement as { fresh?: BlockNode | null }).fresh,
      ]) {
        if (nested) {
          walk(nested, held);
        }
      }
    }
  };

  for (const declaration of program.declarations) {
    if (
      declaration.kind === "TransactionDeclaration" ||
      declaration.kind === "FunctionDeclaration"
    ) {
      walk(declaration.body, new Set());
    }
  }
}

/**
 * `rewrite` and `delete` on a file the program reads sequentially.
 *
 * Both replace the record the last `read` returned, so on a sequentially
 * accessed file they need one: without it the operation is not performed and
 * the status is 92 — no abend, no exception, and a program that does not test
 * the status carries on believing it updated something.
 *
 * Only sequential and relative files, because those are the ones the backend
 * gives `ACCESS MODE IS SEQUENTIAL`. An indexed file is `DYNAMIC`, where the
 * record key in the record area says which record is meant and no prior read is
 * required.
 *
 * The same shape as the DL/I hold rule, and for the same reason: a read in an
 * enclosing block covers a branch inside it, but a read inside a branch does
 * not travel back out, because the path that skipped it reaches the update with
 * nothing read.
 */
function reportUnreadFileUpdates(
  program: ProgramNode,
  diagnostics: Diagnostic[],
): void {
  const sequentiallyAccessed = new Set(
    [...declaredFiles.values()]
      .filter((file) => file.organization !== "indexed")
      .map((file) => file.name),
  );

  const walk = (block: BlockNode, enclosing: ReadonlySet<string>): void => {
    const read = new Set(enclosing);
    for (const statement of block.statements) {
      if (statement.kind === "FileStatement") {
        if (
          statement.operation === "read" ||
          statement.operation === "readNext"
        ) {
          read.add(statement.fileName);
        }
        if (
          (statement.operation === "rewrite" ||
            statement.operation === "delete") &&
          sequentiallyAccessed.has(statement.fileName) &&
          !read.has(statement.fileName)
        ) {
          diagnostics.push(
            createDiagnostic({
              id: "BANK-FILE-010",
              severity: "error",
              message: `${statement.operation} on ${statement.fileName} is not preceded by a read.`,
              span: statement.span,
              hint: `${statement.operation} replaces the record the last read returned, and ${statement.fileName} is accessed sequentially. Without a read the operation does not happen and the status is 92. Read the record first.`,
              backendProfile: "ibm-enterprise-cobol-zos",
            }),
          );
        }
      }

      for (const nested of nestedBlocksOf(statement)) {
        walk(nested, read);
      }
    }
  };

  for (const declaration of program.declarations) {
    if (
      declaration.kind === "TransactionDeclaration" ||
      declaration.kind === "FunctionDeclaration"
    ) {
      walk(declaration.body, new Set());
    }
  }
}

/** Declared databases, for resolving DL/I statements. */
let declaredDatabases = new Map<string, ResolvedDatabase>();

/**
 * Resolves a `database` declaration.
 *
 * The names of the segment and its key belong to the DBD rather than to this
 * program, so all the compiler can check is that they are the length DL/I
 * allows: a search argument carries eight bytes of name, and a longer one is
 * truncated into a name that matches nothing.
 */
function resolveDatabase(
  declaration: DatabaseDeclarationNode,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedDatabase | null {
  const record = recordMap.get(declaration.recordTypeName);
  if (!record) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Database ${declaration.name} holds ${declaration.recordTypeName}, which is not a declared record.`,
        span: declaration.span,
        hint: "Declare the segment's record before the database that holds it.",
        backendProfile: null,
      }),
    );
    return null;
  }

  for (const [what, value] of [
    ["segment", declaration.segmentName],
    ["key", declaration.keyName],
  ] as const) {
    if (value.length === 0 || value.length > 8) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DLI-001",
          severity: "error",
          message: `The ${what} name "${value}" is ${value.length} characters; DL/I allows eight.`,
          span: declaration.span,
          hint: "A search argument carries eight bytes of name. A longer one is truncated into a name that matches nothing in the DBD.",
          backendProfile: "ibm-enterprise-cobol-zos",
        }),
      );
      return null;
    }
  }

  return {
    name: declaration.name,
    span: declaration.span,
    segmentName: declaration.segmentName,
    keyName: declaration.keyName,
    record,
    statusName: declaration.statusName,
  };
}

/** Declared queues, for resolving MQ statements. */
let declaredQueues = new Map<string, ResolvedQueue>();

/**
 * Characters MQ carries in a queue manager name and in a queue name.
 *
 * `MQ_Q_MGR_NAME_LENGTH` and `MQ_Q_NAME_LENGTH` are both 48, and both are what
 * `MQOD-OBJECTNAME` and the `MQCONN` name parameter are declared as. A longer
 * one is truncated into a name the queue manager has never heard of.
 */
const MQ_NAME_LENGTH = 48;

/**
 * Resolves a `queue` declaration.
 *
 * The manager and queue names belong to MQ rather than to this program, so all
 * the compiler can check is that they fit what the MQI carries.
 */
function resolveQueue(
  declaration: QueueDeclarationNode,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedQueue | null {
  const record = recordMap.get(declaration.recordTypeName);
  if (!record) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-001",
        severity: "error",
        message: `Queue ${declaration.name} carries ${declaration.recordTypeName}, which is not a declared record.`,
        span: declaration.span,
        hint: "Declare the message's record before the queue that carries it.",
        backendProfile: null,
      }),
    );
    return null;
  }

  for (const [what, value] of [
    ["queue manager", declaration.managerName],
    ["queue", declaration.queueName],
  ] as const) {
    if (value.length === 0 || value.length > MQ_NAME_LENGTH) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-MQ-001",
          severity: "error",
          message: `The ${what} name "${value}" is ${value.length} characters; MQ carries ${MQ_NAME_LENGTH}.`,
          span: declaration.span,
          hint: "`MQ_Q_MGR_NAME_LENGTH` and `MQ_Q_NAME_LENGTH` are both 48. A longer name is truncated into one the queue manager does not have.",
          backendProfile: "ibm-enterprise-cobol-zos",
        }),
      );
      return null;
    }
  }

  return {
    name: declaration.name,
    span: declaration.span,
    managerName: declaration.managerName,
    queueName: declaration.queueName,
    direction: declaration.direction,
    record,
    statusName: declaration.statusName,
  };
}

/**
 * `connectQueue q;` `putMessage q from r;` `getMessage q into r { } else { }`
 *
 * The completion code and reason code the MQI leaves are the entire error
 * model, so a queue with nowhere to read them from is a program that cannot
 * tell a message it got from an empty queue — and an empty queue is the
 * ordinary end of a drain loop, not a failure.
 *
 * The direction on the declaration decides which calls are allowed, because it
 * is what the `MQOPEN` asked for: a queue opened `MQOO-OUTPUT` cannot be read,
 * and MQ reports that at run time as reason 2037, `MQRC-NOT-OPEN-FOR-INPUT`.
 */
function validateQueueStatement(
  statement: QueueStatementNode,
  scope: Map<string, ResolvedType>,
  diagnostics: Diagnostic[],
): void {
  const queue = declaredQueues.get(statement.queueName);
  if (!queue) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-MQ-001",
        severity: "error",
        message: `${statement.queueName} is not a declared queue.`,
        span: statement.queueSpan,
        hint: 'Declare it with `queue <name> manager "MGR" name "Q.NAME" output record <Record> status <field>;`.',
        backendProfile: null,
      }),
    );
    return;
  }

  if (!queue.statusName) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-MQ-001",
        severity: "error",
        message: `Queue ${queue.name} declares no status field.`,
        span: statement.span,
        hint: "MQ reports what happened in a completion code and a reason code. Without somewhere to read them, a `getMessage` that found an empty queue is indistinguishable from one that read a message.",
        backendProfile: null,
      }),
    );
  }

  if (statement.operation === "get" && queue.direction !== "input") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-MQ-002",
        severity: "error",
        message: `${queue.name} is an output queue, so it cannot be read.`,
        span: statement.span,
        hint: "An `output` queue is opened with `MQOO-OUTPUT`. Reading one fails at run time with reason 2037, MQRC-NOT-OPEN-FOR-INPUT.",
        backendProfile: null,
      }),
    );
  }

  if (statement.operation === "put" && queue.direction !== "output") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-MQ-002",
        severity: "error",
        message: `${queue.name} is an input queue, so nothing can be put on it.`,
        span: statement.span,
        hint: "An `input` queue is opened with `MQOO-INPUT-AS-Q-DEF`. Putting to one fails at run time with reason 2039, MQRC-NOT-OPEN-FOR-OUTPUT.",
        backendProfile: null,
      }),
    );
  }

  if (statement.recordName && statement.recordSpan) {
    const record = scope.get(statement.recordName);
    if (!record) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `${statement.recordName} is not declared.`,
          span: statement.recordSpan,
          hint: "Name a record variable the message is read into or built from.",
          backendProfile: null,
        }),
      );
    } else if (record.kind !== "record" || record.name !== queue.record.name) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-MQ-002",
          severity: "error",
          message: `${statement.recordName} holds ${describeType(record)}, but ${queue.name} carries ${queue.record.name}.`,
          span: statement.recordSpan,
          hint: "The message buffer is the shape the queue declares, so it has to be that record.",
          backendProfile: null,
        }),
      );
    }
  }
}

/**
 * `getUnique <db> into <record> key <value>;` and the rest.
 *
 * The status DL/I leaves in the PCB is the entire error model, so a database
 * with nowhere to read it from is a program that cannot tell a segment it found
 * from one it did not — which, for a `getUnique` that missed, means working on
 * whatever the segment area held last.
 */
function validateDliStatement(
  statement: DliStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const database = declaredDatabases.get(statement.databaseName);
  if (!database) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-DLI-001",
        severity: "error",
        message: `${statement.databaseName} is not a declared database.`,
        span: statement.databaseSpan,
        hint: 'Declare it with `database <name> pcb segment "SEG" key "KEY" record <Record> status <field>;`.',
        backendProfile: null,
      }),
    );
    return;
  }

  if (!database.statusName) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-DLI-001",
        severity: "error",
        message: `Database ${database.name} declares no status field.`,
        span: statement.span,
        hint: "DL/I reports what happened in the PCB status: spaces worked, `GE` found nothing, `GB` reached the end. Without somewhere to read it, a read that found nothing is indistinguishable from one that worked.",
        backendProfile: null,
      }),
    );
  }

  if (statement.recordName && statement.recordSpan) {
    const record = scope.get(statement.recordName);
    if (!record) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-001",
          severity: "error",
          message: `${statement.recordName} is not declared.`,
          span: statement.recordSpan,
          hint: "Name a record variable the segment is read into or written from.",
          backendProfile: null,
        }),
      );
    } else if (
      record.kind !== "record" ||
      record.name !== database.record.name
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DLI-001",
          severity: "error",
          message: `${statement.recordName} holds ${describeType(record)}, but ${database.name} holds ${database.record.name}.`,
          span: statement.recordSpan,
          hint: "The segment area is the shape the DBD describes, so it has to be the record the database declares.",
          backendProfile: null,
        }),
      );
    }
  }

  if (statement.key) {
    const key = inferExpressionType(
      statement.key,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    if (key && key.kind !== "string") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-DLI-001",
          severity: "error",
          message: `A DL/I key is text; this one is ${describeType(key)}.`,
          span: statement.key.span,
          hint: "A search argument compares bytes, so the key is moved into the argument as characters. Convert a number first.",
          backendProfile: null,
        }),
      );
    }
  }
}

/**
 * Resolves a `report` declaration against the file it writes to.
 *
 * The checks are the ones that decide whether the generated COBOL means
 * anything: the file has to exist and be written rather than read, a control
 * field has to be a field of its record, and a `generate` has to have a detail
 * group to name. The rest of the report — where a column sits, how deep a page
 * is — is COBOL's own business once the names resolve.
 */
function resolveReport(
  declaration: ReportDeclarationNode,
  diagnostics: Diagnostic[],
): ResolvedReport | null {
  const file = declaredFiles.get(declaration.fileName);
  if (!file) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-002",
        severity: "error",
        message: `Report ${declaration.name} is written to ${declaration.fileName}, which is not declared.`,
        span: declaration.fileSpan,
        hint: "Declare the file first; a report is a description of what goes into one.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (file.mode !== "output" || file.organization !== "sequential") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-007",
        severity: "error",
        message: `Report ${declaration.name} is written to ${file.name}, which is a ${file.organization} ${file.mode} file.`,
        span: declaration.fileSpan,
        hint: "A report is printed, so its file is `sequential output`.",
        backendProfile: null,
      }),
    );
  }

  // A file cannot carry a LINAGE page and a report at once: both decide where
  // the page ends, and COBOL rejects the FD that says so twice.
  if (file.linage) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-007",
        severity: "error",
        message: `${file.name} declares a page depth and also carries report ${declaration.name}.`,
        span: declaration.fileSpan,
        hint: "A report counts the lines itself. Drop the `page ...` clause from the file and declare the depth on the report.",
        backendProfile: null,
      }),
    );
  }

  for (const control of declaration.controls) {
    if (!file.record.fields.some((field) => field.name === control.name)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-008",
          severity: "error",
          message: `Control field ${control.name} is not a field of ${file.record.name}.`,
          span: control.span,
          hint: "A control break is a change in the record the report prints, so the field has to be in that record.",
          backendProfile: null,
        }),
      );
    }
  }

  const declaredControls = new Set(
    declaration.controls.map((control) => control.name),
  );
  const detailNames: string[] = [];
  for (const group of declaration.groups) {
    if (group.type === "detail") {
      if (!group.name) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-008",
            severity: "error",
            message: `A detail group in report ${declaration.name} has no name.`,
            span: group.span,
            hint: "`generate` names the group it prints, so it needs one: `detail statementLine { ... }`.",
            backendProfile: null,
          }),
        );
        continue;
      }
      detailNames.push(group.name);
      continue;
    }

    // A control heading or footing has to name a control the report breaks on,
    // or nothing, which means FINAL.
    if (
      (group.type === "controlHeading" || group.type === "controlFooting") &&
      group.control &&
      !declaredControls.has(group.control)
    ) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-008",
          severity: "error",
          message: `${group.type} names ${group.control}, which report ${declaration.name} does not control on.`,
          span: group.span,
          hint: `Add it to the report's \`control\` list, or leave the name off for the final total.`,
          backendProfile: null,
        }),
      );
    }

    validateReportSums(group, declaration, file.record.fields, diagnostics);
  }

  if (detailNames.length === 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-008",
        severity: "error",
        message: `Report ${declaration.name} has no detail group.`,
        span: declaration.span,
        hint: "A report with nothing to generate prints its headings and stops. Add `detail <name> { ... }`.",
        backendProfile: null,
      }),
    );
  }

  return {
    name: declaration.name,
    span: declaration.span,
    file,
    controls: declaration.controls.map((control) => control.name),
    page: declaration.page,
    groups: declaration.groups,
    detailNames,
  };
}

/**
 * The COBOL literal a `VALUE` clause carries, or a diagnostic saying why there
 * is none.
 *
 * COBOL evaluates `VALUE` when it compiles, so the initial value has to be
 * something the compiler can see: a written number, a written string, a boolean,
 * or an enum member. Anything computed belongs in the program, where it can be.
 *
 * A `REDEFINES` field is refused outright. It has no storage of its own — it is
 * a second reading of another field's bytes — so a VALUE on it would either be
 * ignored or overwrite a value that field set, and neither is what was meant.
 */
function resolveInitialValue(
  field: FieldDeclarationNode,
  type: ResolvedType,
  diagnostics: Diagnostic[],
): string | null {
  const expression = field.initialValue;
  if (!expression) {
    return null;
  }

  const reject = (message: string, hint: string): null => {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-COPY-006",
        severity: "error",
        message,
        span: expression.span,
        hint,
        backendProfile: null,
      }),
    );
    return null;
  };

  if (field.redefines) {
    return reject(
      `${field.name} redefines ${field.redefines}, so it has no storage of its own to initialise.`,
      "Put the initial value on the field being redefined, which is where the bytes are.",
    );
  }

  switch (expression.kind) {
    case "DecimalLiteral": {
      if (!isDecimalType(type) && type.kind !== "currency") {
        return reject(
          `${field.name} holds ${describeType(type)}, which cannot start as a number.`,
          "Give the field a literal of its own type.",
        );
      }
      return expression.text;
    }
    case "StringLiteral": {
      if (type.kind !== "string") {
        return reject(
          `${field.name} holds ${describeType(type)}, which cannot start as text.`,
          "Give the field a literal of its own type.",
        );
      }
      if (expression.value.length > type.length) {
        return reject(
          `${field.name} starts as ${expression.value.length} characters but holds ${type.length}.`,
          "A VALUE longer than the field is truncated silently, so COBOL rejects it instead.",
        );
      }
      return `"${expression.value}"`;
    }
    case "BooleanLiteral": {
      if (type.kind !== "bool") {
        return reject(
          `${field.name} holds ${describeType(type)}, which cannot start as a boolean.`,
          "Give the field a literal of its own type.",
        );
      }
      // A bool is PIC X holding Y or N, which is what the emitter already reads.
      return expression.value ? `"Y"` : `"N"`;
    }
    // `Status.OPEN` parses as a member access; which enum it names is not known
    // until the type is resolved, which is here.
    case "MemberAccess": {
      if (type.kind !== "enum") {
        return reject(
          `${field.name} holds ${describeType(type)}, which cannot start as an enum member.`,
          "Give the field a literal of its own type.",
        );
      }
      if (
        expression.target.kind !== "Identifier" ||
        expression.target.name !== type.name
      ) {
        return reject(
          `${field.name} holds ${type.name}, so its initial value has to be one of its members.`,
          `Write \`${type.name}.${type.members[0] ?? "MEMBER"}\`.`,
        );
      }
      if (!type.members.includes(expression.member)) {
        return reject(
          `${type.name} has no member ${expression.member}.`,
          `Its members are ${type.members.join(", ")}.`,
        );
      }
      return `"${expression.member}"`;
    }
    case "EnumMember": {
      if (type.kind !== "enum") {
        return reject(
          `${field.name} holds ${describeType(type)}, which cannot start as an enum member.`,
          "Give the field a literal of its own type.",
        );
      }
      if (expression.enumName !== type.name) {
        return reject(
          `${field.name} holds ${type.name} but starts as a member of ${expression.enumName}.`,
          "Name a member of the field's own enum.",
        );
      }
      if (!type.members.includes(expression.member)) {
        return reject(
          `${type.name} has no member ${expression.member}.`,
          `Its members are ${type.members.join(", ")}.`,
        );
      }
      return `"${expression.member}"`;
    }
    default:
      return reject(
        `${field.name} starts as something the compiler cannot evaluate.`,
        "COBOL works a VALUE out when it compiles, so it has to be a written number, string, boolean, or enum member.",
      );
  }
}

/**
 * Where a `sum` may appear, and what it may total.
 *
 * Report Writer itself allows a SUM clause in a group of any type, including a
 * heading, where the total is whatever had accumulated when the heading was
 * printed. banklang is deliberately narrower: a total read before the details it
 * covers is a number nobody can check, so `sum` is confined to the footings,
 * where it means what a reader takes it to mean. That is a banklang rule, not a
 * COBOL one, and the diagnostic says so.
 *
 * What COBOL does require is that the thing totalled be numeric. A report field
 * is printed through an edited picture, but the item it accumulates has to be
 * something `ADD` accepts — so a `string` cannot be totalled, and neither can
 * an already-edited field, which is a display form rather than a number.
 */
function validateReportSums(
  group: ReportGroupNode,
  declaration: ReportDeclarationNode,
  recordFields: ResolvedField[],
  diagnostics: Diagnostic[],
): void {
  const totallable =
    group.type === "controlFooting" || group.type === "pageFooting";

  for (const line of group.lines) {
    for (const column of line.columns) {
      const source = column.source;
      if (source.kind !== "ReportSum") {
        continue;
      }

      if (!totallable) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-008",
            severity: "error",
            message: `A ${group.type} in report ${declaration.name} totals a field, but nothing has been counted yet.`,
            span: column.span,
            hint: "banklang confines `sum` to a controlFooting or a pageFooting. Report Writer would accept it here and print whatever had accumulated so far, which is a figure that cannot be checked against the lines above it.",
            backendProfile: null,
          }),
        );
        continue;
      }

      const field = recordFields.find((entry) => entry.name === source.field);
      if (
        field &&
        field.type.kind !== "decimal" &&
        field.type.kind !== "currency"
      ) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-FILE-008",
            severity: "error",
            message: `Report ${declaration.name} totals ${source.field}, which is ${describeType(field.type)}.`,
            span: column.span,
            hint: "`sum` accumulates with COBOL's ADD, so it totals a numeric field — a decimal or a currency amount.",
            backendProfile: null,
          }),
        );
      }
    }
  }
}

/**
 * `call <name> using <record> on error { ... };` and `cancel <name>;`
 *
 * The program name is a value, so the only thing the compiler can check is that
 * it is text short enough to be one: a COBOL load module name is eight
 * characters, and a longer field would be truncated to something that does not
 * exist. What it cannot check is whether the module is there — that is the
 * whole nature of a dynamic call, and the reason `on error` matters.
 */
function validateProgramCallStatement(
  statement: ProgramCallStatementNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): void {
  const program = inferExpressionType(
    statement.program,
    scope,
    aliases,
    recordMap,
    diagnostics,
  );
  if (program && (program.kind !== "string" || program.national)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-029",
        severity: "error",
        message: `${statement.operation} names a program with ${describeType(program)}; a program is named by text.`,
        span: statement.program.span,
        hint: "Pass a string<n> field holding the load module name, or write the name as a literal.",
        backendProfile: null,
      }),
    );
  } else if (
    program?.kind === "string" &&
    !program.literal &&
    program.length > 8
  ) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-029",
        severity: "error",
        message: `A load module name is eight characters; this field holds ${program.length}.`,
        span: statement.program.span,
        hint: "Declare the field as string<8>. A longer one is truncated to a name that does not exist, and the failure arrives as a missing module rather than as a length.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }

  if (statement.using) {
    const record = inferExpressionType(
      statement.using,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
    if (record && record.kind !== "record") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-029",
          severity: "error",
          message: `call hands over ${describeType(record)}; it hands over a record.`,
          span: statement.using.span,
          hint: "The callee reads it through its own LINKAGE SECTION, which describes a group.",
          backendProfile: null,
        }),
      );
    }
  }

  // A dynamic call that cannot find its module abends. A static one fails at
  // link time where somebody sees it; this one fails in the middle of a batch.
  if (statement.operation === "call" && !statement.onError) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-029",
        severity: "warning",
        message: "This call has no failure path.",
        span: statement.span,
        hint: "A dynamic call names its module at run time, so a missing one is found in the middle of the batch rather than at link time. Add `on error { ... }` to turn an abend into a rejected record.",
        backendProfile: null,
      }),
    );
  }
}

/** `initiate <report>;`, `generate <detail>;`, `terminate <report>;`. */
function validateReportStatement(
  statement: ReportStatementNode,
  diagnostics: Diagnostic[],
): void {
  if (statement.operation === "generate") {
    const owner = [...declaredReports.values()].find((report) =>
      report.detailNames.includes(statement.target),
    );
    if (!owner) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-008",
          severity: "error",
          message: `${statement.target} is not a detail group of any report.`,
          span: statement.targetSpan,
          hint: "`generate` prints a detail group. Name one a report declares.",
          backendProfile: null,
        }),
      );
    }
    return;
  }

  if (!declaredReports.has(statement.target)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-FILE-008",
        severity: "error",
        message: `${statement.target} is not a declared report.`,
        span: statement.targetSpan,
        hint: `\`${statement.operation}\` names the report itself, not a group in it.`,
        backendProfile: null,
      }),
    );
  }
}

/** Declared enums, for resolving member references and switch cases. */
let enumMap = new Map<string, ResolvedEnum>();

/** Declared SQL statements, for resolving execute statements. */
let sqlMap = new Map<string, ResolvedSql>();

/** Generic templates, indexed by name. These are never resolved directly. */
let genericRecords = new Map<string, RecordDeclarationNode>();
let genericFunctions = new Map<string, FunctionDeclarationNode>();

/** Non-generic record declarations, for resolving a base declared later. */
let pendingRecordDeclarations = new Map<string, RecordDeclarationNode>();

/** Function instantiations requested by a call site but not yet checked. */
interface InstantiationRequest {
  declaration: FunctionDeclarationNode;
  span: SourceSpan;
}
let pendingInstantiations = new Map<string, InstantiationRequest>();

/** Generic function names that at least one call site instantiated. */
let instantiatedFunctions = new Set<string>();

/**
 * The concrete function each generic call resolves to.
 *
 * Keyed by node identity because the same call text can appear in two
 * instantiations of one generic body at different type arguments.
 */
let callTargets = new Map<CallExpressionNode, string>();

/** The base record each derived record extends, for assignability checks. */
let recordBases = new Map<string, string>();

/**
 * The list every newly resolved record is appended to.
 *
 * Records are resolved on demand rather than in declaration order, because a
 * field or a base clause can name a record declared further down the file, and
 * a generic instantiation creates a record that was never declared at all.
 */
let recordSink: ResolvedRecord[] = [];

/**
 * Whether the body being checked runs SQL, and whether it tests SQLCODE.
 *
 * An unchecked SQLCODE is the classic embedded-SQL defect: a row that was not
 * found looks identical to a row that was.
 */
let sqlExecuted = false;
let sqlCodeTested = false;

/**
 * Whether any test in the body can tell a Db2 error from a row that was absent.
 *
 * `+100` is the only "not found". Negative is an error: `-911` is a deadlock the
 * thread lost, `-904` a resource that was not available, `-805` a package that
 * was never bound. A body whose only test is `sqlcode == 0` turns every one of
 * those into the else branch — and in an enquiry that else branch says the
 * account does not exist, which is a customer-facing lie, and behind a posting
 * decision it is an incident.
 *
 * A test separates them when it orders `sqlcode` against a value — `< 0`,
 * `> 0`, `>= 0` — or compares it for equality against a negative literal.
 * `sqlcode != 0` does not: it puts `+100` and `-911` on the same side.
 */
let sqlCodeFailureTested = false;

/**
 * Refuses a CICS response compared against a number CICS never named.
 *
 * The API Reference gives one value a name a program may write: a normal return
 * is `DFHRESP(NORMAL)`, and `DFHRESP` is a translator built-in that resolves
 * the rest. The numbers behind the other conditions are the translator's, not
 * the API's — nothing in the manual promises them — so a program comparing a
 * response against `27` has hard-coded something it was never given, and it
 * reads to a CICS reviewer as somebody who has not seen `DFHRESP` before.
 *
 * Zero is allowed and generates `DFHRESP(NORMAL)`. Anything else is refused
 * rather than guessed at.
 */
function checkCicsResponseComparison(
  expression: BinaryExpressionNode,
  diagnostics: Diagnostic[],
): void {
  if (expression.operator !== "==" && expression.operator !== "!=") {
    return;
  }
  const sides = [expression.left, expression.right];
  const names = sides.map((side) =>
    side.kind === "Identifier" ? side.name : null,
  );
  const index = names.findIndex(
    (name) => name !== null && cicsRespCaptured.has(name),
  );
  if (index === -1) {
    return;
  }
  const other = sides[index === 0 ? 1 : 0];
  if (other.kind !== "DecimalLiteral" || Number(other.text) === 0) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      id: "BANK-CICS-004",
      severity: "error",
      message: `A CICS response is compared against ${other.text}, which is not a value CICS gives a name to.`,
      span: expression.span,
      hint: "Test `== 0`, which generates `DFHRESP(NORMAL)`. The numbers behind the other conditions belong to the translator rather than to the API, so a program that writes one has hard-coded something CICS never promised.",
      backendProfile: null,
    }),
  );
}

/** Records what a comparison involving `sqlcode` is able to distinguish. */
function noteSqlCodeComparison(expression: BinaryExpressionNode): void {
  const sides = [expression.left, expression.right];
  const names = sides.map((side) =>
    side.kind === "Identifier" ? side.name : null,
  );
  if (!names.includes("sqlcode")) {
    return;
  }

  if (["<", "<=", ">", ">="].includes(expression.operator)) {
    sqlCodeFailureTested = true;
    return;
  }
  if (expression.operator !== "==" && expression.operator !== "!=") {
    return;
  }
  // An equality against a negative literal names one error, which is a
  // deliberate decision about that error rather than a collapse of all of them.
  const other = sides[names[0] === "sqlcode" ? 1 : 0];
  if (
    other.kind === "DecimalLiteral" &&
    other.text.trimStart().startsWith("-")
  ) {
    sqlCodeFailureTested = true;
  }
}

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
    if (
      statement.kind === "WhileStatement" ||
      statement.kind === "ForEachStatement" ||
      statement.kind === "CursorLoopStatement"
    ) {
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

/**
 * Two records whose copybooks would land in the same PDS member.
 *
 * A member name is eight characters with the hyphens taken out, and it is also
 * all the COBOL compiler looks at when it resolves a `COPY` from a PDS. So
 * `AccountRecord` and `AccountRow` are both `ACCOUNTR`: one copybook overwrites
 * the other in the library, and every program that copies either gets whichever
 * was written last — a record with the same name and different fields at
 * different offsets, which is the one kind of layout error a copybook exists to
 * prevent.
 *
 * Nothing reported it. The bundle's manifest listed both members, so the count
 * looked right and the library was short.
 */
function checkCopybookMemberNames(
  records: ResolvedRecord[],
  diagnostics: Diagnostic[],
): void {
  const byMember = new Map<string, ResolvedRecord[]>();
  for (const record of records) {
    const member = copybookMemberName(record.name);
    byMember.set(member, [...(byMember.get(member) ?? []), record]);
  }

  for (const [member, sharing] of byMember) {
    if (sharing.length < 2) {
      continue;
    }
    for (const record of sharing.slice(1)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-COPY-007",
          severity: "error",
          message: `${record.name} and ${sharing[0].name} are both copybook member ${member}.`,
          span: record.span,
          hint: "A PDS member name is eight characters with the hyphens removed, and that is what a COPY resolves on. Rename one of the records so the two differ within those eight characters.",
          backendProfile: "ibm-enterprise-cobol-zos",
        }),
      );
    }
  }
}

/**
 * Two files whose DD names collide.
 *
 * The same eight-character truncation as a copybook member, and the same class
 * of defect one step further out. `settlementExtract` and `settlementReport`
 * are both `SETTLEME`, so the generated job allocates one DD twice — and since
 * the dataset name is derived from it too, the report's output is written over
 * the extract's input under a name that looks deliberate.
 *
 * A DD name is one to eight characters, which is what makes the truncation
 * necessary and the collision possible. It shows up in a job of several
 * programs first, but it is a defect in one program with two such files as
 * well: the second SELECT assigns to a DD the first one already has.
 */
function checkDdNames(files: ResolvedFile[], diagnostics: Diagnostic[]): void {
  const byDd = new Map<string, ResolvedFile[]>();
  for (const file of files) {
    const dd = copybookMemberName(file.name);
    byDd.set(dd, [...(byDd.get(dd) ?? []), file]);
  }

  for (const [dd, sharing] of byDd) {
    if (sharing.length < 2) {
      continue;
    }
    for (const file of sharing.slice(1)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-FILE-012",
          severity: "error",
          message: `${file.name} and ${sharing[0].name} are both DD name ${dd}.`,
          span: file.span,
          hint: "A DD name is eight characters with the hyphens removed, and the dataset name is derived from it. Rename one of the files so the two differ within those eight characters.",
          backendProfile: "ibm-enterprise-cobol-zos",
        }),
      );
    }
  }
}

function declareFileStatusSymbols(scope: Map<string, ResolvedType>): void {
  // A DL/I status is read exactly like a file status: two characters saying
  // what the last call did.
  for (const database of declaredDatabases.values()) {
    if (database.statusName && !scope.has(database.statusName)) {
      scope.set(database.statusName, { kind: "string", length: 2 });
    }
  }
  // An MQ status is a reason code rather than a two-character status, so it is
  // a number: 2033 is an empty queue, 2085 a queue that is not there. Typing it
  // as text would let a program compare it with a string and never match.
  for (const queue of declaredQueues.values()) {
    if (queue.statusName && !scope.has(queue.statusName)) {
      scope.set(queue.statusName, {
        kind: "decimal",
        precision: 9,
        scale: 0,
        usage: "binary",
      });
    }
  }
  for (const file of declaredFiles.values()) {
    if (file.recordVarying && !scope.has(file.recordVarying.lengthName)) {
      // The used length is a number the program reads and writes, so it is in
      // scope like the file status is.
      scope.set(file.recordVarying.lengthName, {
        kind: "decimal",
        precision: 4,
        scale: 0,
        usage: "binary",
      });
    }
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
    return;
  }

  if (sqlExecuted && !sqlCodeFailureTested) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-SQL-007",
        severity: "error",
        message:
          "SQLCODE is tested, but nothing here tells a Db2 error from a row that was not found.",
        span,
        hint: "`+100` is the only not-found. Add a branch on `sqlcode < 0` — a deadlock (-911), a resource that was not available (-904), or a package that was never bound (-805) must not become the same answer as an account that does not exist.",
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
  const generic = genericFunctions.get(expression.callee);
  if (generic) {
    return inferGenericCallType(
      expression,
      generic,
      scope,
      aliases,
      recordMap,
      diagnostics,
    );
  }

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
    checkRecordArgument(
      expression.callee,
      expected,
      expression.args[index],
      index,
      diagnostics,
    );
  }

  return signature.returnType;
}

/**
 * Rejects a record argument the backend cannot take the address of.
 *
 * A record parameter is a reference cell the caller points at the argument, so
 * the argument has to name addressable storage: a record, or a field path
 * reaching a nested record. A subscripted element is not accepted, because the
 * cell would have to describe storage chosen by a subscript evaluated at the
 * call site.
 */
function checkRecordArgument(
  callee: string,
  expected: ResolvedType,
  argument: ExpressionNode,
  index: number,
  diagnostics: Diagnostic[],
): void {
  if (expected.kind !== "record") {
    return;
  }

  if (argument.kind === "Identifier") {
    return;
  }

  if (
    argument.kind === "MemberAccess" &&
    argument.target.kind === "Identifier"
  ) {
    return;
  }

  diagnostics.push(
    createDiagnostic({
      id: "BANK-TYPE-021",
      severity: "error",
      message: `Argument ${index + 1} of ${callee} is not a record the compiler can take the address of.`,
      span: argument.span,
      hint: `Pass a record by name, or a record-typed field such as \`customer.address\`. Copy a subscripted element into a ${expected.name} first, then pass that.`,
      backendProfile: "ibm-enterprise-cobol-zos",
    }),
  );
}

/**
 * Resolves a call to a generic function by inferring its type arguments from
 * the argument types, then requesting the matching instantiation.
 *
 * Type arguments are inferred rather than written at the call site because
 * `f<T>(x)` cannot be told apart from two comparisons without unbounded
 * lookahead. Inference keeps the grammar unambiguous and the call site clean.
 */
function inferGenericCallType(
  expression: CallExpressionNode,
  declaration: FunctionDeclarationNode,
  scope: Map<string, ResolvedType>,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
): ResolvedType | null {
  if (expression.args.length !== declaration.parameters.length) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-003",
        severity: "error",
        message: `${expression.callee} expects ${declaration.parameters.length} argument(s) but received ${expression.args.length}.`,
        span: expression.span,
        hint: `Declared as ${expression.callee}<${declaration.typeParameters.map((parameter) => parameter.name).join(", ")}>(${declaration.parameters.map((parameter) => parameter.name).join(", ")}).`,
        backendProfile: null,
      }),
    );
    return null;
  }

  const bindings = new Map<string, TypeNode>();
  const parameterNames = new Set(
    declaration.typeParameters.map((parameter) => parameter.name),
  );

  const actuals: (ResolvedType | null)[] = expression.args.map((argument) =>
    inferExpressionType(argument, scope, aliases, recordMap, diagnostics),
  );
  if (actuals.some((actual) => !actual)) {
    return null;
  }

  // A decimal literal carries the scale it was written with, not the type it is
  // meant to have: `0.00` on its own is decimal<2,2>. Inferring from it would
  // fix T to the literal's shape and reject the real argument that follows, so
  // literals are only consulted when nothing else determines the parameter.
  const order = [
    ...actuals
      .map((actual, index) => ({ actual, index }))
      .filter((entry) => !isLiteralDecimal(entry.actual as ResolvedType)),
    ...actuals
      .map((actual, index) => ({ actual, index }))
      .filter((entry) => isLiteralDecimal(entry.actual as ResolvedType)),
  ];

  for (const { actual, index } of order) {
    if (
      !unifyTypeParameter(
        declaration.parameters[index].type,
        actual as ResolvedType,
        parameterNames,
        bindings,
        diagnostics,
        expression.args[index].span,
      )
    ) {
      return null;
    }
  }

  const missing = declaration.typeParameters.find(
    (parameter) => !bindings.has(parameter.name),
  );
  if (missing) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-020",
        severity: "error",
        message: `Type parameter ${missing.name} of ${expression.callee} cannot be inferred from the arguments.`,
        span: expression.span,
        hint: `Every type parameter must appear in a parameter type, because ${expression.callee} is instantiated from its arguments.`,
        backendProfile: null,
      }),
    );
    return null;
  }

  const typeArguments = declaration.typeParameters.map(
    (parameter) => bindings.get(parameter.name) as TypeNode,
  );
  const mangled = mangleInstantiation(declaration.name, typeArguments);
  callTargets.set(expression, mangled);
  instantiatedFunctions.add(declaration.name);

  if (!functionSignatures.has(mangled)) {
    const instance = instantiateFunction(declaration, bindings, mangled);
    // The signature is registered before the body is checked so a recursive
    // instantiation resolves against itself instead of asking for a second one.
    registerFunctionSignature(instance, aliases, recordMap);
    pendingInstantiations.set(mangled, {
      declaration: instance,
      span: expression.span,
    });
  }

  const signature = functionSignatures.get(mangled);
  if (!signature) {
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
          hint: "All uses of one type parameter must agree; the subset does not coerce arguments.",
          backendProfile: null,
        }),
      );
    }
    checkRecordArgument(
      expression.callee,
      expected,
      expression.args[index],
      index,
      diagnostics,
    );
  }

  return signature.returnType;
}

/**
 * Matches a parameter's declared type against an argument's actual type,
 * binding any type parameter it meets.
 *
 * A parameter name already bound to a different type is a conflict: one type
 * parameter stands for exactly one type per instantiation.
 */
function unifyTypeParameter(
  template: TypeNode,
  actual: ResolvedType,
  parameterNames: ReadonlySet<string>,
  bindings: Map<string, TypeNode>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): boolean {
  if (template.kind === "TypeReference" && parameterNames.has(template.name)) {
    // A literal never overrides a binding another argument already fixed. Its
    // written scale is not a claim about the type; `0.00` passed where the
    // instantiation is currency<"BDT", 18, 2> is a valid zero, not a conflict.
    if (isLiteralDecimal(actual) && bindings.has(template.name)) {
      return true;
    }

    const node = typeToTypeNode(actual, span);
    if (!node) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-020",
          severity: "error",
          message: `${describeType(actual)} cannot be used as a type argument.`,
          span,
          hint: "A type argument has to name a layout the backend can emit.",
          backendProfile: null,
        }),
      );
      return false;
    }

    const existing = bindings.get(template.name);
    if (existing && describeTypeNode(existing) !== describeTypeNode(node)) {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-020",
          severity: "error",
          message: `Type parameter ${template.name} is already ${describeTypeNode(existing)} and cannot also be ${describeTypeNode(node)}.`,
          span,
          hint: "One type parameter stands for one type across the whole call.",
          backendProfile: null,
        }),
      );
      return false;
    }

    bindings.set(template.name, node);
    return true;
  }

  if (template.kind === "ArrayType" && actual.kind === "array") {
    return unifyTypeParameter(
      template.element,
      actual.element,
      parameterNames,
      bindings,
      diagnostics,
      span,
    );
  }

  if (template.kind === "NullableType" && actual.kind === "nullable") {
    return unifyTypeParameter(
      template.inner,
      actual.inner,
      parameterNames,
      bindings,
      diagnostics,
      span,
    );
  }

  if (template.kind === "TypeReference") {
    return unifyNestedArguments(
      template,
      actual,
      parameterNames,
      bindings,
      diagnostics,
      span,
    );
  }

  // A concrete parameter type binds nothing; the argument check that follows
  // reports any mismatch.
  return true;
}

/** Unifies `Box<T>` against the record an argument of that shape resolved to. */
function unifyNestedArguments(
  template: TypeReferenceNode,
  actual: ResolvedType,
  parameterNames: ReadonlySet<string>,
  bindings: Map<string, TypeNode>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): boolean {
  if (template.typeArguments.length === 0 || actual.kind !== "record") {
    return true;
  }

  const prefix = `${template.name}$`;
  if (!actual.name.startsWith(prefix)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-020",
        severity: "error",
        message: `Expected an instantiation of ${template.name} but received ${actual.name}.`,
        span,
        hint: `Pass a value declared as ${template.name}<...>.`,
        backendProfile: null,
      }),
    );
    return false;
  }

  // The mangled suffix records the instantiation's type arguments in order, so
  // matching it against the template's own arguments recovers the bindings.
  const suffix = actual.name.slice(prefix.length).split("$");
  if (suffix.length !== template.typeArguments.length) {
    return false;
  }

  for (let index = 0; index < template.typeArguments.length; index += 1) {
    const argument = template.typeArguments[index];
    if (
      argument.kind === "TypeReference" &&
      parameterNames.has(argument.name)
    ) {
      const existing = bindings.get(argument.name);
      const encoded = suffix[index];
      if (existing && describeTypeNode(existing) !== encoded) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-020",
            severity: "error",
            message: `Type parameter ${argument.name} is already ${describeTypeNode(existing)} and cannot also be ${encoded}.`,
            span,
            hint: "One type parameter stands for one type across the whole call.",
            backendProfile: null,
          }),
        );
        return false;
      }
      if (!existing) {
        const node = decodeMangledType(encoded, span);
        if (!node) {
          return false;
        }
        bindings.set(argument.name, node);
      }
    }
  }

  return true;
}

/**
 * True when `candidate` extends `base`, directly or through a chain.
 *
 * This is what makes a derived record usable where its base is expected. It is
 * sound only because inheritance flattens the base fields first: the derived
 * record's leading storage is the base record's storage at the same offsets, so
 * a reference cell describing the base reads the right bytes either way.
 */
function extendsRecord(candidate: string, base: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = recordBases.get(candidate);
  while (current && !seen.has(current)) {
    if (current === base) {
      return true;
    }
    seen.add(current);
    current = recordBases.get(current);
  }
  return false;
}

/** True for a written decimal literal, whose scale is its own, not the target's. */
function isLiteralDecimal(type: ResolvedType): boolean {
  return type.kind === "decimal" && type.literal === true;
}

/** Rebuilds a type node from a resolved type, for use as a type argument. */
function typeToTypeNode(type: ResolvedType, span: SourceSpan): TypeNode | null {
  switch (type.kind) {
    case "decimal":
      return {
        kind: "DecimalType",
        precision: type.precision,
        scale: type.scale,
        usage: type.usage,
        span,
      };
    case "string":
      return {
        kind: "StringType",
        length: type.length,
        national: type.national,
        span,
      };
    case "bool":
      return { kind: "BoolType", span };
    case "temporal":
      return { kind: "TemporalType", unit: type.unit, span };
    case "edited":
      // An edited field renders a value; it is not itself a value a generic can
      // be instantiated at, so it never needs rebuilding as a type argument.
      return null;
    case "currency":
      return {
        kind: "CurrencyType",
        code: type.code,
        precision: type.precision,
        scale: type.scale,
        span,
      };
    case "record":
    case "enum":
      return {
        kind: "TypeReference",
        name: type.name,
        typeArguments: [],
        span,
      };
    case "nullable": {
      const inner = typeToTypeNode(type.inner, span);
      return inner ? { kind: "NullableType", inner, span } : null;
    }
    case "array": {
      const element = typeToTypeNode(type.element, span);
      return element
        ? { kind: "ArrayType", element, length: type.length, span }
        : null;
    }
  }
}

/** Reverses `describeTypeNode` for the forms a mangled name can contain. */
function decodeMangledType(encoded: string, span: SourceSpan): TypeNode | null {
  const decimal = /^dec(\d+)_(\d+)$/.exec(encoded);
  if (decimal) {
    return {
      kind: "DecimalType",
      precision: Number(decimal[1]),
      scale: Number(decimal[2]),
      span,
    };
  }

  const text = /^str(\d+)$/.exec(encoded);
  if (text) {
    return { kind: "StringType", length: Number(text[1]), span };
  }

  if (encoded === "bool") {
    return { kind: "BoolType", span };
  }

  const money = /^cur([A-Z]+)(\d+)_(\d+)$/.exec(encoded);
  if (money) {
    return {
      kind: "CurrencyType",
      code: money[1],
      precision: Number(money[2]),
      scale: Number(money[3]),
      span,
    };
  }

  return { kind: "TypeReference", name: encoded, typeArguments: [], span };
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
      return type.usage === "binary"
        ? `binary<${type.precision}>`
        : type.usage === "display"
          ? `zoned<${type.precision}, ${type.scale}>`
          : type.usage === "unsigned"
            ? `unsigned<${type.precision}, ${type.scale}>`
            : `decimal<${type.precision}, ${type.scale}>`;
    case "string":
      return `${type.national ? "national" : "string"}<${type.length}>`;
    case "bool":
      return "bool";
    case "temporal":
      return type.unit;
    case "edited":
      return `edited<${type.source}, "${type.style}">`;
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
  noteSqlCodeComparison(expression);
  checkCicsResponseComparison(expression, diagnostics);

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

    // Dates and times order chronologically, which is the whole reason they are
    // stored as YYYYMMDD. Ordering is allowed; mixing a date with a time, or
    // with an amount, is not.
    if (left.kind === "temporal" || right.kind === "temporal") {
      if (
        left.kind !== "temporal" ||
        right.kind !== "temporal" ||
        left.unit !== right.unit
      ) {
        diagnostics.push(
          createDiagnostic({
            id: "BANK-TYPE-003",
            severity: "error",
            message: `Cannot compare ${describeType(left)} with ${describeType(right)}.`,
            span: expression.span,
            hint: "Compare a date with a date, a time with a time, and a timestamp with a timestamp.",
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

/**
 * `edited<T, "style">`.
 *
 * The inner type must be something with a precision and a scale, because that
 * is what the picture is built from. A style the compiler does not know is
 * rejected rather than passed through to COBOL: a picture nobody checked is a
 * report column that silently loses digits.
 */
function resolveEdited(
  node: EditedTypeNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): ResolvedType | null {
  const inner = resolveTypeNode(
    node.inner,
    aliases,
    recordMap,
    diagnostics,
    span,
  );
  if (!inner) {
    return null;
  }

  if (!EDIT_STYLES.includes(node.style as EditStyle)) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-023",
        severity: "error",
        message: `Unknown edit style "${node.style}".`,
        span: node.styleSpan,
        hint: `Available styles: ${EDIT_STYLES.join(", ")}.`,
        backendProfile: null,
      }),
    );
    return null;
  }
  const style = node.style as EditStyle;

  // A date renders through a slashed picture and nothing else; an amount
  // renders through any of the numeric styles and not through the date one.
  if (inner.kind === "temporal") {
    if (inner.unit !== "date" || style !== "slashed") {
      diagnostics.push(
        createDiagnostic({
          id: "BANK-TYPE-023",
          severity: "error",
          message: `A ${inner.unit} cannot be rendered with the "${style}" style.`,
          span: node.styleSpan,
          hint: 'A date renders with "slashed"; a time or timestamp has no edited form yet.',
          backendProfile: null,
        }),
      );
      return null;
    }
    return { kind: "edited", style, precision: 8, scale: 0, source: "date" };
  }

  if (inner.kind !== "decimal" && inner.kind !== "currency") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-023",
        severity: "error",
        message: `Cannot render ${describeType(inner)} as an edited field.`,
        span: span,
        hint: "Editing formats a number or a date for a human to read.",
        backendProfile: null,
      }),
    );
    return null;
  }

  if (style === "slashed") {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-023",
        severity: "error",
        message: 'The "slashed" style renders a date, not an amount.',
        span: node.styleSpan,
        hint: `Available styles for an amount: ${EDIT_STYLES.filter((entry) => entry !== "slashed").join(", ")}.`,
        backendProfile: null,
      }),
    );
    return null;
  }

  return {
    kind: "edited",
    style,
    precision: inner.precision,
    scale: inner.scale,
    source: describeType(inner),
  };
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
    case "TemporalType":
      return { kind: "temporal", unit: node.unit };
    case "EditedType":
      return resolveEdited(node, aliases, recordMap, diagnostics, span);
    case "CurrencyType":
      // A currency is a decimal that also carries its unit, so it is held the
      // same way and has to satisfy the same limits. It was reaching the
      // emitter unchecked, which is how `currency<"BDT", 40, 2>` became a
      // PICTURE of thirty-eight digit positions.
      return validateNumericPrecision(
        node.precision,
        node.scale,
        diagnostics,
        span,
      )
        ? {
            kind: "currency",
            code: node.code,
            precision: node.precision,
            scale: node.scale,
          }
        : null;
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

/**
 * Digit positions a numeric PICTURE may have.
 *
 * Enterprise COBOL's compiler limits: eighteen under the default
 * `ARITH(COMPAT)`, thirty-one under `ARITH(EXTEND)`. The generated jobs do not
 * pass `ARITH`, so the default is what the picture has to fit.
 */
const MAX_NUMERIC_DIGITS = 18;

/**
 * The precision and scale limits every numeric type shares.
 *
 * `decimal`, `zoned`, `binary`, `native`, and `currency` are all one numeric
 * item with a different `USAGE`, so the picture rules are the same for each.
 * They were checked in `resolveDecimal` alone, and `currency` does not go
 * through it.
 */
function validateNumericPrecision(
  precision: number,
  scale: number,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): boolean {
  if (
    !Number.isInteger(precision) ||
    !Number.isInteger(scale) ||
    precision <= 0 ||
    scale < 0
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
    return false;
  }

  if (scale > precision) {
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
    return false;
  }

  // Enterprise COBOL's compiler limits give "PICTURE clause, numeric item digit
  // positions: with ARITH(COMPAT) 18, with ARITH(EXTEND) 31". COMPAT is the
  // default and what the generated jobs compile under, so eighteen is the
  // ceiling — and it is a limit on the picture, so it applies whatever the
  // usage. A wider field emitted a PICTURE the compiler rejects outright: a
  // build nobody can run, from a program this compiler said was fine.
  if (precision > MAX_NUMERIC_DIGITS) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-002",
        severity: "error",
        message: `A numeric field holds at most ${MAX_NUMERIC_DIGITS} digits, not ${precision}.`,
        span,
        hint: "Enterprise COBOL's default ARITH(COMPAT) allows eighteen digit positions in a PICTURE, whatever the usage. Split the value, or hold it as text if it is an identifier rather than a quantity.",
        backendProfile: null,
      }),
    );
    return false;
  }

  return true;
}

function resolveDecimal(
  node: DecimalTypeNode,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): DecimalType | null {
  if (
    !validateNumericPrecision(node.precision, node.scale, diagnostics, span)
  ) {
    return null;
  }

  return {
    kind: "decimal",
    precision: node.precision,
    scale: node.scale,
    usage: node.usage ?? "packed",
  };
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

  return { kind: "string", length: node.length, national: node.national };
}

function resolveReference(
  node: TypeReferenceNode,
  aliases: Record<string, ResolvedType>,
  recordMap: Map<string, ResolvedRecord>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): ResolvedType | null {
  if (node.typeArguments.length > 0) {
    return instantiateGenericRecord(
      node,
      aliases,
      recordMap,
      diagnostics,
      span,
    );
  }

  const generic = genericRecords.get(node.name);
  if (generic) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TYPE-018",
        severity: "error",
        message: `${node.name} is generic and needs ${generic.typeParameters.length} type argument(s).`,
        span,
        hint: `Write ${node.name}<${generic.typeParameters.map((parameter) => parameter.name).join(", ")}> with concrete types. COBOL has no boxed values, so the layout has to be fixed at compile time.`,
        backendProfile: null,
      }),
    );
    return null;
  }

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

  // A record whose declaration sits further down the file, reached through a
  // field or a base clause rather than in declaration order.
  if (pendingRecordDeclarations.has(node.name)) {
    const resolved = ensureRecordResolved(
      node.name,
      aliases,
      recordMap,
      diagnostics,
      span,
      [],
    );
    if (resolved) {
      return {
        kind: "record",
        name: resolved.name,
        span: resolved.span,
        fields: resolved.fields,
      };
    }
    return null;
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
  // Assigning into an edited field is the formatting step: COBOL performs the
  // editing on the MOVE. The value has to be the shape the picture was built
  // for, so precision and scale must match what it renders.
  if (left.kind === "edited") {
    if (right.kind === "edited") {
      return (
        left.style === right.style &&
        left.precision === right.precision &&
        left.scale === right.scale
      );
    }
    if (left.style === "slashed") {
      return right.kind === "temporal" && right.unit === "date";
    }
    return (
      (right.kind === "decimal" || right.kind === "currency") &&
      right.scale === left.scale &&
      right.precision <= left.precision
    );
  }

  // The other direction is refused: an edited field is a rendering, not a
  // number, and reading one back as a value is how a report column ends up
  // being arithmetic input.
  if (right.kind === "edited") {
    return false;
  }

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
    // Alphanumeric and national are different bytes for the same characters,
    // and converting between them is exactly what GnuCOBOL leaves unfinished
    // (`NATIONAL-OF` and `DISPLAY-OF` are not implemented). Rather than emit a
    // move whose result differs between compilers, the two do not mix at all.
    if ((left.national ?? false) !== (right.national ?? false)) {
      return false;
    }
    // A value whose length the compiler knows fits any field long enough to
    // hold it, because COBOL pads a shorter alphanumeric with spaces. That
    // covers a written literal and equally a `concat` or `substring` result:
    // both have an exact known length and neither can truncate the target.
    if (right.literal) {
      return right.length <= left.length;
    }
    if (left.literal) {
      return left.length <= right.length;
    }
    return left.length === right.length;
  }

  if (left.kind === "record" && right.kind === "record") {
    return left.name === right.name || extendsRecord(right.name, left.name);
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
