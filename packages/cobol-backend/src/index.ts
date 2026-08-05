import type { SourcePosition, SourceSpan } from "../../ast/src/index";
import type {
  IRBinaryComparisonExpression,
  IRBinaryArithmeticExpression,
  IRBlock,
  IRBooleanLiteralExpression,
  IRDecimalLiteralExpression,
  IRExpression,
  IRField,
  IRIfStatement,
  IRFunction,
  IRIdentifierExpression,
  IRCursorLoopStatement,
  IRLetStatement,
  IRProgram,
  IRRecord,
  IRType,
  IRStatement,
  IRLedgerStatement,
  IRAuditStatement,
  IRMemberAccessExpression,
  IRFile,
  IRWhileStatement,
  IRAssignStatement,
  IRExpressionStatement,
  IRFileStatement,
  IRSwitchStatement,
  IRSqlStatement,
  IRSql,
  IRCicsStatement,
  IRTransaction,
  IRForEachStatement,
  IRRaiseStatement,
  IRStringCallExpression,
  IRTemporalCallExpression,
} from "../../ir/src/index";
import {
  decimalPicture,
  packedDecimalByteLength,
  toCobolFieldName,
  toCobolName,
  toCobolParagraphName,
  toCobolPicture,
  toCobolProgramId,
  enumWidth,
  temporalPicture,
  editedPicture,
} from "../../cobol-ir/src/index";
import {
  describeRecordLayout,
  type CopybookRecordLayout,
} from "../../copybook/src/index";

/**
 * BankLang ledger and audit calling convention. See ADR-0003. The field widths
 * are fixed so the generated group items stay layout-stable across programs.
 */
const LEDGER_PROGRAM = "BANKLEDG";
const AUDIT_PROGRAM = "BANKAUDT";
const LEDGER_INTERFACE_GROUP = "BANK-LEDGER-INTERFACE";
const AUDIT_INTERFACE_GROUP = "BANK-AUDIT-INTERFACE";
const LEDGER_OPERATION_FIELD = "BANK-LEDGER-OPERATION";
const LEDGER_ACCOUNT_FIELD = "BANK-LEDGER-ACCOUNT";
const LEDGER_AMOUNT_FIELD = "BANK-LEDGER-AMOUNT";
const AUDIT_EVENT_FIELD = "BANK-AUDIT-EVENT";
const AUDIT_CORRELATION_FIELD = "BANK-AUDIT-CORRELATION";
const LEDGER_ACCOUNT_LENGTH = 32;
const LEDGER_AMOUNT_PICTURE = "PIC S9(16)V99 COMP-3";
const AUDIT_EVENT_LENGTH = 32;
const AUDIT_CORRELATION_LENGTH = 64;
const FILE_STATUS_PICTURE = "PIC XX";

/**
 * Field set when a computed array index falls outside its declared bounds.
 *
 * COBOL does not range-check subscripts, so an out-of-range index reads or
 * writes adjacent storage. Recording it makes the failure observable instead
 * of silently corrupting the record next door.
 */
const BOUNDS_STATUS_FIELD = "BANK-BOUNDS-STATUS";

/**
 * Field holding the code of the failure currently being propagated.
 *
 * COBOL has no exceptions and no stack unwinding, so a raise is a flag plus a
 * jump to the enclosing body's exit. Spaces mean no failure is in flight.
 */
const FAILURE_CODE_FIELD = "BANK-FAILURE-CODE";

/** Failure code raised when a computed subscript falls outside its table. */
const BOUNDS_FAILURE_CODE = "BANK-BOUNDS-VIOLATION";

/**
 * Exit paragraph the current body jumps to when it raises.
 *
 * `GO TO` is the only way out of a COBOL paragraph mid-sentence. The target is
 * always the end of the range the caller performed, so control returns to the
 * caller exactly as a normal fall-through would.
 */
let currentExitLabel: string | null = null;

/** Index used when copying a table between a file record and working storage. */
const COPY_INDEX_FIELD = "BANK-COPY-INDEX";

/**
 * BankTS name to COBOL field, for the routine currently being emitted.
 *
 * Parameters and locals live in their own storage so calls can pass arguments
 * and two routines can each declare `scratch`, so a reference to `amount`
 * inside `validateAmount` must render as `VALIDATE-AMOUNT-P1` rather than
 * `AMOUNT`.
 */
let currentBindings = new Map<string, string>();

/** Local name to COBOL field, per routine. See `planLocalFields`. */
let currentLocalFields = new Map<string, Map<string, string>>();

/** SQL declarations for the program being emitted. */
let currentSql = new Map<string, IRSql>();

/**
 * Every data name the program declares.
 *
 * COBOL puts paragraph names and data names in one namespace, so a transaction
 * called `total` would clash with a field called `total`. Paragraph names are
 * suffixed only when they would actually collide, which keeps the common case
 * readable.
 */
let declaredDataNames = new Set<string>();

/**
 * The recursive program currently being emitted, if any.
 *
 * A self-call inside a recursive program uses that program's own per-invocation
 * argument storage rather than the caller's.
 */
let recursiveContext: {
  name: string;
  programName: string;
  args: string[];
  subResult: string;
} | null = null;

/** Functions of the program being emitted, for resolving call shape. */
let currentFunctions = new Map<string, IRFunction>();

/** Recursive functions become separate programs with their own names. */
function recursiveProgramName(name: string): string {
  return toCobolName(name).replace(/-/g, "").slice(0, 8).toUpperCase();
}

function paragraphName(name: string): string {
  const base = toCobolParagraphName(name);
  return declaredDataNames.has(base) ? `${base}-PARA` : base;
}

/**
 * A record parameter's LINKAGE cell.
 *
 * The cell carries the *declared* parameter type's layout. A caller passing a
 * record that extends it points the cell at storage that is longer, which is
 * safe precisely because the declared fields sit at the same offsets.
 */
interface RecordParameterCell {
  name: string;
  fields: IRRecord["fields"];
}

function collectRecordParameterCells(
  program: IRProgram,
): RecordParameterCell[] {
  const cells: RecordParameterCell[] = [];
  for (const fn of program.functions) {
    // A recursive function is a separate program and receives its records
    // through its own PROCEDURE DIVISION USING clause instead.
    if (fn.isRecursive) {
      continue;
    }
    fn.parameters.forEach((parameter, index) => {
      if (parameter.type.kind === "record") {
        cells.push({
          name: parameterFieldName(fn.name, index),
          fields: parameter.type.fields,
        });
      }
    });
  }
  return cells;
}

/** The paragraph the generated program starts at. */
const MAIN_PARAGRAPH = "BANK-MAIN";

/**
 * The transaction the program starts at.
 *
 * `entry transaction` names it explicitly. Falling back to the first declared
 * transaction keeps a single-transaction program working without ceremony,
 * which is the shape most programs have.
 */
function findEntryTransaction(program: IRProgram): IRTransaction | null {
  return (
    program.transactions.find((transaction) => transaction.isEntry) ??
    program.transactions[0] ??
    null
  );
}

/** The paragraph a raise inside `name` jumps to. */
function exitParagraphName(name: string): string {
  return `${paragraphName(name)}-EXIT`;
}

/** The paragraph holding a transaction's statements, under its wrapper. */
function bodyParagraphName(name: string): string {
  return `${paragraphName(name)}-BODY`;
}

/** The paragraph holding a transaction's `on failure` statements. */
function failureParagraphName(name: string): string {
  return `${paragraphName(name)}-FAILURE`;
}

/** True when any function or transaction in the program can raise. */
function programCanFail(program: IRProgram): boolean {
  return (
    program.functions.some((fn) => fn.canFail) ||
    program.transactions.some((transaction) => transaction.canFail)
  );
}

function collectDataNames(program: IRProgram): Set<string> {
  const names = new Set<string>();

  const addFields = (fields: IRRecord["fields"]): void => {
    for (const field of fields) {
      names.add(toCobolFieldName(field.name));
      if (field.type.kind === "record") {
        addFields(field.type.fields);
      }
      if (field.type.kind === "array" && field.type.element.kind === "record") {
        addFields(field.type.element.fields);
      }
    }
  };

  for (const record of program.records) {
    names.add(toCobolName(record.name));
    addFields(record.fields);
  }
  for (const file of program.files) {
    names.add(fileCobolName(file.name));
    names.add(fileRecordName(file));
    addFields(file.record.fields);
    if (file.statusName) {
      names.add(toCobolFieldName(file.statusName));
    }
  }
  for (const fn of program.functions) {
    names.add(functionResultName(fn.name));
    fn.parameters.forEach((_parameter, index) => {
      names.add(parameterFieldName(fn.name, index));
    });
  }
  for (const owner of localOwners(program)) {
    for (const local of owner.locals) {
      names.add(localFieldName(owner.name, local.name));
    }
  }

  return names;
}

function requireSqlDeclaration(name: string): IRSql {
  const declaration = currentSql.get(name);
  if (!declaration) {
    throw new Error(`Unresolved SQL statement during emission: ${name}`);
  }
  return declaration;
}

/** BankTS comparison operators to COBOL relational operators. */
const COBOL_COMPARISONS: Record<string, string> = {
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "==": "=",
  "!=": "NOT =",
};

/** BankTS rounding modes to COBOL `ROUNDED MODE IS` phrases. */
const COBOL_ROUNDING_MODES: Record<string, string> = {
  HALF_EVEN: "NEAREST-EVEN",
  HALF_UP: "NEAREST-AWAY-FROM-ZERO",
  HALF_DOWN: "NEAREST-TOWARD-ZERO",
  UP: "AWAY-FROM-ZERO",
  DOWN: "TRUNCATION",
  CEILING: "TOWARD-GREATER",
  FLOOR: "TOWARD-LESSER",
};

export interface SourceMapEntry {
  sourceFile: string;
  sourceStart: SourcePosition;
  sourceEnd: SourcePosition;
  artifact: string;
  targetStartLine: number;
  targetEndLine: number;
  category: "module" | "record" | "field" | "function" | "transaction";
  symbol: string;
}

export interface SourceMapDocument {
  version: number;
  backendProfile: string;
  sourceFile: string;
  artifact: string;
  entries: SourceMapEntry[];
}

export interface CobolEmitResult {
  cobol: string;
  sourceMap: SourceMapDocument;
  recordLayouts: CopybookRecordLayout[];
  cobolArtifactPath: string;
  sourceMapArtifactPath: string;
}

export interface CobolEmitOptions {
  cobolArtifactPath?: string;
  sourceMapArtifactPath?: string;
  /**
   * Whether record layouts are written into the program or copied into it.
   *
   * `inline` keeps the artifact self-contained and reviewable on its own.
   * `copy` emits `COPY <NAME>.`, which is the shape a shop with a shared
   * copybook library expects: the copybook becomes the contract between
   * programs rather than a document that can drift from them.
   */
  copybookMode?: "inline" | "copy";
}

export interface JclEmitResult {
  jcl: string;
  jclArtifactPath: string;
}

export interface JclEmitOptions {
  /**
   * True when the program `COPY`s its record layouts.
   *
   * The compile step then needs a SYSLIB pointing at the copybook library, or
   * the copy statements resolve to nothing and the program will not compile.
   */
  usesCopybooks?: boolean;
  jclArtifactPath?: string;
}

export function emitCobol(
  program: IRProgram,
  options: CobolEmitOptions = {},
): CobolEmitResult {
  const backendProfile = "ibm-enterprise-cobol-zos";
  const cobolArtifactPath =
    options.cobolArtifactPath ?? defaultCobolArtifactPath(program.moduleName);
  const sourceMapArtifactPath =
    options.sourceMapArtifactPath ?? "dist/maps/source-map.json";
  const lines: string[] = [];
  const entries: SourceMapEntry[] = [];
  currentSql = new Map(program.sql.map((entry) => [entry.name, entry]));
  // Names locals before anything reads them: whether a local is qualified
  // depends on the whole program, not on the routine that declares it.
  cursorNames = new Set(
    program.sql
      .filter((entry) => entry.form === "cursor")
      .map((entry) => entry.name),
  );
  currentLocalFields = planLocalFields(program);
  declaredDataNames = collectDataNames(program);
  currentFunctions = new Map(program.functions.map((fn) => [fn.name, fn]));

  const addLine = (line = "") => {
    lines.push(line);
  };

  const lineNumber = () => lines.length + 1;

  addLine("*> Generated by bankc.");
  addLine("*> Do not edit this file directly.");
  addLine("*> Source maps are available in dist/maps.");
  const moduleLine = lineNumber();
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${toCobolProgramId(program.moduleName)}.`);
  addLine("");

  if (program.files.length > 0) {
    addLine(`       ENVIRONMENT DIVISION.`);
    addLine(`       INPUT-OUTPUT SECTION.`);
    addLine(`       FILE-CONTROL.`);
    for (const file of program.files) {
      emitFileControlEntry(file, addLine);
    }
    addLine("");
  }

  addLine(`       DATA DIVISION.`);

  if (program.files.length > 0) {
    addLine(`       FILE SECTION.`);
    for (const file of program.files) {
      // The FD record carries the real field structure, with names prefixed by
      // the file so they cannot collide with the working-storage record. That
      // is what makes per-field access and a RECORD KEY possible.
      addLine(`       FD  ${fileCobolName(file.name)}.`);
      addLine(`       01  ${fileRecordName(file)}.`);
      emitRecordFields(file.record.fields, 1, addLine);
    }
  }

  addLine(`       WORKING-STORAGE SECTION.`);

  // The SQLCA carries SQLCODE, which the analyzer requires the program to test.
  if (program.sql.length > 0) {
    addLine(`           EXEC SQL INCLUDE SQLCA END-EXEC.`);
    for (const statement of program.sql) {
      statement.parameters.forEach((parameter, index) => {
        addLine(
          `       01  ${sqlParameterName(statement.name, index).padEnd(20)} ${formatCobolType(parameter.type)}.`,
        );
      });
      // A cursor counts the rows it has taken, so the declared bound can stop
      // it whatever the database keeps returning.
      if (statement.form === "cursor") {
        addLine(
          `       01  ${cursorRowCounter(statement.name).padEnd(20)} PIC 9(9) COMP.`,
        );
      }
    }
    emitCursorDeclarations(program.sql, addLine);
  }

  for (const file of program.files) {
    if (file.statusName) {
      addLine(
        `       01  ${toCobolFieldName(file.statusName).padEnd(20)} ${FILE_STATUS_PICTURE}.`,
      );
    }
  }
  emitRelativeKeys(program.files, addLine);
  emitCicsRespFields(program.transactions, addLine);
  // A recursive function is called, not performed, so the caller still needs
  // somewhere to put the arguments and receive the result.
  for (const fn of program.functions) {
    if (!fn.isRecursive) {
      continue;
    }
    addLine(
      `       01  ${functionResultName(fn.name)} ${formatCobolType(fn.returnType)}.`,
    );
    fn.parameters.forEach((parameter, index) => {
      if (parameter.type.kind === "record") {
        return;
      }
      addLine(
        `       01  ${parameterFieldName(fn.name, index).padEnd(20)} ${formatCobolType(parameter.type)}.`,
      );
    });
  }
  // `now()` reads the clock into a field before taking it apart, so the field
  // only exists in a program that asks for the time.
  if (programUsesNow(program)) {
    addLine(`       01  ${CURRENT_DATE_FIELD.padEnd(20)} PIC X(21).`);
  }
  if (programUsesArrays(program)) {
    addLine(
      `       01  ${BOUNDS_STATUS_FIELD.padEnd(20)} PIC X(2) VALUE "00".`,
    );
    addLine(`       01  ${COPY_INDEX_FIELD.padEnd(20)} PIC 9(9) COMP.`);
  }
  if (programCanFail(program)) {
    // EXTERNAL so a recursive function, which is a sibling program rather than
    // a paragraph, raises into the same field the caller tests.
    addLine(`       01  ${FAILURE_CODE_FIELD.padEnd(20)} PIC X(32) EXTERNAL.`);
  }

  const copybookMode = options.copybookMode ?? "inline";
  const recordLayouts: CopybookRecordLayout[] = [];
  for (const record of program.records) {
    const recordStart = lineNumber();
    const layout = describeRecordLayout(record);
    recordLayouts.push(layout);

    // A COPY brings in the whole record, so there is one generated line and one
    // source-map entry for the record, and no per-field entries: the fields are
    // in the copybook, which has a layout report of its own.
    if (copybookMode === "copy") {
      addLine(`           COPY ${layout.cobolName}.`);
      entries.push({
        sourceFile: program.sourceFile,
        sourceStart: record.span.start,
        sourceEnd: record.span.end,
        artifact: cobolArtifactPath,
        targetStartLine: recordStart,
        targetEndLine: recordStart,
        category: "record",
        symbol: record.name,
      });
      continue;
    }

    addLine(`       01  ${layout.cobolName}.`);
    // Field start lines are recorded as they are emitted, because a field can
    // span several lines: an enum adds level-88 entries, a nullable adds an
    // indicator, and an array of records nests its own fields.
    const fieldLines: number[] = [];
    for (const field of record.fields) {
      fieldLines.push(lineNumber());
      emitField(field.name, field.type, 1, " ".repeat(11), addLine);
    }
    const recordEnd = lineNumber() - 1;
    entries.push({
      sourceFile: program.sourceFile,
      sourceStart: record.span.start,
      sourceEnd: record.span.end,
      artifact: cobolArtifactPath,
      targetStartLine: recordStart,
      targetEndLine: recordEnd,
      category: "record",
      symbol: record.name,
    });

    for (let index = 0; index < record.fields.length; index += 1) {
      const field = record.fields[index];
      const start = fieldLines[index];
      const end = (fieldLines[index + 1] ?? recordEnd + 1) - 1;
      entries.push({
        sourceFile: program.sourceFile,
        sourceStart: field.span.start,
        sourceEnd: field.span.end,
        artifact: cobolArtifactPath,
        targetStartLine: start,
        targetEndLine: Math.max(start, end),
        category: "field",
        symbol: field.name,
      });
    }
  }

  const localsByOwner = new Map(
    localOwners(program).map((owner) => [owner.name, owner.locals]),
  );
  const emitLocals = (owner: string): void => {
    for (const local of localsByOwner.get(owner) ?? []) {
      addLine(
        `       01  ${localFieldName(owner, local.name).padEnd(20)} ${formatCobolType(local.declaredType)}.`,
      );
    }
  };

  for (const fn of program.functions) {
    // A recursive function becomes its own program, so its result, parameters
    // and locals live in that program's storage rather than here.
    if (fn.isRecursive) {
      continue;
    }
    addLine(
      `       01  ${functionResultName(fn.name)} ${formatCobolType(fn.returnType)}.`,
    );
    // Parameters get their own storage so a call can move arguments in.
    // Without this, a parameter reference only resolved by coinciding with a
    // record field name.
    fn.parameters.forEach((parameter, index) => {
      // A record parameter refers to the record's group item, which is already
      // declared once. Only scalars need their own storage.
      if (parameter.type.kind === "record") {
        return;
      }
      addLine(
        `       01  ${parameterFieldName(fn.name, index).padEnd(20)} ${formatCobolType(parameter.type)}.`,
      );
    });
    emitLocals(fn.name);
  }

  for (const transaction of program.transactions) {
    transaction.parameters.forEach((parameter, index) => {
      if (parameter.type.kind === "record") {
        return;
      }
      addLine(
        `       01  ${parameterFieldName(transaction.name, index).padEnd(20)} ${formatCobolType(parameter.type)}.`,
      );
    });
    emitLocals(transaction.name);
  }

  // Loop guard counters, one per loop, named from its source position.
  const counters = [
    ...program.functions.map((fn) => fn.body),
    ...program.transactions.map((transaction) => transaction.body),
  ].flatMap((body) => collectLoops(body));
  for (const loop of counters) {
    addLine(`       01  ${loopCounterName(loop).padEnd(20)} PIC 9(9) COMP.`);
  }

  const forEachIndexes = [
    ...program.functions.map((fn) => fn.body),
    ...program.transactions.map((transaction) => transaction.body),
  ].flatMap((body) => collectForEachIndexes(body));
  const declaredIndexes = new Set<string>();
  for (const loop of forEachIndexes) {
    const name = toCobolFieldName(loop.indexName);
    if (declaredIndexes.has(name)) {
      continue;
    }
    declaredIndexes.add(name);
    addLine(`       01  ${name.padEnd(20)} PIC 9(9) COMP.`);
  }
  if (program.transactions.length > 0) {
    emitLedgerInterfaceStorage(addLine);
  }

  // A record parameter is a reference cell rather than storage of its own. The
  // caller points it at the record being passed, so one paragraph can run over
  // any record whose layout begins with the declared one — which is exactly
  // what `extends` guarantees.
  const recordParameterCells = collectRecordParameterCells(program);
  const cicsTransactions = program.transactions.filter(
    (transaction) => transaction.isCics,
  );

  if (recordParameterCells.length > 0 || cicsTransactions.length > 0) {
    addLine("");
    addLine(`       LINKAGE SECTION.`);
  }

  for (const cell of recordParameterCells) {
    addLine(`       01  ${cell.name}.`);
    emitRecordFields(cell.fields, 1, addLine);
  }

  if (cicsTransactions.length > 0) {
    addLine(`       01  DFHCOMMAREA.`);
    const commareaRecord = cicsTransactions[0].parameters.find(
      (parameter) => parameter.type.kind === "record",
    );
    if (commareaRecord && commareaRecord.type.kind === "record") {
      for (const field of commareaRecord.type.fields) {
        emitField(`LK-${field.name}`, field.type, 1, " ".repeat(11), addLine);
      }
    } else {
      addLine(`           05  FILLER               PIC X(1).`);
    }
  }

  addLine("");
  addLine(`       PROCEDURE DIVISION.`);

  // COBOL enters a program at the first statement of the PROCEDURE DIVISION.
  // Without this paragraph the starting point would be whichever function
  // happened to be declared first, which is not something a caller can rely on.
  const entryTransaction = findEntryTransaction(program);
  if (entryTransaction) {
    addLine(`       ${MAIN_PARAGRAPH}.`);
    addLine(`           PERFORM ${paragraphName(entryTransaction.name)}`);
    addLine(`           GOBACK.`);
  }

  for (const fn of program.functions) {
    if (fn.isRecursive) {
      continue;
    }
    const functionStart = lineNumber();
    addLine(`       ${paragraphName(fn.name)}.`);
    emitFunctionBody(fn, addLine);
    const functionEnd = lineNumber() - 1;
    entries.push({
      sourceFile: program.sourceFile,
      sourceStart: fn.span.start,
      sourceEnd: fn.span.end,
      artifact: cobolArtifactPath,
      targetStartLine: functionStart,
      targetEndLine: functionEnd,
      category: "function",
      symbol: fn.name,
    });
  }

  for (const transaction of program.transactions) {
    const transactionStart = lineNumber();
    addLine(`       ${paragraphName(transaction.name)}.`);
    currentBindings = routineBindings(transaction.name, transaction.parameters);

    if (transaction.canFail) {
      emitFailingTransaction(transaction, addLine);
    } else {
      emitTransactionBody(transaction.body, addLine, 11);
      // A CICS program returns control to CICS rather than to a caller.
      addLine(
        transaction.isCics
          ? `           EXEC CICS RETURN END-EXEC.`
          : `           GOBACK.`,
      );
    }

    currentBindings = new Map();
    const transactionEnd = lineNumber() - 1;
    entries.push({
      sourceFile: program.sourceFile,
      sourceStart: transaction.span.start,
      sourceEnd: transaction.span.end,
      artifact: cobolArtifactPath,
      targetStartLine: transactionStart,
      targetEndLine: transactionEnd,
      category: "transaction",
      symbol: transaction.name,
    });
  }

  entries.unshift({
    sourceFile: program.sourceFile,
    sourceStart: program.moduleSpan.start,
    sourceEnd: program.moduleSpan.end,
    artifact: cobolArtifactPath,
    targetStartLine: moduleLine,
    targetEndLine: moduleLine + 1,
    category: "module",
    symbol: program.moduleName,
  });

  // Recursive functions are emitted as sibling programs. LOCAL-STORAGE gives
  // each invocation its own copy of the locals; WORKING-STORAGE would be
  // shared across the recursion and silently produce wrong answers.
  const recursiveFunctions = program.functions.filter((fn) => fn.isRecursive);
  if (recursiveFunctions.length > 0) {
    addLine(`       END PROGRAM ${toCobolProgramId(program.moduleName)}.`);
    for (const fn of recursiveFunctions) {
      const start = lineNumber();
      emitRecursiveProgram(fn, addLine);
      // A recursive function still has to be traceable. Its entry points at
      // the sibling program rather than at a paragraph in the main one.
      entries.push({
        sourceFile: program.sourceFile,
        sourceStart: fn.span.start,
        sourceEnd: fn.span.end,
        artifact: cobolArtifactPath,
        targetStartLine: start,
        targetEndLine: lineNumber() - 1,
        category: "function",
        symbol: fn.name,
      });
    }
  }

  return {
    cobol: `${lines.join("\n")}\n`,
    sourceMap: {
      version: 1,
      backendProfile,
      sourceFile: program.sourceFile,
      artifact: sourceMapArtifactPath,
      entries,
    },
    recordLayouts,
    cobolArtifactPath,
    sourceMapArtifactPath,
  };
}

export function emitJcl(
  program: IRProgram,
  options: JclEmitOptions = {},
): JclEmitResult {
  const jclArtifactPath =
    options.jclArtifactPath ?? defaultJclArtifactPath(program.moduleName);
  const jobName = toJclJobName(program.moduleName);
  const cobolArtifactPath = defaultCobolArtifactPath(program.moduleName);
  const copybookArtifactPaths = program.records.map(
    (record) => `dist/copybooks/${toCobolName(record.name)}.cpy`,
  );

  const needsDb2 = program.backendRequirements.includes("db2-precompiler");
  const needsCics = program.backendRequirements.includes("cics-translator");
  // A load module name and a PDS member name are eight characters with no
  // hyphens, which the COBOL PROGRAM-ID need not be. They are the same
  // transform the job name uses, so every name in this job agrees.
  const moduleName = toJclJobName(program.moduleName);

  const lines = [
    "//* Generated by bankc.",
    "//* Do not edit this file directly.",
    `//${jobName} JOB (BANKLANG),'${toCobolName(program.moduleName)}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID`,
    needsCics
      ? "//* Build job for the generated CICS program. It is installed, not run."
      : "//* Batch job example for the generated COBOL artifact.",
    `//* COBOL source: ${cobolArtifactPath}`,
    ...copybookArtifactPaths.map(
      (copybookPath) => `//* COPYBOOK source: ${copybookPath}`,
    ),
  ];

  // The CICS translator runs first: it rewrites EXEC CICS into calls before
  // anything else reads the source, and its output is what the precompiler and
  // then the compiler see.
  if (needsCics) {
    lines.push(
      "//* EXEC CICS must be translated before any compiler reads the source.",
      "//TRANSLAT EXEC PGM=DFHECP1$",
      "//STEPLIB  DD DISP=SHR,DSN=CICSTS.SDFHLOAD",
      "//SYSPRINT DD SYSOUT=*",
      `//SYSIN    DD DISP=SHR,DSN=${toJclDatasetName(cobolArtifactPath)}`,
      "//SYSPUNCH DD DSN=&&TRANOUT,DISP=(NEW,PASS),UNIT=SYSDA,",
      "//            SPACE=(CYL,(1,1))",
    );
  }

  if (needsDb2) {
    lines.push(
      "//* EXEC SQL must be precompiled, and the resulting DBRM bound, before",
      "//* the program can run. Neither step is optional.",
      "//PRECOMP  EXEC PGM=DSNHPC,PARM='HOST(COB2)'",
      "//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD",
      `//DBRMLIB  DD DISP=SHR,DSN=DIST.DBRMLIB(${moduleName})`,
      "//SYSPRINT DD SYSOUT=*",
      needsCics
        ? "//SYSIN    DD DSN=&&TRANOUT,DISP=(OLD,DELETE)"
        : `//SYSIN    DD DISP=SHR,DSN=${toJclDatasetName(cobolArtifactPath)}`,
      "//SYSCIN   DD DSN=&&PRECOUT,DISP=(NEW,PASS),UNIT=SYSDA,",
      "//            SPACE=(CYL,(1,1))",
    );
  }

  lines.push(
    "//COMPILE  EXEC PGM=IGYCRCTL",
    "//SYSPRINT DD SYSOUT=*",
    // A COPY resolves against SYSLIB. Without it the copy statements find
    // nothing and the compile fails on undefined data names.
    ...(options.usesCopybooks
      ? ["//SYSLIB   DD DISP=SHR,DSN=BANKLANG.COPYLIB"]
      : []),
    needsDb2
      ? "//SYSIN    DD DSN=&&PRECOUT,DISP=(OLD,DELETE)"
      : needsCics
        ? "//SYSIN    DD DSN=&&TRANOUT,DISP=(OLD,DELETE)"
        : `//SYSIN    DD DISP=SHR,DSN=${toJclDatasetName(cobolArtifactPath)}`,
    "//SYSLIN   DD DSN=&&OBJ,DISP=(NEW,PASS),UNIT=SYSDA,",
    "//            SPACE=(CYL,(1,1))",
    // The link-edit step is what gives the load module its name, which is what
    // a later EXEC PGM= and a BIND MEMBER() have to agree with.
    "//LKED     EXEC PGM=IEWL,COND=(4,LT)",
    "//SYSPRINT DD SYSOUT=*",
    "//SYSLIN   DD DSN=&&OBJ,DISP=(OLD,DELETE)",
    `//SYSLMOD  DD DISP=SHR,DSN=BANKLANG.LOADLIB(${moduleName})`,
  );

  if (needsDb2) {
    lines.push(
      "//BIND     EXEC PGM=IKJEFT01,COND=(4,LT)",
      "//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD",
      "//DBRMLIB  DD DISP=SHR,DSN=DIST.DBRMLIB",
      "//SYSTSPRT DD SYSOUT=*",
      "//SYSTSIN  DD *",
      "  DSN SYSTEM(DSN)",
      `  BIND PACKAGE(BANKLANG) MEMBER(${moduleName}) ACT(REP) ISO(CS)`,
      "  END",
      "/*",
    );
  }

  // A batch program reads and writes datasets, so the run step has to name
  // them. The DD name is the one the generated SELECT assigns to, so these
  // match the program rather than being decoration.
  //
  // A CICS program has no run step at all: it is started by a transaction
  // identifier in a region, not by EXEC PGM in a job.
  if (!needsCics) {
    lines.push(`//RUN      EXEC PGM=${moduleName}`);
    if (needsDb2) {
      lines.push("//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD");
    }
    lines.push("//SYSOUT   DD SYSOUT=*");
    for (const file of program.files) {
      lines.push(
        file.mode === "input"
          ? `//${toDdName(file.name).padEnd(8)} DD DISP=SHR,DSN=BANKLANG.${toDdName(file.name)}`
          : `//${toDdName(file.name).padEnd(8)} DD DSN=BANKLANG.${toDdName(file.name)},DISP=(NEW,CATLG),`,
      );
      if (file.mode === "output") {
        lines.push("//            UNIT=SYSDA,SPACE=(CYL,(1,1))");
      }
    }
  }

  if (needsCics) {
    lines.push(
      "//* No run step: a CICS program is started by a transaction identifier",
      "//* in a region, not by EXEC PGM in a job. Install the load module and",
      "//* define the program and transaction to CICS instead.",
    );
  }

  lines.push(
    "//* This job is a documentation-friendly skeleton. Dataset names, unit",
    needsDb2
      ? "//* and space parameters, and the Db2 subsystem and package names are"
      : "//* and space parameters, and the load library name are",
    "//* placeholders for an installation's own standards.",
  );

  return {
    jcl: `${lines.join("\n")}\n`,
    jclArtifactPath,
  };
}

/**
 * A SELECT entry binding the BankTS file declaration to a DD name, with the
 * FILE STATUS clause when the declaration provides a status field. A missing
 * status is reported by the analyzer as BANK-FILE-001 rather than silently
 * omitted here.
 */
function emitFileControlEntry(
  file: IRFile,
  addLine: (line?: string) => void,
): void {
  const cobolName = fileCobolName(file.name);
  const clauses: string[] = [
    `               ORGANIZATION IS ${file.organization.toUpperCase()}`,
  ];

  // DYNAMIC rather than RANDOM: an indexed file is read by key *and* browsed
  // with START and READ NEXT, and RANDOM allows only the first. Sequential and
  // relative files stay sequential.
  if (file.organization === "indexed") {
    clauses.push(`               ACCESS MODE IS DYNAMIC`);
    if (file.keyFieldName) {
      clauses.push(
        `               RECORD KEY IS ${fdFieldName(file, file.keyFieldName)}`,
      );
    }
  } else if (file.organization === "relative") {
    clauses.push(`               ACCESS MODE IS SEQUENTIAL`);
    clauses.push(`               RELATIVE KEY IS ${relativeKeyName(file)}`);
  } else {
    clauses.push(`               ACCESS MODE IS SEQUENTIAL`);
  }

  if (file.statusName) {
    clauses.push(
      `               FILE STATUS IS ${toCobolFieldName(file.statusName)}`,
    );
  }

  addLine(`           SELECT ${cobolName} ASSIGN TO ${toDdName(file.name)}`);
  clauses.forEach((clause, index) => {
    addLine(index === clauses.length - 1 ? `${clause}.` : clause);
  });
}

/**
 * A field of the FD record, qualified by the FD record name.
 *
 * The FD record is structured rather than an opaque buffer, so per-field access
 * works. Field names are not prefixed: COBOL permits duplicate data names as
 * long as every reference is qualified, and prefixing would collide with the
 * conventional `<file>Status` name for the file status field.
 */
function fdFieldName(file: IRFile, fieldName: string): string {
  return `${toCobolFieldName(fieldName)} OF ${fileRecordName(file)}`;
}

function relativeKeyName(file: IRFile): string {
  return `${toCobolName(file.name)}-RRN`;
}

/**
 * CICS response variables need storage. The typechecker makes them readable
 * symbols, so the backend has to declare them or the generated program
 * references undefined data names.
 */
function emitCicsRespFields(
  transactions: IRTransaction[],
  addLine: (line?: string) => void,
): void {
  const declared = new Set<string>();
  for (const transaction of transactions) {
    for (const name of collectCicsRespNames(transaction.body)) {
      if (declared.has(name)) {
        continue;
      }
      declared.add(name);
      addLine(
        `       01  ${toCobolFieldName(name).padEnd(20)} PIC S9(8) COMP.`,
      );
    }
  }
}

function collectCicsRespNames(block: IRBlock): string[] {
  const names: string[] = [];
  for (const statement of block.statements) {
    if (statement.kind === "CicsStatement" && statement.respName) {
      names.push(statement.respName);
    }
    if (statement.kind === "IfStatement") {
      names.push(...collectCicsRespNames(statement.thenBranch));
      if (statement.elseBranch) {
        names.push(...collectCicsRespNames(statement.elseBranch));
      }
    }
    if (
      statement.kind === "WhileStatement" ||
      statement.kind === "ForEachStatement" ||
      statement.kind === "CursorLoopStatement"
    ) {
      names.push(...collectCicsRespNames(statement.body));
    }
    if (statement.kind === "SwitchStatement") {
      for (const branch of statement.cases) {
        names.push(...collectCicsRespNames(branch.body));
      }
      if (statement.otherwise) {
        names.push(...collectCicsRespNames(statement.otherwise));
      }
    }
  }
  return names;
}

/** Relative files need their record number declared in working storage. */
function emitRelativeKeys(
  files: IRFile[],
  addLine: (line?: string) => void,
): void {
  for (const file of files) {
    if (file.organization === "relative") {
      addLine(`       01  ${relativeKeyName(file).padEnd(20)} PIC 9(9) COMP.`);
    }
  }
}

/**
 * COBOL file names are suffixed with -FILE.
 *
 * A BankTS file and record type often share a name (`accountMaster` carrying
 * `AccountMaster`), which would otherwise produce two COBOL items with the same
 * data name. The suffix is also the conventional COBOL spelling.
 */
function fileCobolName(fileName: string): string {
  return `${toCobolName(fileName)}-FILE`;
}

function fileRecordName(file: IRFile): string {
  return `${toCobolName(file.name)}-RECORD`;
}

/**
 * z/OS DD names are at most eight characters, so the file name is folded to a
 * deterministic uppercase alphanumeric prefix.
 */
function toDdName(fileName: string): string {
  return toCobolName(fileName).replace(/-/g, "").slice(0, 8);
}

function emitLedgerInterfaceStorage(addLine: (line?: string) => void): void {
  addLine(`       01  ${LEDGER_INTERFACE_GROUP}.`);
  addLine(`           05  ${LEDGER_OPERATION_FIELD.padEnd(24)} PIC X(6).`);
  addLine(
    `           05  ${LEDGER_ACCOUNT_FIELD.padEnd(24)} PIC X(${LEDGER_ACCOUNT_LENGTH}).`,
  );
  addLine(
    `           05  ${LEDGER_AMOUNT_FIELD.padEnd(24)} ${LEDGER_AMOUNT_PICTURE}.`,
  );
  addLine(`       01  ${AUDIT_INTERFACE_GROUP}.`);
  addLine(
    `           05  ${AUDIT_EVENT_FIELD.padEnd(24)} PIC X(${AUDIT_EVENT_LENGTH}).`,
  );
  addLine(
    `           05  ${AUDIT_CORRELATION_FIELD.padEnd(24)} PIC X(${AUDIT_CORRELATION_LENGTH}).`,
  );
}

function emitRecordFields(
  fields: IRRecord["fields"],
  level: number,
  addLine: (line?: string) => void,
): void {
  const indent = " ".repeat(7 + level * 4);
  for (const field of fields) {
    emitField(field.name, field.type, level, indent, addLine);
  }
}

/** COBOL level numbers step 05, 10, 15 with nesting depth. */
function levelNumber(level: number): string {
  return String(Math.min(level * 5, 45)).padStart(2, "0");
}

function emitField(
  name: string,
  type: IRType,
  level: number,
  indent: string,
  addLine: (line?: string) => void,
): void {
  const cobolName = toCobolFieldName(name);
  const lvl = levelNumber(level);

  // A bounded array becomes OCCURS. Arrays of records nest their fields.
  if (type.kind === "array") {
    if (type.element.kind === "record") {
      addLine(`${indent}${lvl}  ${cobolName} OCCURS ${type.length} TIMES.`);
      emitRecordFields(type.element.fields, level + 1, addLine);
      return;
    }
    addLine(
      `${indent}${lvl}  ${cobolName.padEnd(20)} ${formatCobolType(type.element)}`,
    );
    addLine(`${indent}        OCCURS ${type.length} TIMES.`);
    return;
  }

  if (type.kind === "record") {
    addLine(`${indent}${lvl}  ${cobolName}.`);
    emitRecordFields(type.fields, level + 1, addLine);
    return;
  }

  // A nullable value carries a Db2-style indicator halfword beside it.
  if (type.kind === "nullable") {
    emitField(name, type.inner, level, indent, addLine);
    addLine(
      `${indent}${lvl}  ${nullIndicatorName(name).padEnd(20)} PIC S9(4) COMP.`,
    );
    return;
  }

  addLine(`${indent}${lvl}  ${cobolName.padEnd(20)} ${formatCobolType(type)}.`);

  // Enum members become level-88 condition names, the idiomatic COBOL form.
  if (type.kind === "enum") {
    for (const member of type.members) {
      addLine(
        `${indent}    88  ${enumConditionName(name, member).padEnd(28)} VALUE "${member}".`,
      );
    }
  }
}

function nullIndicatorName(fieldName: string): string {
  return `${toCobolFieldName(fieldName)}-IND`;
}

function enumConditionName(fieldName: string, member: string): string {
  return `${toCobolFieldName(fieldName)}-${toCobolName(member)}`;
}

/**
 * Return statements only assign the result field. The paragraph ends with a
 * single `GOBACK.`, because a period inside an `IF` branch would terminate the
 * COBOL sentence and leave the following `ELSE` and `END-IF` dangling.
 */
/**
 * A recursive function as its own `RECURSIVE` program.
 *
 * Parameters and the result arrive through the LINKAGE SECTION, and locals go
 * in LOCAL-STORAGE so each invocation gets its own copy.
 */
function emitRecursiveProgram(
  fn: IRFunction,
  addLine: (line?: string) => void,
): void {
  const programName = recursiveProgramName(fn.name);
  const linkageNames = fn.parameters.map(
    (_parameter, index) => `LK-P${index + 1}`,
  );
  const resultName = "LK-RESULT";

  addLine("");
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${programName} RECURSIVE.`);
  addLine("");
  addLine(`       DATA DIVISION.`);

  const locals = collectFunctionLocals(fn.body);
  const callArgs = fn.parameters.map(
    (_parameter, index) => `WS-ARG-${index + 1}`,
  );

  addLine(`       LOCAL-STORAGE SECTION.`);
  for (const local of locals) {
    addLine(
      `       01  ${toCobolFieldName(local.name).padEnd(20)} ${formatCobolType(local.declaredType)}.`,
    );
  }
  // Storage for the arguments of a nested call, per invocation.
  fn.parameters.forEach((parameter, index) => {
    addLine(
      `       01  ${callArgs[index].padEnd(20)} ${formatCobolType(parameter.type)}.`,
    );
  });
  addLine(`       01  WS-SUB-RESULT        ${formatCobolType(fn.returnType)}.`);

  addLine(`       LINKAGE SECTION.`);
  fn.parameters.forEach((parameter, index) => {
    addLine(
      `       01  ${linkageNames[index].padEnd(20)} ${formatCobolType(parameter.type)}.`,
    );
  });
  addLine(
    `       01  ${resultName.padEnd(20)} ${formatCobolType(fn.returnType)}.`,
  );

  addLine("");
  addLine(
    `       PROCEDURE DIVISION USING ${[...linkageNames, resultName].join(" ")}.`,
  );
  addLine(`       ${toCobolParagraphName(fn.name)}-BODY.`);

  const previousBindings = currentBindings;
  const previousRecursive = recursiveContext;
  currentBindings = new Map([
    // A recursive function is its own program, so its locals sit in that
    // program's LOCAL-STORAGE under their own names and can never collide with
    // a local of the same name elsewhere.
    ...locals.map(
      (local) => [local.name, toCobolFieldName(local.name)] as [string, string],
    ),
    ...fn.parameters.map(
      (parameter, index) =>
        [
          parameter.name,
          parameter.type.kind === "record"
            ? toCobolName(parameter.type.name)
            : linkageNames[index],
        ] as [string, string],
    ),
  ]);
  recursiveContext = {
    name: fn.name,
    programName,
    args: callArgs,
    subResult: "WS-SUB-RESULT",
  };

  emitStatement(fn.body, addLine, 11, resultName);

  currentBindings = previousBindings;
  recursiveContext = previousRecursive;

  addLine(`           GOBACK.`);
  addLine(`       END PROGRAM ${programName}.`);
}

function emitFunctionBody(
  fn: IRFunction,
  addLine: (line?: string) => void,
): void {
  currentBindings = routineBindings(fn.name, fn.parameters, true);
  // A function that can raise needs somewhere to jump to. Its callers perform
  // it THRU the exit paragraph, so the jump stays inside the performed range.
  currentExitLabel = fn.canFail ? exitParagraphName(fn.name) : null;
  emitStatement(fn.body, addLine, 11, functionResultName(fn.name));
  currentBindings = new Map();

  if (fn.canFail) {
    addLine(`           CONTINUE.`);
    addLine(`       ${exitParagraphName(fn.name)}.`);
    addLine(`           EXIT.`);
  } else {
    // Not GOBACK. A function is reached with PERFORM, and PERFORM returns at
    // the end of the paragraph on its own; GOBACK here would end the whole
    // program at the first function call. That compiles perfectly, which is
    // why it survived until a generated program was actually executed.
    addLine(`           CONTINUE.`);
  }

  currentExitLabel = null;
}

/**
 * Emits a raise: record the code, then leave the body.
 *
 * The two statements have to stay together. Setting the code without leaving
 * would run the rest of the body with a failure already in flight, which is
 * exactly the half-posted transaction the model exists to prevent.
 */
function emitRaiseStatement(
  statement: IRRaiseStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(`${indent}MOVE "${statement.code}" TO ${FAILURE_CODE_FIELD}`);
  if (currentExitLabel) {
    addLine(`${indent}GO TO ${currentExitLabel}`);
  }
}

function emitStatement(
  block: IRBlock,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
): void {
  const indent = " ".repeat(indentLevel);
  for (const statement of block.statements) {
    switch (statement.kind) {
      case "LetStatement":
        emitLetStatement(statement, addLine, indent);
        break;
      case "ReturnStatement":
        emitReturnStatement(statement, addLine, indent, resultName);
        break;
      case "IfStatement":
        emitIfStatement(statement, addLine, indentLevel, resultName);
        break;
      case "WhileStatement":
        emitWhileStatement(statement, addLine, indentLevel, resultName);
        break;
      case "AssignStatement":
        emitAssignStatement(statement, addLine, indent);
        break;
      case "ExpressionStatement":
        emitExpressionStatement(statement, addLine, indent);
        break;
      case "FileStatement":
        emitFileStatement(statement, addLine, indent);
        break;
      case "SwitchStatement":
        emitSwitchStatement(statement, addLine, indentLevel, resultName, false);
        break;
      case "SqlStatement":
        emitSqlStatement(
          statement,
          requireSqlDeclaration(statement.name),
          addLine,
          indent,
        );
        break;
      case "ForEachStatement":
        emitForEachStatement(
          statement,
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "CursorLoopStatement":
        emitCursorLoopStatement(
          statement,
          requireSqlDeclaration(statement.cursorName),
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "UnitOfWorkStatement":
        emitExecSql([statement.operation.toUpperCase()], addLine, indent);
        break;
      case "RaiseStatement":
        emitRaiseStatement(statement, addLine, indent);
        break;
      default:
        throw new Error(
          `Unsupported statement in function body: ${statement.kind}`,
        );
    }
  }
}

/**
 * Emits a transaction that can abandon its work.
 *
 * The shape is the standard COBOL one for a body with an early exit: a wrapper
 * that performs the body THRU its exit paragraph, then inspects the outcome.
 * Performing THRU matters — a `GO TO` out of a plain `PERFORM` range leaves the
 * flow of control undefined.
 *
 *     POST-TRANSFER.
 *         MOVE SPACES TO BANK-FAILURE-CODE
 *         PERFORM POST-TRANSFER-BODY THRU POST-TRANSFER-BODY-EXIT
 *         IF BANK-FAILURE-CODE NOT = SPACES
 *             PERFORM POST-TRANSFER-FAILURE
 *         END-IF
 *         GOBACK.
 */
function emitFailingTransaction(
  transaction: IRTransaction,
  addLine: (line?: string) => void,
): void {
  const body = bodyParagraphName(transaction.name);
  const exit = `${body}-EXIT`;
  const failure = failureParagraphName(transaction.name);

  addLine(`           MOVE SPACES TO ${FAILURE_CODE_FIELD}`);
  addLine(`           PERFORM ${body} THRU ${exit}`);
  addLine(`           IF ${FAILURE_CODE_FIELD} NOT = SPACES`);
  addLine(`               PERFORM ${failure}`);
  addLine(`           END-IF`);
  addLine(
    transaction.isCics
      ? `           EXEC CICS RETURN END-EXEC.`
      : `           GOBACK.`,
  );

  addLine(`       ${body}.`);
  currentExitLabel = exit;
  emitTransactionBody(transaction.body, addLine, 11);
  currentExitLabel = null;
  addLine(`           CONTINUE.`);
  addLine(`       ${exit}.`);
  addLine(`           EXIT.`);

  addLine(`       ${failure}.`);
  if (transaction.postsToLedger) {
    // The postings already made are not this program's to keep. Unwinding them
    // is the ledger's job, so the failure path tells it to, rather than
    // generating compensating debits and credits of its own invention.
    addLine(`           MOVE "ROLLBK" TO ${LEDGER_OPERATION_FIELD}`);
    addLine(`           MOVE SPACES TO ${LEDGER_ACCOUNT_FIELD}`);
    addLine(`           MOVE 0 TO ${LEDGER_AMOUNT_FIELD}`);
    addLine(
      `           CALL "${LEDGER_PROGRAM}" USING ${LEDGER_INTERFACE_GROUP}`,
    );
  }
  if (transaction.failureHandler) {
    emitTransactionBody(transaction.failureHandler, addLine, 11);
  }
  addLine(`           EXIT.`);
}

/**
 * Transaction bodies carry effects rather than a return value, so they emit
 * through their own path. The typechecker restricts them to let, debit, credit,
 * and audit statements.
 */
function emitTransactionBody(
  block: IRBlock,
  addLine: (line?: string) => void,
  indentLevel: number,
): void {
  const indent = " ".repeat(indentLevel);
  void indentLevel;
  for (const statement of block.statements) {
    switch (statement.kind) {
      case "LetStatement":
        emitLetStatement(statement, addLine, indent);
        break;
      case "LedgerStatement":
        emitLedgerStatement(statement, addLine, indent);
        break;
      case "AuditStatement":
        emitAuditStatement(statement, addLine, indent);
        break;
      case "IfStatement":
        emitTransactionBranch(statement, addLine, indentLevel);
        break;
      case "WhileStatement":
        emitWhileStatement(statement, addLine, indentLevel, "");
        break;
      case "AssignStatement":
        emitAssignStatement(statement, addLine, indent);
        break;
      case "ExpressionStatement":
        emitExpressionStatement(statement, addLine, indent);
        break;
      case "FileStatement":
        emitFileStatement(statement, addLine, indent);
        break;
      case "SwitchStatement":
        emitSwitchStatement(statement, addLine, indentLevel, "", true);
        break;
      case "SqlStatement":
        emitSqlStatement(
          statement,
          requireSqlDeclaration(statement.name),
          addLine,
          indent,
        );
        break;
      case "CicsStatement":
        emitCicsStatement(statement, addLine, indent);
        break;
      case "ForEachStatement":
        emitForEachStatement(statement, addLine, indentLevel, "", true);
        break;
      case "CursorLoopStatement":
        emitCursorLoopStatement(
          statement,
          requireSqlDeclaration(statement.cursorName),
          addLine,
          indentLevel,
          "",
          true,
        );
        break;
      case "UnitOfWorkStatement":
        emitExecSql([statement.operation.toUpperCase()], addLine, indent);
        break;
      case "RaiseStatement":
        emitRaiseStatement(statement, addLine, indent);
        break;
      default:
        throw new Error(
          `Unsupported statement in transaction body: ${statement.kind}`,
        );
    }
  }
}

/**
 * Ledger postings are delegated to the BankLang ledger interface described in
 * ADR-0003. The generated COBOL fills a fixed group item and calls a named
 * program rather than inlining any posting logic.
 */
function emitLedgerStatement(
  statement: IRLedgerStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(
    `${indent}MOVE "${statement.operation.toUpperCase()}" TO ${LEDGER_OPERATION_FIELD}`,
  );
  addLine(
    `${indent}MOVE ${renderExpression(statement.account)} TO ${LEDGER_ACCOUNT_FIELD}`,
  );
  addLine(
    `${indent}MOVE ${renderDecimalExpression(statement.amount)} TO ${LEDGER_AMOUNT_FIELD}`,
  );
  addLine(`${indent}CALL "${LEDGER_PROGRAM}" USING ${LEDGER_INTERFACE_GROUP}`);
}

function emitAuditStatement(
  statement: IRAuditStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(
    `${indent}MOVE ${renderExpression(statement.eventName)} TO ${AUDIT_EVENT_FIELD}`,
  );
  addLine(
    `${indent}MOVE ${renderExpression(statement.correlation)} TO ${AUDIT_CORRELATION_FIELD}`,
  );
  addLine(`${indent}CALL "${AUDIT_PROGRAM}" USING ${AUDIT_INTERFACE_GROUP}`);
}

/**
 * `for each` becomes `PERFORM VARYING` over the array's declared bound.
 *
 * The bound is a compile-time constant, so the loop cannot run past the end of
 * the table and needs no separate guard counter.
 */
function emitForEachStatement(
  statement: IRForEachStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const index = toCobolFieldName(statement.indexName);

  addLine(
    `${indent}PERFORM VARYING ${index} FROM 1 BY 1 UNTIL ${index} > ${statement.length}`,
  );
  if (inTransaction) {
    emitTransactionBody(statement.body, addLine, indentLevel + 4);
  } else {
    emitStatement(statement.body, addLine, indentLevel + 4, resultName);
  }
  addLine(`${indent}END-PERFORM`);
}

/** `switch` over an enum becomes `EVALUATE TRUE` over the level-88 names. */
function emitSwitchStatement(
  statement: IRSwitchStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const subject = renderExpression(statement.subject);

  addLine(`${indent}EVALUATE ${subject}`);
  for (const branch of statement.cases) {
    addLine(`${indent}    WHEN "${branch.member}"`);
    if (inTransaction) {
      emitTransactionBody(branch.body, addLine, indentLevel + 8);
    } else {
      emitStatement(branch.body, addLine, indentLevel + 8, resultName);
    }
  }
  if (statement.otherwise) {
    addLine(`${indent}    WHEN OTHER`);
    if (inTransaction) {
      emitTransactionBody(statement.otherwise, addLine, indentLevel + 8);
    } else {
      emitStatement(statement.otherwise, addLine, indentLevel + 8, resultName);
    }
  }
  addLine(`${indent}END-EVALUATE`);
}

/** `IF` inside a transaction branches on effects, not on a returned value. */
function emitTransactionBranch(
  statement: IRIfStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
): void {
  const indent = " ".repeat(indentLevel);
  emitCallsIn(statement.condition, addLine, indent);
  addLine(`${indent}IF ${renderCondition(statement.condition)}`);
  emitTransactionBody(statement.thenBranch, addLine, indentLevel + 4);
  if (statement.elseBranch) {
    addLine(`${indent}ELSE`);
    emitTransactionBody(statement.elseBranch, addLine, indentLevel + 4);
  }
  addLine(`${indent}END-IF`);
}

/**
 * `PERFORM UNTIL` with a guard counter.
 *
 * The declared limit is emitted as a real counter rather than trusted, so a
 * loop whose condition never goes false still terminates. BANK-TXN-004 makes
 * the limit mandatory; this makes it enforced at run time.
 */
function emitWhileStatement(
  statement: IRWhileStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
): void {
  const indent = " ".repeat(indentLevel);
  const counter = loopCounterName(statement);

  addLine(`${indent}MOVE 0 TO ${counter}`);
  addLine(
    `${indent}PERFORM UNTIL ${counter} >= ${statement.limit} OR NOT (${renderCondition(statement.condition)})`,
  );
  addLine(`${indent}    ADD 1 TO ${counter}`);
  emitStatement(statement.body, addLine, indentLevel + 4, resultName);
  addLine(`${indent}END-PERFORM`);
}

function emitAssignStatement(
  statement: IRAssignStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const target =
    statement.target.kind === "Identifier"
      ? resolveIdentifier(statement.target.name)
      : renderQualifiedFieldReference(statement.target);

  emitComputeInto(
    target,
    statement.expression,
    addLine,
    indent,
    statement.target.resolvedType,
  );
}

function emitExpressionStatement(
  statement: IRExpressionStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  emitCallsIn(statement.expression, addLine, indent);
}

/**
 * File operations, each followed by its status check when the declaration
 * bound a status field. `read` also drives the AT END path by moving the
 * end-of-file status into the status field.
 */
function emitFileStatement(
  statement: IRFileStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const file = fileCobolName(statement.fileName);

  const status = statement.statusName
    ? toCobolFieldName(statement.statusName)
    : null;

  switch (statement.operation) {
    case "open":
      // I-O is what a master file update needs: the same OPEN serves the READ
      // that finds a record and the REWRITE that puts it back.
      addLine(
        `${indent}OPEN ${statement.fileMode === "input" ? "INPUT" : statement.fileMode === "output" ? "OUTPUT" : "I-O"} ${file}`,
      );
      return;
    case "close":
      addLine(`${indent}CLOSE ${file}`);
      return;
    case "read":
      // A keyed read on an indexed file moves the key into the record key
      // field first, which is how COBOL addresses a KSDS record.
      if (statement.key && statement.keyFieldName) {
        addLine(
          `${indent}MOVE ${renderExpression(statement.key)} TO ${toCobolFieldName(statement.keyFieldName)} OF ${fileRecordNameFor(statement.fileName)}`,
        );
      }
      addLine(`${indent}READ ${file}`);
      if (statement.statusName) {
        // An indexed read reports a missing key rather than end of file.
        const notFound = statement.fileOrganization === "indexed" ? "23" : "10";
        const clause =
          statement.fileOrganization === "indexed" ? "INVALID KEY" : "AT END";
        addLine(
          `${indent}    ${clause} MOVE "${notFound}" TO ${toCobolFieldName(statement.statusName)}`,
        );
      }
      addLine(`${indent}END-READ`);
      // Field by field rather than a group move, so the correspondence between
      // the file record and working storage is explicit in the generated COBOL
      // and does not depend on the two layouts being byte-identical.
      emitRecordFieldMapping(statement, addLine, indent, "read");
      return;
    case "readNext":
      // A browse walks from wherever START left the file, so the read is
      // sequential even on an indexed dataset and reports end of data.
      addLine(`${indent}READ ${file} NEXT RECORD`);
      if (status) {
        addLine(`${indent}    AT END MOVE "10" TO ${status}`);
      }
      addLine(`${indent}END-READ`);
      emitRecordFieldMapping(statement, addLine, indent, "read");
      return;
    case "start":
      // Positions the browse. `KEY IS NOT LESS THAN` starts at the first record
      // at or after the key, which is what a range walk wants; an exact match
      // would make a browse from a partial key impossible.
      if (statement.key && statement.keyFieldName) {
        addLine(
          `${indent}MOVE ${renderExpression(statement.key)} TO ${toCobolFieldName(statement.keyFieldName)} OF ${fileRecordNameFor(statement.fileName)}`,
        );
      }
      addLine(
        `${indent}START ${file} KEY IS NOT LESS THAN ${statement.keyFieldName ? `${toCobolFieldName(statement.keyFieldName)} OF ${fileRecordNameFor(statement.fileName)}` : ""}`.trimEnd(),
      );
      if (status) {
        addLine(`${indent}    INVALID KEY MOVE "23" TO ${status}`);
      }
      addLine(`${indent}END-START`);
      return;
    case "write":
      emitRecordFieldMapping(statement, addLine, indent, "write");
      addLine(`${indent}WRITE ${fileRecordNameFor(statement.fileName)}`);
      if (status && statement.fileOrganization === "indexed") {
        // A duplicate key is the failure a WRITE to a KSDS actually has, and
        // it is silent unless the status is captured.
        addLine(`${indent}    INVALID KEY MOVE "22" TO ${status}`);
        addLine(`${indent}END-WRITE`);
      }
      return;
    case "rewrite":
      emitRecordFieldMapping(statement, addLine, indent, "write");
      addLine(`${indent}REWRITE ${fileRecordNameFor(statement.fileName)}`);
      if (status && statement.fileOrganization === "indexed") {
        addLine(`${indent}    INVALID KEY MOVE "23" TO ${status}`);
        addLine(`${indent}END-REWRITE`);
      }
      return;
    case "delete":
      if (statement.key && statement.keyFieldName) {
        addLine(
          `${indent}MOVE ${renderExpression(statement.key)} TO ${toCobolFieldName(statement.keyFieldName)} OF ${fileRecordNameFor(statement.fileName)}`,
        );
      }
      addLine(`${indent}DELETE ${file} RECORD`);
      if (status) {
        addLine(`${indent}    INVALID KEY MOVE "23" TO ${status}`);
        addLine(`${indent}END-DELETE`);
      }
      return;
  }
}

/**
 * Maps each field between the FD record and the working-storage record.
 *
 * A group `READ INTO` assumes the two layouts are byte-identical. Mapping the
 * fields explicitly makes the correspondence visible in the generated COBOL and
 * survives a layout that is merely compatible rather than identical.
 */
function emitRecordFieldMapping(
  statement: IRFileStatement,
  addLine: (line?: string) => void,
  indent: string,
  direction: "read" | "write",
): void {
  if (!statement.recordName) {
    return;
  }

  const fileRecord = fileRecordNameFor(statement.fileName);
  const target = resolveIdentifier(statement.recordName);

  for (const field of statement.recordFields) {
    const name = toCobolFieldName(field.name);
    const source = direction === "read" ? fileRecord : target;
    const destination = direction === "read" ? target : fileRecord;

    // COBOL cannot move an OCCURS item without a subscript, so a table is
    // copied element by element.
    if (field.arrayLength !== null) {
      addLine(
        `${indent}PERFORM VARYING ${COPY_INDEX_FIELD} FROM 1 BY 1 UNTIL ${COPY_INDEX_FIELD} > ${field.arrayLength}`,
      );
      addLine(
        `${indent}    MOVE ${name} OF ${source} (${COPY_INDEX_FIELD}) TO ${name} OF ${destination} (${COPY_INDEX_FIELD})`,
      );
      addLine(`${indent}END-PERFORM`);
      continue;
    }

    addLine(`${indent}MOVE ${name} OF ${source} TO ${name} OF ${destination}`);
  }
}

function recordTarget(statement: IRFileStatement): string {
  return statement.recordName
    ? resolveIdentifier(statement.recordName)
    : fileRecordNameFor(statement.fileName);
}

function fileRecordNameFor(fileName: string): string {
  return `${toCobolName(fileName)}-RECORD`;
}

/** Deterministic counter name, derived from the loop's source position. */
function loopCounterName(statement: IRWhileStatement): string {
  return `WS-LOOP-${statement.span.start.line}-${statement.span.start.column}`;
}

/**
 * Emits a range check for every computed subscript in an expression.
 *
 * COBOL does not check subscripts, so an index past the end of a table reads
 * or writes whatever storage follows it. Clamping and recording the failure
 * turns silent corruption into an observable status.
 */
function emitBoundsChecks(
  expression: IRExpression,
  addLine: (line?: string) => void,
  indent: string,
): void {
  for (const check of collectBoundsChecks(expression)) {
    addLine(
      `${indent}IF ${check.index} < 1 OR ${check.index} > ${check.length}`,
    );
    // "23" is the COBOL file-status convention for a key outside the file, and
    // is kept so an operator reading a dump sees a familiar code.
    addLine(`${indent}    MOVE "23" TO ${BOUNDS_STATUS_FIELD}`);
    if (currentExitLabel) {
      // Raising leaves the subscript untouched: clamping it would let the
      // statement run against the wrong element, which is the defect the check
      // exists to prevent.
      addLine(
        `${indent}    MOVE "${BOUNDS_FAILURE_CODE}" TO ${FAILURE_CODE_FIELD}`,
      );
      addLine(`${indent}    GO TO ${currentExitLabel}`);
    } else {
      addLine(`${indent}    MOVE ${check.length} TO ${check.index}`);
    }
    addLine(`${indent}END-IF`);
  }
}

function collectBoundsChecks(
  expression: IRExpression,
): { index: string; length: number }[] {
  const checks: { index: string; length: number }[] = [];

  const walk = (node: IRExpression): void => {
    switch (node.kind) {
      case "IndexAccess":
        walk(node.index);
        if (node.needsBoundsCheck && node.length > 0) {
          checks.push({
            index: renderDecimalExpression(node.index),
            length: node.length,
          });
        }
        return;
      case "MemberAccess":
        if (node.index) {
          walk(node.index);
          if (node.indexNeedsBoundsCheck && node.indexLength > 0) {
            checks.push({
              index: renderDecimalExpression(node.index),
              length: node.indexLength,
            });
          }
        }
        return;
      case "BinaryComparison":
      case "BinaryArithmetic":
      case "Logical":
        walk(node.left);
        walk(node.right);
        return;
      case "Not":
      case "Rounded":
        walk(node.kind === "Not" ? node.operand : node.operand);
        return;
      case "Call":
        node.args.forEach(walk);
        return;
      case "NullableCheck":
        walk(node.operand);
        return;
      default:
        return;
    }
  };

  walk(expression);
  // Only a variable subscript is worth guarding; a constant cannot drift.
  return checks.filter((check) => !/^\d+$/.test(check.index));
}

/**
 * Emits `PERFORM` for every call inside an expression before the expression is
 * used, because COBOL has no call-in-expression form. Results land in each
 * function's result field, which is what `renderExpression` reads.
 */
function emitCallsIn(
  expression: IRExpression,
  addLine: (line?: string) => void,
  indent: string,
): void {
  switch (expression.kind) {
    case "Call":
      for (const argument of expression.args) {
        emitCallsIn(argument, addLine, indent);
      }
      // Arguments are moved into the callee's parameter storage, then the
      // paragraph is performed or the program is called.
      if (!recursiveContext || expression.callee !== recursiveContext.name) {
        expression.args.forEach((argument, index) => {
          // A record parameter is a reference cell, not storage. Pointing it at
          // the argument passes the record by reference, which is what lets a
          // record that extends the declared type be passed here: its leading
          // fields sit at exactly the offsets the cell describes.
          if (argument.resolvedType.kind === "record") {
            const callee = currentFunctions.get(expression.callee);
            if (!callee?.isRecursive) {
              addLine(
                `${indent}SET ADDRESS OF ${parameterFieldName(expression.callee, index)} TO ADDRESS OF ${renderExpression(argument)}`,
              );
            }
            return;
          }
          emitArgumentInto(
            parameterFieldName(expression.callee, index),
            argument,
            addLine,
            indent,
          );
        });
      }
      const callee = currentFunctions.get(expression.callee);
      if (recursiveContext && expression.callee === recursiveContext.name) {
        expression.args.forEach((argument, index) => {
          emitArgumentInto(
            recursiveContext!.args[index],
            argument,
            addLine,
            indent,
          );
        });
        addLine(
          `${indent}CALL "${recursiveContext.programName}" USING ${[...recursiveContext.args, recursiveContext.subResult].join(", ")}`,
        );
      } else if (callee?.isRecursive) {
        // COBOL paragraphs are not reentrant, so a recursive function is a
        // separate RECURSIVE program reached with CALL.
        const operands = [
          ...expression.args.map((_argument, index) =>
            parameterFieldName(expression.callee, index),
          ),
          functionResultName(expression.callee),
        ];
        addLine(
          `${indent}CALL "${recursiveProgramName(expression.callee)}" USING ${operands.join(", ")}`,
        );
      } else if (callee?.canFail) {
        // THRU keeps the callee's `GO TO` inside the performed range.
        addLine(
          `${indent}PERFORM ${paragraphName(expression.callee)} THRU ${exitParagraphName(expression.callee)}`,
        );
      } else {
        addLine(`${indent}PERFORM ${paragraphName(expression.callee)}`);
      }

      // COBOL does not unwind, so a failure raised inside the callee only
      // propagates if the caller checks for it and leaves too.
      if (callee?.canFail && currentExitLabel) {
        addLine(`${indent}IF ${FAILURE_CODE_FIELD} NOT = SPACES`);
        addLine(`${indent}    GO TO ${currentExitLabel}`);
        addLine(`${indent}END-IF`);
      }
      return;
    case "BinaryComparison":
    case "BinaryArithmetic":
    case "Logical":
      emitCallsIn(expression.left, addLine, indent);
      emitCallsIn(expression.right, addLine, indent);
      return;
    case "Not":
      emitCallsIn(expression.operand, addLine, indent);
      return;
    case "Rounded":
      emitCallsIn(expression.operand, addLine, indent);
      return;
    default:
      return;
  }
}

/**
 * Moves one call argument into the callee's storage.
 *
 * `MOVE` cannot take an arithmetic expression, so a computed numeric argument
 * has to go through `COMPUTE`.
 */
function emitArgumentInto(
  target: string,
  argument: IRExpression,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const numeric =
    argument.resolvedType.kind === "decimal" ||
    argument.resolvedType.kind === "currency";
  const computed =
    argument.kind === "BinaryArithmetic" || argument.kind === "Rounded";

  if (numeric && computed) {
    addLine(
      `${indent}COMPUTE ${target} = ${renderDecimalExpression(argument)}`,
    );
    return;
  }

  addLine(`${indent}MOVE ${renderExpression(argument)} TO ${target}`);
}

/**
 * Assignment target plus expression, honouring a rounding mode when the
 * expression is a `round(...)` or `divide(...)`.
 */
function emitComputeInto(
  target: string,
  expression: IRExpression,
  addLine: (line?: string) => void,
  indent: string,
  /**
   * The receiving item's type, when it differs from the expression's.
   *
   * A numeric-edited item is the case that needs it: COBOL formats on a MOVE
   * into one and rejects a COMPUTE, so the decision belongs to the target
   * rather than to the value being rendered.
   */
  targetType?: IRType,
): void {
  emitCallsIn(expression, addLine, indent);
  emitBoundsChecks(expression, addLine, indent);

  // `concat` and `now` assemble a value with STRING, which is a statement and
  // cannot be the right-hand side of a MOVE.
  if (
    expression.kind === "StringCall" &&
    (expression.operation === "concat" || expression.operation === "now")
  ) {
    emitStringAssignment(target, expression, addLine, indent);
    return;
  }

  if (targetType?.kind === "edited") {
    addLine(`${indent}MOVE ${renderExpression(expression)} TO ${target}`);
    return;
  }

  if (expression.resolvedType.kind === "bool") {
    emitBooleanAssignment(indent, target, expression, addLine);
    return;
  }

  // Anything that is not numeric is moved rather than computed.
  if (
    expression.resolvedType.kind === "string" ||
    expression.resolvedType.kind === "enum" ||
    expression.resolvedType.kind === "record" ||
    expression.resolvedType.kind === "array" ||
    expression.resolvedType.kind === "nullable" ||
    // A date is numeric storage, but every value that reaches one comes from an
    // intrinsic function returning a whole number, so MOVE says what is meant
    // and avoids a COMPUTE that could silently round a calendar date.
    expression.resolvedType.kind === "temporal" ||
    expression.resolvedType.kind === "edited"
  ) {
    addLine(`${indent}MOVE ${renderExpression(expression)} TO ${target}`);
    return;
  }

  if (expression.kind === "Rounded") {
    addLine(
      `${indent}COMPUTE ${target} ROUNDED MODE IS ${COBOL_ROUNDING_MODES[expression.mode]} = ${renderDecimalExpression(expression.operand)}`,
    );
    return;
  }

  addLine(
    `${indent}COMPUTE ${target} = ${renderDecimalExpression(expression)}`,
  );
}

/**
 * Maps each name a routine's body can mention to the COBOL storage it reads.
 *
 * Record parameters resolve to the record group item; scalars get dedicated
 * fields so a call can move arguments into them. Locals come from the
 * program-wide plan, because whether one is qualified depends on whether
 * another routine declares the same name.
 */
function routineBindings(
  owner: string,
  parameters: { name: string; type: IRType }[],
  /**
   * True when record parameters are reference cells the caller rebinds, which
   * is how a function accepts any record whose layout starts with the declared
   * one. A transaction is a program entry point rather than something called
   * with varying arguments, so its records stay in working storage.
   */
  recordsByReference = false,
): Map<string, string> {
  return new Map([
    ...(currentLocalFields.get(owner) ?? new Map<string, string>()),
    ...parameters.map(
      (parameter, index) =>
        [
          parameter.name,
          parameter.type.kind === "record"
            ? recordsByReference
              ? parameterFieldName(owner, index)
              : toCobolName(parameter.type.name)
            : parameterFieldName(owner, index),
        ] as [string, string],
    ),
  ]);
}

function resolveIdentifier(name: string): string {
  // SQLCODE comes from the SQLCA, not from generated storage.
  if (name === "sqlcode") {
    return "SQLCODE";
  }
  return currentBindings.get(name) ?? toCobolFieldName(name);
}

/** `for each` index variables need storage, like any other local. */
/** True when the program calls `now()`, so the clock field is needed. */
function programUsesNow(program: IRProgram): boolean {
  return JSON.stringify([program.functions, program.transactions]).includes(
    '"operation":"now"',
  );
}

/** True when any record declares an array, so the bounds field is needed. */
function programUsesArrays(program: IRProgram): boolean {
  const hasArray = (fields: IRRecord["fields"]): boolean =>
    fields.some(
      (field) =>
        field.type.kind === "array" ||
        (field.type.kind === "record" && hasArray(field.type.fields)),
    );
  return (
    program.records.some((record) => hasArray(record.fields)) ||
    program.files.some((file) => hasArray(file.record.fields))
  );
}

function collectForEachIndexes(block: IRBlock): IRForEachStatement[] {
  const found: IRForEachStatement[] = [];
  for (const statement of block.statements) {
    if (statement.kind === "ForEachStatement") {
      found.push(statement);
      found.push(...collectForEachIndexes(statement.body));
    }
    if (
      statement.kind === "WhileStatement" ||
      statement.kind === "CursorLoopStatement"
    ) {
      found.push(...collectForEachIndexes(statement.body));
    }
    if (statement.kind === "IfStatement") {
      found.push(...collectForEachIndexes(statement.thenBranch));
      if (statement.elseBranch) {
        found.push(...collectForEachIndexes(statement.elseBranch));
      }
    }
    if (statement.kind === "SwitchStatement") {
      for (const branch of statement.cases) {
        found.push(...collectForEachIndexes(branch.body));
      }
      if (statement.otherwise) {
        found.push(...collectForEachIndexes(statement.otherwise));
      }
    }
  }
  return found;
}

function collectLoops(block: IRBlock): IRWhileStatement[] {
  const loops: IRWhileStatement[] = [];
  for (const statement of block.statements) {
    if (statement.kind === "WhileStatement") {
      loops.push(statement);
      loops.push(...collectLoops(statement.body));
    }
    if (
      statement.kind === "ForEachStatement" ||
      statement.kind === "CursorLoopStatement"
    ) {
      loops.push(...collectLoops(statement.body));
    }
    if (statement.kind === "IfStatement") {
      loops.push(...collectLoops(statement.thenBranch));
      if (statement.elseBranch) {
        loops.push(...collectLoops(statement.elseBranch));
      }
    }
  }
  return loops;
}

/**
 * CICS commands with `RESP`, which is how a program observes the outcome
 * without abending. BANK-CICS-001 makes capturing it mandatory.
 */
function emitCicsStatement(
  statement: IRCicsStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const resp = statement.respName
    ? ` RESP(${toCobolFieldName(statement.respName)})`
    : "";

  switch (statement.operation) {
    case "link": {
      const commarea = statement.commarea
        ? ` COMMAREA(${resolveIdentifier(statement.commarea)})`
        : "";
      addLine(
        `${indent}EXEC CICS LINK PROGRAM("${statement.program}")${commarea}${resp} END-EXEC`,
      );
      return;
    }
    case "syncpoint":
      addLine(`${indent}EXEC CICS SYNCPOINT${resp} END-EXEC`);
      return;
    case "rollback":
      addLine(`${indent}EXEC CICS SYNCPOINT ROLLBACK${resp} END-EXEC`);
      return;
  }
}

function sqlParameterName(statementName: string, index: number): string {
  return `${toCobolName(statementName)}-H${index + 1}`;
}

/** Cursors the program declares, for rewriting `WHERE CURRENT OF`. */
let cursorNames = new Set<string>();

/** Counts the rows a cursor loop has taken, so the declared bound can stop it. */
function cursorRowCounter(cursorName: string): string {
  return `${toCobolName(cursorName)}-ROWS`;
}

/**
 * Rewrites host variables from BankTS names to the COBOL fields they resolve
 * to: parameters become dedicated host-variable storage, and result fields
 * become qualified references into the record the row lands in.
 */
function rewriteHostVariables(
  text: string,
  declaration: IRSql,
  intoRecord: string | null,
): string {
  // `WHERE CURRENT OF <cursor>` names a cursor, not a host variable, and the
  // cursor the program declared has a COBOL name of its own. Without this the
  // positioned update refers to a cursor Db2 has never heard of.
  const positioned = text.replace(
    /\bCURRENT\s+OF\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
    (match, cursorName: string) =>
      cursorNames.has(cursorName)
        ? `CURRENT OF ${toCobolName(cursorName)}`
        : match,
  );

  return positioned.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, name: string) => {
      const parameterIndex = declaration.parameters.findIndex(
        (parameter) => parameter.name === name,
      );
      if (parameterIndex >= 0) {
        return `:${sqlParameterName(declaration.name, parameterIndex)}`;
      }
      if (intoRecord) {
        return `:${toCobolFieldName(name)} OF ${intoRecord}`;
      }
      return match;
    },
  );
}

function emitExecSql(
  lines: string[],
  addLine: (line?: string) => void,
  indent: string,
  /** True in the DATA DIVISION, where the block terminates a sentence. */
  terminated = false,
): void {
  addLine(`${indent}EXEC SQL`);
  for (const line of lines) {
    const text = line.trim();
    if (text.length > 0) {
      addLine(`${indent}    ${text}`);
    }
  }
  addLine(`${indent}END-EXEC${terminated ? "." : ""}`);
}

/**
 * `DECLARE ... CURSOR FOR ...`, one per declared cursor.
 *
 * A cursor declaration is not an executable statement — Db2 reads it at
 * precompile time — so it sits in WORKING-STORAGE next to the host variables it
 * names rather than in the paragraph that opens the cursor.
 *
 * The row's destination is deliberately absent here. `DECLARE CURSOR` may not
 * carry an `INTO`; the row arrives on the `FETCH`, which is where the compiler
 * puts the clause the author wrote on the SELECT.
 */
function emitCursorDeclarations(
  sql: IRSql[],
  addLine: (line?: string) => void,
): void {
  for (const declaration of sql) {
    if (declaration.form !== "cursor" || !declaration.cursorSelect) {
      continue;
    }
    emitExecSql(
      [
        `DECLARE ${toCobolName(declaration.name)} CURSOR FOR`,
        ...rewriteHostVariables(declaration.cursorSelect, declaration, null)
          .split("\n")
          .map((line) => `    ${line.trim()}`),
      ],
      addLine,
      "       ",
      true,
    );
  }
}

/**
 * A bounded read of a cursor: open, fetch until the rows run out or the bound
 * is reached, then close.
 *
 * `CLOSE` is emitted rather than written, so a cursor cannot be left open. The
 * loop leaves on any non-zero `SQLCODE`, not only on 100: an error that is
 * treated as end-of-data would silently process a partial result set as if it
 * were the whole one.
 */
function emitCursorLoopStatement(
  statement: IRCursorLoopStatement,
  declaration: IRSql,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const cursor = toCobolName(declaration.name);
  const counter = cursorRowCounter(declaration.name);
  const row = resolveIdentifier(statement.rowRecordName);

  statement.args.forEach((argument, index) => {
    addLine(
      `${indent}MOVE ${renderExpression(argument)} TO ${sqlParameterName(declaration.name, index)}`,
    );
  });

  emitExecSql([`OPEN ${cursor}`], addLine, indent);
  addLine(`${indent}MOVE 0 TO ${counter}`);
  addLine(`${indent}PERFORM UNTIL ${counter} >= ${statement.limit}`);
  emitExecSql(
    [
      `FETCH ${cursor}`,
      `INTO ${rewriteHostVariables(declaration.cursorInto ?? "", declaration, row)}`,
    ],
    addLine,
    `${indent}    `,
  );
  addLine(`${indent}    IF SQLCODE NOT = 0`);
  addLine(`${indent}        EXIT PERFORM`);
  addLine(`${indent}    END-IF`);
  addLine(`${indent}    ADD 1 TO ${counter}`);
  if (inTransaction) {
    emitTransactionBody(statement.body, addLine, indentLevel + 4);
  } else {
    emitStatement(statement.body, addLine, indentLevel + 4, resultName);
  }
  addLine(`${indent}END-PERFORM`);
  emitExecSql([`CLOSE ${cursor}`], addLine, indent);
}

/**
 * Emits an `EXEC SQL` block.
 *
 * Host variables are rewritten from BankTS names to the COBOL fields they
 * resolve to: parameters become dedicated host-variable storage, and result
 * fields become qualified references into the target record.
 */
function emitSqlStatement(
  statement: IRSqlStatement,
  declaration: IRSql,
  addLine: (line?: string) => void,
  indent: string,
): void {
  statement.args.forEach((argument, index) => {
    addLine(
      `${indent}MOVE ${renderExpression(argument)} TO ${sqlParameterName(declaration.name, index)}`,
    );
  });

  const intoRecord = statement.intoRecord
    ? resolveIdentifier(statement.intoRecord)
    : null;

  emitExecSql(
    rewriteHostVariables(declaration.text, declaration, intoRecord).split("\n"),
    addLine,
    indent,
  );
}

function parameterFieldName(functionName: string, index: number): string {
  return `${toCobolName(functionName)}-P${index + 1}`;
}

function emitLetStatement(
  statement: IRLetStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  emitComputeInto(
    resolveIdentifier(statement.name),
    statement.initializer,
    addLine,
    indent,
    statement.declaredType,
  );
}

function emitIfStatement(
  statement: IRIfStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
): void {
  const indent = " ".repeat(indentLevel);
  addLine(`${indent}IF ${renderCondition(statement.condition)}`);
  emitStatement(statement.thenBranch, addLine, indentLevel + 4, resultName);
  if (statement.elseBranch) {
    addLine(`${indent}ELSE`);
    emitStatement(statement.elseBranch, addLine, indentLevel + 4, resultName);
  }
  addLine(`${indent}END-IF`);
}

function emitReturnStatement(
  statement: { expression: IRExpression },
  addLine: (line?: string) => void,
  indent: string,
  resultName: string,
): void {
  emitComputeInto(resultName, statement.expression, addLine, indent);
}

/**
 * A calendar builtin, as the COBOL intrinsic functions that know the calendar.
 *
 * `INTEGER-OF-DATE` converts YYYYMMDD to a day number and `DATE-OF-INTEGER`
 * converts back, so adding thirty days is addition on the day number rather
 * than on the digits — which is the difference between the 2nd of March and the
 * 61st of January.
 */
function renderTemporalCall(expression: IRTemporalCallExpression): string {
  const [first, second] = expression.args;

  switch (expression.operation) {
    case "today":
      // CURRENT-DATE returns an alphanumeric YYYYMMDDHHMMSS...; the first eight
      // characters are the date, and NUMVAL makes them a number the receiving
      // PIC 9(8) accepts without relying on an alphanumeric-to-numeric MOVE.
      return "FUNCTION NUMVAL(FUNCTION CURRENT-DATE(1:8))";
    case "addDays":
      return `FUNCTION DATE-OF-INTEGER(FUNCTION INTEGER-OF-DATE(${renderExpression(first)}) + ${renderExpression(second)})`;
    case "daysBetween":
      return `(FUNCTION INTEGER-OF-DATE(${renderExpression(second)}) - FUNCTION INTEGER-OF-DATE(${renderExpression(first)}))`;
  }
}

/**
 * A string builtin, as the COBOL that does the same thing.
 *
 * `trim`, `upper`, and `lower` are intrinsic functions. `substring` is
 * reference modification, `s(start:length)`, which is why its bounds have to be
 * written as literals — a COBOL field has a fixed length and the compiler has to
 * know it. `concat` and `now` build a value rather than name one, so they cannot
 * appear inline; `emitStringAssignment` handles those.
 */
function renderStringCall(expression: IRStringCallExpression): string {
  const [first, second, third] = expression.args;

  switch (expression.operation) {
    case "trim":
      return `FUNCTION TRIM(${renderExpression(first)})`;
    case "upper":
      return `FUNCTION UPPER-CASE(${renderExpression(first)})`;
    case "lower":
      return `FUNCTION LOWER-CASE(${renderExpression(first)})`;
    case "substring":
      return `${renderExpression(first)}(${renderExpression(second)}:${renderExpression(third)})`;
    case "concat":
    case "now":
      throw new Error(
        `${expression.operation} builds a value and is emitted as a statement.`,
      );
  }
}

/**
 * The field `now()` reads the clock into.
 *
 * `FUNCTION CURRENT-DATE` returns 21 characters, and a Db2 timestamp is 26 in a
 * different arrangement, so the value has to land somewhere before it can be
 * taken apart.
 */
const CURRENT_DATE_FIELD = "BANK-CURRENT-DATE";

/**
 * `concat` and `now`, which build a value rather than name one.
 *
 * COBOL assembles a string with `STRING ... INTO`, which is a statement, so
 * these cannot render inline the way an intrinsic function can.
 */
function emitStringAssignment(
  target: string,
  expression: IRStringCallExpression,
  addLine: (line?: string) => void,
  indent: string,
): void {
  if (expression.operation === "now") {
    // CURRENT-DATE is YYYYMMDDHHMMSShh...; a Db2 timestamp is
    // YYYY-MM-DD-HH.MM.SS.NNNNNN. Hundredths are all the clock offers, so the
    // last four digits of the microseconds are zeros rather than invented.
    addLine(`${indent}MOVE FUNCTION CURRENT-DATE TO ${CURRENT_DATE_FIELD}`);
    addLine(`${indent}STRING ${CURRENT_DATE_FIELD}(1:4) DELIMITED BY SIZE`);
    for (const [literal, slice] of [
      ["-", "(5:2)"],
      ["-", "(7:2)"],
      ["-", "(9:2)"],
      [".", "(11:2)"],
      [".", "(13:2)"],
      [".", "(15:2)"],
    ] as const) {
      addLine(`${indent}       "${literal}" DELIMITED BY SIZE`);
      addLine(
        `${indent}       ${CURRENT_DATE_FIELD}${slice} DELIMITED BY SIZE`,
      );
    }
    addLine(`${indent}       "0000" DELIMITED BY SIZE`);
    addLine(`${indent}       INTO ${target}`);
    return;
  }

  addLine(`${indent}MOVE SPACES TO ${target}`);
  addLine(
    `${indent}STRING ${renderExpression(expression.args[0])} DELIMITED BY SIZE`,
  );
  for (const argument of expression.args.slice(1)) {
    addLine(`${indent}       ${renderExpression(argument)} DELIMITED BY SIZE`);
  }
  addLine(`${indent}       INTO ${target}`);
}

function renderExpression(expression: IRExpression): string {
  switch (expression.kind) {
    case "StringCall":
      return renderStringCall(expression);
    case "TemporalCall":
      return renderTemporalCall(expression);
    case "Identifier":
      return resolveIdentifier(expression.name);
    case "DecimalLiteral":
      return expression.text;
    case "BooleanLiteral":
      return expression.value ? "TRUE" : "FALSE";
    case "StringLiteral":
      return `"${expression.value}"`;
    case "MemberAccess":
      return renderQualifiedFieldReference(expression);
    case "BinaryComparison":
      return `${renderExpression(expression.left)} ${COBOL_COMPARISONS[expression.operator]} ${renderExpression(expression.right)}`;
    case "BinaryArithmetic":
      return `${renderExpression(expression.left)} ${expression.operator} ${renderExpression(expression.right)}`;
    case "Logical":
      return `${renderExpression(expression.left)} ${expression.operator === "&&" ? "AND" : "OR"} ${renderExpression(expression.right)}`;
    case "Not":
      return `NOT (${renderExpression(expression.operand)})`;
    case "Rounded":
      return renderDecimalExpression(expression.operand);
    case "Call":
      // Inside a recursive program a self-call returns into that program's own
      // per-invocation result field, not the caller's.
      return recursiveContext && expression.callee === recursiveContext.name
        ? recursiveContext.subResult
        : functionResultName(expression.callee);
    case "EnumMember":
      return `"${expression.member}"`;
    case "IndexAccess":
      return `${renderExpression(expression.target)} (${renderExpression(expression.index)})`;
    case "NullableCheck":
      return expression.operation === "isPresent"
        ? `${nullIndicatorFor(expression.operand)} = 0`
        : renderExpression(expression.operand);
  }
}

/**
 * The indicator halfword beside a nullable value. Zero means present, which
 * follows the Db2 null-indicator convention.
 */
function nullIndicatorFor(expression: IRExpression): string {
  if (expression.kind === "Identifier") {
    return `${toCobolFieldName(expression.name)}-IND`;
  }
  if (expression.kind === "MemberAccess") {
    return `${toCobolFieldName(expression.member)}-IND OF ${recordGroupFor(expression)}`;
  }
  return "0";
}

/**
 * The group item a record-typed name refers to in the body being emitted.
 *
 * Inside a function, a record parameter is a LINKAGE cell the caller points at
 * the argument, so the field has to be qualified by the cell rather than by the
 * record type's own working-storage group. Qualifying by the type would read
 * whatever happened to be in that group and silently return the wrong number.
 */
function recordGroupFor(expression: IRMemberAccessExpression): string {
  return (
    currentBindings.get(expression.targetName) ??
    toCobolName(expression.recordName)
  );
}

/**
 * COBOL qualifies a field with the group item that contains it, so
 * `request.amount` becomes `AMOUNT OF TRANSFER-REQUEST`.
 */
function renderQualifiedFieldReference(
  expression: IRMemberAccessExpression,
): string {
  const base = `${toCobolFieldName(expression.member)} OF ${recordGroupFor(expression)}`;
  // A subscripted field is written `FIELD OF RECORD (INDEX)`.
  return expression.index
    ? `${base} (${renderExpression(expression.index)})`
    : base;
}

function renderDecimalExpression(expression: IRExpression): string {
  switch (expression.kind) {
    case "Identifier":
      return resolveIdentifier(expression.name);
    case "DecimalLiteral":
      return expression.text;
    case "MemberAccess":
      return renderQualifiedFieldReference(expression);
    case "BinaryArithmetic":
      return `(${renderDecimalExpression(expression.left)} ${expression.operator} ${renderDecimalExpression(expression.right)})`;
    case "Rounded":
      return renderDecimalExpression(expression.operand);
    case "Call":
      return recursiveContext && expression.callee === recursiveContext.name
        ? recursiveContext.subResult
        : functionResultName(expression.callee);
    case "IndexAccess":
      return `${renderExpression(expression.target)} (${renderDecimalExpression(expression.index)})`;
    case "NullableCheck":
      return renderDecimalExpression(expression.operand);
    default:
      return renderExpression(expression);
  }
}

function renderCondition(expression: IRExpression): string {
  switch (expression.kind) {
    case "BooleanLiteral":
      return expression.value ? "1 = 1" : "1 = 0";
    case "Identifier":
      return expression.resolvedType.kind === "bool"
        ? `${resolveIdentifier(expression.name)} = 'Y'`
        : resolveIdentifier(expression.name);
    case "MemberAccess":
      return expression.resolvedType.kind === "bool"
        ? `${renderQualifiedFieldReference(expression)} = 'Y'`
        : renderQualifiedFieldReference(expression);
    case "Logical":
      return `(${renderCondition(expression.left)}) ${expression.operator === "&&" ? "AND" : "OR"} (${renderCondition(expression.right)})`;
    case "Not":
      return `NOT (${renderCondition(expression.operand)})`;
    case "Call":
      return `${functionResultName(expression.callee)} = 'Y'`;
    case "NullableCheck":
      return expression.operation === "isPresent"
        ? `${nullIndicatorFor(expression.operand)} = 0`
        : renderExpression(expression);
    case "BinaryComparison":
      return `${renderDecimalExpression(expression.left)} ${COBOL_COMPARISONS[expression.operator]} ${renderDecimalExpression(expression.right)}`;
    default:
      return renderExpression(expression);
  }
}

function emitBooleanAssignment(
  indent: string,
  targetName: string,
  expression: IRExpression,
  addLine: (line?: string) => void,
): void {
  if (expression.kind === "BooleanLiteral") {
    addLine(`${indent}MOVE '${expression.value ? "Y" : "N"}' TO ${targetName}`);
    return;
  }

  addLine(`${indent}IF ${renderCondition(expression)}`);
  addLine(`${indent}    MOVE 'Y' TO ${targetName}`);
  addLine(`${indent}ELSE`);
  addLine(`${indent}    MOVE 'N' TO ${targetName}`);
  addLine(`${indent}END-IF`);
}

/**
 * Every `let` in a body, wherever it is nested.
 *
 * COBOL has no block scope: a local declared inside a loop still needs an 01
 * item in WORKING-STORAGE. Visiting only the top level and the branches of an
 * `if` left a local declared inside a `while` with no storage at all, which
 * GnuCOBOL rejects as an undefined name.
 */
function collectFunctionLocals(block: IRBlock): IRLetStatement[] {
  const locals: IRLetStatement[] = [];
  const seen = new Set<string>();

  const visit = (current: IRBlock): void => {
    for (const statement of current.statements) {
      switch (statement.kind) {
        case "LetStatement":
          if (!seen.has(statement.name)) {
            seen.add(statement.name);
            locals.push(statement);
          }
          break;
        case "IfStatement":
          visit(statement.thenBranch);
          if (statement.elseBranch) {
            visit(statement.elseBranch);
          }
          break;
        case "WhileStatement":
        case "ForEachStatement":
        case "CursorLoopStatement":
          visit(statement.body);
          break;
        case "SwitchStatement":
          for (const branch of statement.cases) {
            visit(branch.body);
          }
          if (statement.otherwise) {
            visit(statement.otherwise);
          }
          break;
        default:
          break;
      }
    }
  };

  visit(block);
  return locals;
}

/**
 * Every routine whose locals share the main program's WORKING-STORAGE.
 *
 * A recursive function is a sibling program with its own LOCAL-STORAGE, so its
 * locals are neither at risk of colliding here nor a reason to qualify a name
 * that is otherwise unique.
 */
function localOwners(
  program: IRProgram,
): { name: string; locals: IRLetStatement[] }[] {
  return [
    ...program.functions
      .filter((fn) => !fn.isRecursive)
      .map((fn) => ({
        name: fn.name,
        locals: collectFunctionLocals(fn.body),
      })),
    ...program.transactions.map((transaction) => ({
      name: transaction.name,
      locals: [
        ...collectFunctionLocals(transaction.body),
        ...(transaction.failureHandler
          ? collectFunctionLocals(transaction.failureHandler)
          : []),
      ],
    })),
  ];
}

/**
 * The WORKING-STORAGE field each routine's locals are emitted as.
 *
 * Every local becomes an 01 item, so two routines that both declare `scratch`
 * used to emit two `01 SCRATCH` items — with different PICTUREs if the two
 * locals had different types. A name only one routine declares keeps it, which
 * is what a COBOL maintainer reading the BankTS source expects to find; a name
 * more than one routine declares is qualified with its owner, the same way
 * parameters and results already are. Qualifying only on collision follows the
 * rule paragraph names use, and keeps the common case short: a name is capped
 * at 30 characters on IBM Enterprise COBOL.
 */
function planLocalFields(program: IRProgram): Map<string, Map<string, string>> {
  const owners = localOwners(program);

  const ownerCount = new Map<string, number>();
  for (const owner of owners) {
    for (const name of new Set(
      owner.locals.map((local) => toCobolFieldName(local.name)),
    )) {
      ownerCount.set(name, (ownerCount.get(name) ?? 0) + 1);
    }
  }

  const plan = new Map<string, Map<string, string>>();
  for (const owner of owners) {
    const fields = new Map<string, string>();
    for (const local of owner.locals) {
      const bare = toCobolFieldName(local.name);
      fields.set(
        local.name,
        (ownerCount.get(bare) ?? 0) > 1
          ? `${toCobolName(owner.name)}-${bare}`
          : bare,
      );
    }
    plan.set(owner.name, fields);
  }

  return plan;
}

/** The field a local is emitted as, for the routine that declares it. */
function localFieldName(owner: string, local: string): string {
  return currentLocalFields.get(owner)?.get(local) ?? toCobolFieldName(local);
}

function functionResultName(functionName: string): string {
  return toCobolName(`${functionName}Result`);
}

function defaultCobolArtifactPath(moduleName: string): string {
  return `dist/cobol/${toCobolProgramId(moduleName)}.cbl`;
}

function defaultJclArtifactPath(moduleName: string): string {
  return `dist/jcl/${toCobolProgramId(moduleName)}.jcl`;
}

function toJclJobName(moduleName: string): string {
  return toCobolProgramId(moduleName).replace(/-/g, "").slice(0, 8);
}

function toJclDatasetName(cobolArtifactPath: string): string {
  return cobolArtifactPath
    .replace(/\.cbl$/i, "")
    .replace(/\//g, ".")
    .replace(/-/g, "")
    .toUpperCase();
}

function formatCobolType(type: IRType): string {
  switch (type.kind) {
    case "edited":
      return editedPicture(type.style, type.precision, type.scale);
    case "temporal":
      return temporalPicture(type.unit);
    case "decimal":
      return decimalPicture(type.precision, type.scale, type.usage);
    case "string":
      return `PIC X(${type.length})`;
    case "bool":
      return "PIC X VALUE 'N'";
    case "record":
      return toCobolName(type.name);
    case "currency":
      return decimalPicture(type.precision, type.scale);
    case "enum":
      return `PIC X(${enumWidth(type.members)})`;
    case "nullable":
      return formatCobolType(type.inner);
    case "array":
      return formatCobolType(type.element);
  }
}

export function renderCopybook(record: IRRecord): string {
  const layout = describeRecordLayout(record);
  const lines = [
    "*> Generated by bankc.",
    "*> Do not edit this file directly.",
    `01  ${layout.cobolName}.`,
    ...layout.fields.map(
      (field) => `    05  ${field.cobolName.padEnd(20)} ${field.picture}.`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

export function countPackedDecimalBytes(precision: number): number {
  return packedDecimalByteLength(precision);
}
