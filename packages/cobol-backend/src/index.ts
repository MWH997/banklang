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
  IRSearchStatement,
  IRCheckpointStatement,
  IRConsoleStatement,
  IRParameter,
  IRSortProcedure,
  IRSortStatement,
  IRReleaseStatement,
  IRRestartStatement,
  IRReport,
  IRSerializeStatement,
  IRXmlParseStatement,
  IRSplitStatement,
  IRStringCallExpression,
  IRNumericCallExpression,
  IRDatabase,
  IRDliStatement,
  IRProgramCallStatement,
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
import { toJclStatement, toReferenceFormat } from "./reference-format";

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

/**
 * The return code the program means to end with.
 *
 * `RETURN-CODE` cannot hold it while the program is still running. It is a
 * shared special register, and the Language Reference is explicit about what a
 * call does to it: "the RETURN-CODE special register in the calling program is
 * set to the value of the RETURN-CODE special register in the called program".
 * Every generated transaction ends by calling BANKAUDT, so a `returnCode = 8`
 * set anywhere before that was overwritten with the audit program's zero, and
 * the job reported success on a run the program had already condemned — with
 * every `COND=(4,LT)` step after it running on that basis.
 *
 * Held here and moved into `RETURN-CODE` on the way out, after the last call.
 * The failure paths do not use it: each sets `RETURN-CODE` and returns with
 * nothing in between, so there is nothing left to overwrite it.
 */
const RETURN_CODE_FIELD = "BANK-RETURN-CODE";

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

/**
 * A contained program's name, which a `CALL` names as a literal.
 *
 * Same eight-character shape as a sibling's: a contained program is not
 * link-edited separately, but the name still has to be one COBOL accepts.
 */
function nestedProgramName(name: string): string {
  return recursiveProgramName(name);
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
    // A recursive or nested function is its own program and receives its
    // records through its own PROCEDURE DIVISION USING clause instead.
    if (fn.isRecursive || fn.isNested) {
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
 * The section the program's own paragraphs live in.
 *
 * Only needed when DECLARATIVES exist: everything after them has to be in a
 * section, and a paragraph outside one would not compile.
 */
const MAIN_SECTION = "BANK-BODY";

/** The DECLARATIVES section and paragraph handling one file's I/O errors. */
function errorSectionName(fileName: string): string {
  return `${toCobolName(fileName)}-ERROR-SECTION`;
}

function errorParagraphName(fileName: string): string {
  return `${toCobolName(fileName)}-ERROR`;
}

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
  /** `DECIMAL-POINT IS COMMA`, for a program written for a comma locale. */
  decimalPoint?: "point" | "comma";
  /** `CURRENCY SIGN IS`, for what an edited picture's currency position prints. */
  currencySign?: string;
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
  currentDecimalPoint = options.decimalPoint ?? "point";
  currentLocalFields = planLocalFields(program);
  declaredDataNames = collectDataNames(program);
  currentFunctions = new Map(program.functions.map((fn) => [fn.name, fn]));

  // Every line goes through reference format on the way in, so `lineNumber`
  // counts the lines the artifact will actually have and the source map points
  // at them. Formatting the text afterwards would renumber everything under a
  // map already written against the unformatted line count.
  const addLine = (line = "") => {
    lines.push(...toReferenceFormat(line));
  };

  const lineNumber = () => lines.length + 1;

  // Column 7 is the indicator area, so a comment starting in column 1 puts its
  // fourth character there and the line is rejected. Indented to Area A, `*>`
  // is the floating comment indicator and reads the same.
  addLine("       *> Generated by bankc.");
  addLine("       *> Do not edit this file directly.");
  addLine("       *> Source maps are available in dist/maps.");
  const moduleLine = lineNumber();
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${toCobolProgramId(program.moduleName)}.`);
  addLine("");

  // SPECIAL-NAMES sets conventions for the whole program, so it comes before
  // FILE-CONTROL and exists even in a program with no files.
  const specialNames: string[] = [];
  if (options.decimalPoint === "comma") {
    specialNames.push(`           DECIMAL-POINT IS COMMA`);
  }
  if (options.currencySign && options.currencySign !== "$") {
    specialNames.push(`           CURRENCY SIGN IS "${options.currencySign}"`);
  }

  if (program.files.length > 0 || specialNames.length > 0) {
    addLine(`       ENVIRONMENT DIVISION.`);
  }

  if (specialNames.length > 0) {
    addLine(`       CONFIGURATION SECTION.`);
    addLine(`       SPECIAL-NAMES.`);
    specialNames.forEach((clause, index) => {
      addLine(index === specialNames.length - 1 ? `${clause}.` : clause);
    });
    addLine("");
  }

  if (program.files.length > 0) {
    addLine(`       INPUT-OUTPUT SECTION.`);
    addLine(`       FILE-CONTROL.`);
    const restartFiles = new Set([
      ...checkpointedFiles(program),
      ...restartedFiles(program),
    ]);
    for (const file of program.files) {
      emitFileControlEntry(file, addLine, restartFiles.has(file.name));
    }

    // A sort-work file needs a SELECT, but not a dataset: the SD rather than an
    // FD is what says the sort owns its blocking and record handling, and the
    // assign name on one is treated as documentation. Two of them may carry the
    // same name for that reason, which is why nothing here is made unique.
    for (const sorted of sortedFiles(program)) {
      addLine(
        `           SELECT ${sortWorkName(sorted)} ASSIGN TO ${sortWorkDdName(sorted)}.`,
      );
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
      // LINAGE is what makes a report paginate: COBOL counts the lines written
      // and signals AT END-OF-PAGE at the footing, which is where the totals
      // and the next heading go.
      // A file carrying a report says so on the FD, and the RD in the REPORT
      // SECTION describes what goes into it. The two are exclusive: a report
      // counts the lines itself, so it does not also take a LINAGE.
      const reports = program.reports.filter(
        (report) => report.fileName === file.name,
      );
      if (reports.length > 0) {
        addLine(
          `       FD  ${fileCobolName(file.name)} REPORT IS ${reports.map((report) => toCobolName(report.name)).join(" ")}.`,
        );
        continue;
      }

      // RECORD IS VARYING writes only what the record uses rather than padding
      // every one to the longest it might hold, and the depending field is how
      // the program says how much that is.
      if (file.recordVarying) {
        addLine(
          `       FD  ${fileCobolName(file.name)} RECORD IS VARYING IN SIZE FROM ${file.recordVarying.min} TO ${file.recordVarying.max} CHARACTERS`,
        );
        // Unqualified, which is right only while the depending item lives
        // outside the record being described — then there is one of it and the
        // name resolves. A length declared as a *member* of that record is both
        // ambiguous, because the record is emitted in working storage and again
        // inside this FD, and wrong, because it would be part of the data whose
        // length it is giving. Both compilers reject the result.
        //
        // KNOWN GAP: nothing checks that yet, so such a program compiles here
        // and fails at cobc with "'<name>' is ambiguous; needs qualification".
        addLine(
          `               DEPENDING ON ${toCobolFieldName(file.recordVarying.lengthName)}.`,
        );
        addLine(`       01  ${fileRecordName(file)}.`);
        suppressInitialValues = true;
        emitRecordFields(file.record.fields, 1, addLine);
        suppressInitialValues = false;
        emitAllRenames(
          file.record,
          fileRecordName(file),
          addLine,
          " ".repeat(11),
        );
        continue;
      }

      if (file.linage) {
        const clauses = [`           LINAGE IS ${file.linage.lines} LINES`];
        if (file.linage.footingAt !== null) {
          clauses.push(
            `               WITH FOOTING AT ${file.linage.footingAt}`,
          );
        }
        if (file.linage.linesAtTop !== null) {
          clauses.push(`               LINES AT TOP ${file.linage.linesAtTop}`);
        }
        if (file.linage.linesAtBottom !== null) {
          clauses.push(
            `               LINES AT BOTTOM ${file.linage.linesAtBottom}`,
          );
        }
        addLine(`       FD  ${fileCobolName(file.name)}`);
        clauses.forEach((clause, index) =>
          addLine(index === clauses.length - 1 ? `${clause}.` : clause),
        );
      } else {
        addLine(`       FD  ${fileCobolName(file.name)}.`);
      }
      addLine(`       01  ${fileRecordName(file)}.`);
      suppressInitialValues = true;
      emitRecordFields(file.record.fields, 1, addLine);
      suppressInitialValues = false;
      emitAllRenames(
        file.record,
        fileRecordName(file),
        addLine,
        " ".repeat(11),
      );
    }

    // An internal SORT runs through a sort-work file, described by SD rather
    // than FD because the sort owns its blocking and record handling.
    for (const sorted of sortedFiles(program)) {
      const file = program.files.find((entry) => entry.name === sorted);
      if (!file) {
        continue;
      }
      addLine("");
      addLine(`       SD  ${sortWorkName(file.name)}.`);
      addLine(`       01  ${sortWorkRecordName(file.name)}.`);
      suppressInitialValues = true;
      emitRecordFields(file.record.fields, 1, addLine);
      suppressInitialValues = false;
      emitAllRenames(
        file.record,
        sortWorkRecordName(file.name),
        addLine,
        " ".repeat(11),
      );
    }
  }

  addLine(`       WORKING-STORAGE SECTION.`);

  // The SQLCA carries SQLCODE, which the analyzer requires the program to test.
  if (program.sql.length > 0) {
    addLine(`           EXEC SQL INCLUDE SQLCA END-EXEC.`);
    // Every host variable an SQL statement references has to be declared in a
    // declare section. The SQLCA include stays outside it — it is not a host
    // variable — and so does DECLARE CURSOR, which is a statement rather than a
    // declaration and is emitted after the section closes.
    addLine(`           EXEC SQL BEGIN DECLARE SECTION END-EXEC.`);
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
  }

  for (const file of program.files) {
    if (file.statusName) {
      addLine(
        `       01  ${toCobolFieldName(file.statusName).padEnd(20)} ${FILE_STATUS_PICTURE}.`,
      );
    }
    // The used length of a varying record: set before a write, filled by a
    // read. It is the program's, not the file's, which is why it lives here.
    if (file.recordVarying) {
      addLine(
        `       01  ${toCobolFieldName(file.recordVarying.lengthName).padEnd(20)} PIC S9(4) COMP.`,
      );
    }
  }
  emitDliWorkingStorage(program, addLine);
  emitRelativeKeys(program.files, addLine);
  emitCicsRespFields(program.transactions, addLine);
  // A recursive or nested function is called, not performed, so the caller
  // still needs somewhere to put the arguments and receive the result.
  for (const fn of program.functions) {
    if (!fn.isRecursive && !fn.isNested) {
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
  for (const file of checkpointedFiles(program)) {
    addLine(
      `       01  ${checkpointCounterName(file).padEnd(20)} PIC 9(9) COMP.`,
    );
  }
  // A restart's own flag rather than the file status, because "no position
  // written yet" is the ordinary first run and not an I/O failure to report.
  for (const file of restartedFiles(program)) {
    addLine(
      `       01  ${restartFoundFlag(file).padEnd(20)} PIC X(1) VALUE "N".`,
    );
  }
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
  addLine(`       01  ${RETURN_CODE_FIELD.padEnd(20)} PIC S9(4) COMP VALUE 0.`);
  // A sort procedure's loop stops on a flag of its own rather than on the
  // file's status field, because a sort's input file need not declare one and
  // a RETURN has no status field at all.
  for (const { statement } of sortStatements(program)) {
    for (const kind of ["input", "output"] as const) {
      const procedure =
        kind === "input" ? statement.inputProcedure : statement.outputProcedure;
      if (procedure) {
        addLine(
          `       01  ${sortProcedureEndFlag(statement, kind).padEnd(20)} PIC X(1) VALUE "N".`,
        );
      }
    }
  }

  // Each handler needs a name, and the statement and its section are emitted in
  // different places, so the names are assigned once up front.
  databaseTable = new Map(
    program.databases.map((database) => [database.name, database]),
  );
  fileStatusNames = new Map(
    program.files
      .filter((file) => file.statusName)
      .map((file) => [file.name, toCobolFieldName(file.statusName as string)]),
  );
  const xmlParses = xmlParseStatements(program);
  xmlHandlerIndexes = new Map(
    xmlParses.map((owned, index) => [owned.statement, index]),
  );
  for (let index = 0; index < xmlParses.length; index += 1) {
    // The element a start tag opened, so the content that follows can be filed
    // under it. XML-EVENT names the token; nothing carries the element itself.
    addLine(
      `       01  ${`${xmlHandlerName(index)}-ELEM`.padEnd(20)} PIC X(30).`,
    );
    // Character content can be split across events at arbitrary points, so the
    // pieces are accumulated here and assigned only once the parser says the
    // value is complete. Moving each fragment straight to its field keeps the
    // last one and loses the rest, which reads as a short but plausible value.
    addLine(
      `       01  ${`${xmlHandlerName(index)}-BUF`.padEnd(20)} PIC X(${XML_CONTENT_BUFFER}).`,
    );
    addLine(
      `       01  ${`${xmlHandlerName(index)}-PTR`.padEnd(20)} PIC S9(9) COMP VALUE 1.`,
    );
  }

  const copybookMode = options.copybookMode ?? "inline";
  // A contained program reads the container's storage only where the container
  // says GLOBAL, and reading the module's records without being passed them is
  // the whole reason to write a nested function. Nothing else changes: GLOBAL
  // adds no storage and moves no field.
  const shareRecords = program.functions.some((fn) => fn.isNested);
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

    addLine(`       01  ${layout.cobolName}${shareRecords ? " GLOBAL" : ""}.`);
    // Field start lines are recorded as they are emitted, because a field can
    // span several lines: an enum adds level-88 entries, a nullable adds an
    // indicator, and an array of records nests its own fields.
    // Fields are recorded in the order they are emitted, not the order they are
    // declared: a renames carries no storage and is written as a level-66 after
    // the rest, so its line is not where its declaration sits among them.
    const emitted: { field: IRField; line: number }[] = [];
    for (const field of record.fields) {
      if (field.renames) {
        continue;
      }
      emitted.push({ field, line: lineNumber() });
      emitField(
        field.name,
        field.type,
        1,
        " ".repeat(11),
        addLine,
        fieldClauses(field),
      );
    }
    for (const field of record.fields) {
      if (!field.renames) {
        continue;
      }
      emitted.push({ field, line: lineNumber() });
      emitRenames(field, layout.cobolName, addLine, " ".repeat(11));
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

    emitted.forEach(({ field, line }, index) => {
      const end = (emitted[index + 1]?.line ?? recordEnd + 1) - 1;
      entries.push({
        sourceFile: program.sourceFile,
        sourceStart: field.span.start,
        sourceEnd: field.span.end,
        artifact: cobolArtifactPath,
        targetStartLine: line,
        targetEndLine: Math.max(line, end),
        category: "field",
        symbol: field.name,
      });
    });
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
    // A recursive or nested function becomes its own program, so its result,
    // parameters and locals live in that program's storage rather than here.
    if (fn.isRecursive || fn.isNested) {
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

  if (program.sql.length > 0) {
    addLine(`           EXEC SQL END DECLARE SECTION END-EXEC.`);
    // A cursor declaration is a statement about a query, not a host variable,
    // so it belongs outside the section it would otherwise sit in.
    emitCursorDeclarations(program.sql, addLine);
  }

  if (
    recordParameterCells.length > 0 ||
    cicsTransactions.length > 0 ||
    program.databases.length > 0
  ) {
    addLine("");
    addLine(`       LINKAGE SECTION.`);
  }

  // The I/O PCB comes first, always. A batch program needs it to make system
  // service calls, so `CMPAT=YES` is what IBM says to specify — and with it the
  // region passes the I/O PCB ahead of every database PCB. Omitting it does not
  // fail to compile: it shifts every DB PCB by one, so the program reads the
  // I/O PCB as its first database and works on whatever that memory holds.
  //
  // Every field, in IMS's order, because that is what a PCB mask is: a
  // description of storage the region owns. In DB batch only the status code is
  // populated, but the mask is not a list of the fields this program happens to
  // read — a short one is a description that stops being true the moment
  // anything is added to the end of it.
  if (program.databases.length > 0) {
    addLine(`       01  ${IO_PCB_NAME}.`);
    addLine(`           05  ${`${IO_PCB_NAME}-LTERM`.padEnd(24)} PIC X(8).`);
    addLine(`           05  FILLER                   PIC XX.`);
    addLine(`           05  ${`${IO_PCB_NAME}-STATUS`.padEnd(24)} PIC XX.`);
    addLine(
      `           05  ${`${IO_PCB_NAME}-DATE`.padEnd(24)} PIC S9(7) COMP-3.`,
    );
    addLine(
      `           05  ${`${IO_PCB_NAME}-TIME`.padEnd(24)} PIC S9(6)V9 COMP-3.`,
    );
    addLine(
      `           05  ${`${IO_PCB_NAME}-MSG-SEQ`.padEnd(24)} PIC S9(7) COMP.`,
    );
    addLine(`           05  ${`${IO_PCB_NAME}-MOD-NAME`.padEnd(24)} PIC X(8).`);
    addLine(`           05  ${`${IO_PCB_NAME}-USER-ID`.padEnd(24)} PIC X(8).`);
    addLine(
      `           05  ${`${IO_PCB_NAME}-GROUP-NAME`.padEnd(24)} PIC X(8).`,
    );
    // The extended time stamp. Its time is twelve packed digits carrying no
    // sign, and its UTC offset is four bits of attributes ahead of a packed
    // value, so neither is a COBOL numeric picture — X is what describes the
    // bytes without claiming they are something COBOL can compute on.
    addLine(`           05  ${IO_PCB_NAME}-TIMESTAMP.`);
    addLine(
      `               10  ${`${IO_PCB_NAME}-TS-DATE`.padEnd(20)} PIC S9(7) COMP-3.`,
    );
    addLine(
      `               10  ${`${IO_PCB_NAME}-TS-TIME`.padEnd(20)} PIC X(6).`,
    );
    addLine(
      `               10  ${`${IO_PCB_NAME}-TS-UTC`.padEnd(20)} PIC X(2).`,
    );
    addLine(`           05  ${`${IO_PCB_NAME}-USER-IND`.padEnd(24)} PIC X(1).`);
    addLine(`           05  FILLER                   PIC X(3).`);
  }

  // Then a PCB per database, in the order the PSB lists them. The program never
  // allocates one: the mask describes storage IMS owns.
  for (const database of program.databases) {
    const pcb = pcbName(database.name);
    addLine(`       01  ${pcb}.`);
    addLine(`           05  ${`${pcb}-DBD-NAME`.padEnd(24)} PIC X(8).`);
    addLine(`           05  ${`${pcb}-SEG-LEVEL`.padEnd(24)} PIC XX.`);
    addLine(`           05  ${`${pcb}-STATUS`.padEnd(24)} PIC XX.`);
    addLine(`           05  ${`${pcb}-PROC-OPTS`.padEnd(24)} PIC X(4).`);
    addLine(`           05  FILLER                   PIC S9(5) COMP.`);
    addLine(`           05  ${`${pcb}-SEG-NAME`.padEnd(24)} PIC X(8).`);
    addLine(`           05  ${`${pcb}-KEY-LENGTH`.padEnd(24)} PIC S9(5) COMP.`);
    addLine(
      `           05  ${`${pcb}-SENSEG-COUNT`.padEnd(24)} PIC S9(5) COMP.`,
    );
    addLine(`           05  ${`${pcb}-KEY-FEEDBACK`.padEnd(24)} PIC X(64).`);
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

  // The REPORT SECTION comes after LINKAGE, which is the order COBOL fixes.
  if (program.reports.length > 0) {
    addLine("");
    addLine(`       REPORT SECTION.`);
    for (const report of program.reports) {
      currentReportRecord =
        program.records.find((record) => record.name === report.recordName) ??
        null;
      emitReport(report, addLine);
      currentReportRecord = null;
    }
  }

  addLine("");
  // An IMS program is entered by the region with its PCBs, so it takes them on
  // the PROCEDURE DIVISION rather than being started like a batch program.
  addLine(
    program.databases.length > 0
      ? `       PROCEDURE DIVISION USING ${[
          IO_PCB_NAME,
          ...program.databases.map((database) => pcbName(database.name)),
        ].join(" ")}.`
      : `       PROCEDURE DIVISION.`,
  );

  // DECLARATIVES come first and are the only thing allowed to precede the
  // program's own paragraphs. A USE procedure runs when an operation on its
  // file fails, whatever the operation and wherever it was written — which is
  // what covers the statements that did not think to check the status.
  if (program.fileErrorHandlers.length > 0) {
    addLine(`       DECLARATIVES.`);
    for (const handler of program.fileErrorHandlers) {
      addLine(`       ${errorSectionName(handler.fileName)} SECTION.`);
      addLine(
        `           USE AFTER STANDARD ERROR PROCEDURE ON ${fileCobolName(handler.fileName)}.`,
      );
      addLine(`       ${errorParagraphName(handler.fileName)}.`);
      emitStatement(handler.body, addLine, 11, "");
      addLine(`           CONTINUE.`);
    }
    addLine(`       END DECLARATIVES.`);
    // Everything after DECLARATIVES has to be in a section of its own.
    addLine(`       ${MAIN_SECTION} SECTION.`);
  }

  // COBOL enters a program at the first statement of the PROCEDURE DIVISION.
  // Without this paragraph the starting point would be whichever function
  // happened to be declared first, which is not something a caller can rely on.
  const entryTransaction = findEntryTransaction(program);
  if (entryTransaction) {
    addLine(`       ${MAIN_PARAGRAPH}.`);
    addLine(`           PERFORM ${paragraphName(entryTransaction.name)}`);
    addLine(`           MOVE ${RETURN_CODE_FIELD} TO RETURN-CODE`);
    addLine(`           GOBACK.`);
  }

  for (const fn of program.functions) {
    if (fn.isRecursive || fn.isNested) {
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
    emitCommareaEntry(transaction, addLine);

    if (transaction.canFail) {
      emitFailingTransaction(transaction, addLine);
    } else {
      emitTransactionBody(transaction.body, addLine, 11);
      emitCommareaExit(transaction, addLine);
      // The last thing before leaving, so no call can overwrite it.
      addLine(`           MOVE ${RETURN_CODE_FIELD} TO RETURN-CODE`);
      // A CICS program returns control to CICS rather than to a caller.
      addLine(
        transaction.isCics
          ? endsWithReturnTransid(transaction.body)
            ? // The body already returned, naming what runs next. A second
              // RETURN would be unreachable and would read as a mistake.
              `           GOBACK.`
            : `           EXEC CICS RETURN END-EXEC.`
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

  // An XML handler is a section, so it goes after the last GOBACK for the same
  // reason a sort procedure does: a section in the flow of control would be run
  // again on the way past. XML PARSE enters it and nothing else does.
  for (const owned of xmlParses) {
    currentBindings = routineBindings(owned.owner, owned.parameters);
    emitXmlHandlerSection(
      owned.statement,
      xmlHandlerIndexes.get(owned.statement) ?? 0,
      addLine,
    );
    currentBindings = new Map();
  }

  // Sort procedures come after the last GOBACK. A section placed in the flow of
  // control would be run again on the way past, and an INPUT PROCEDURE is meant
  // to be entered by SORT and by nothing else.
  for (const owned of sortStatements(program)) {
    if (!owned.statement.inputProcedure && !owned.statement.outputProcedure) {
      continue;
    }
    currentBindings = routineBindings(owned.owner, owned.parameters);
    emitSortProcedureSections(owned.statement, addLine, owned.inTransaction);
    currentBindings = new Map();
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

  // Nested functions are contained programs, so they go inside the container —
  // before its END PROGRAM, and before any sibling. That containment is the
  // feature: a contained program reads the container's GLOBAL records without
  // being passed them.
  const nestedFunctions = program.functions.filter((fn) => fn.isNested);
  for (const fn of nestedFunctions) {
    const start = lineNumber();
    emitNestedProgram(fn, addLine);
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

  // Recursive functions are emitted as sibling programs. LOCAL-STORAGE gives
  // each invocation its own copy of the locals; WORKING-STORAGE would be
  // shared across the recursion and silently produce wrong answers.
  const recursiveFunctions = program.functions.filter((fn) => fn.isRecursive);
  if (nestedFunctions.length > 0 && recursiveFunctions.length === 0) {
    // A container that holds anything has to be closed explicitly; without a
    // sibling to follow, nothing else would write the END PROGRAM.
    addLine(`       END PROGRAM ${toCobolProgramId(program.moduleName)}.`);
  }
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
  // Report Writer is not part of Enterprise COBOL. The Language Reference says
  // so in as many words: the Report Writer module "is supported with the
  // optional IBM COBOL Report Writer Precompiler and Libraries (5798-DYR)", and
  // RD, PAGE LIMIT, CONTROL HEADING/FOOTING, SUM and COLUMN are all on the list
  // of features it supplies. A program with a REPORT SECTION handed straight to
  // IGYCRCTL does not compile.
  const needsReportWriter = program.backendRequirements.includes(
    "report-writer-precompiler",
  );
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

  // Every step after the first is bypassed when an earlier one failed. Without
  // it a failed compile still reaches the run step, which then executes
  // whatever load module the library already held — the previous version — and
  // the job ends with a return code that says it worked.
  //
  // COND states when to *skip*: 4 less than the highest return code so far.
  const cond = ",COND=(4,LT)";

  // The source each step reads: the artifact, or whatever the step before it
  // wrote. Chaining them by name here keeps the order in one place.
  let source = `//SYSIN    DD DISP=SHR,DSN=${toJclDatasetName(cobolArtifactPath)}`;
  let earlierStep = false;

  // Report Writer runs before everything else. It passes EXEC ... END-EXEC
  // through unchanged, so the CICS translator and the Db2 precompiler still
  // find their own blocks; the other way round each would have to read a REPORT
  // SECTION, which neither of them knows.
  //
  // SPCRWCOB is the stand-alone precompiler: it reads SYSIN, needs RWWORK as
  // work space, and writes the expanded COBOL to SYSINS.
  if (needsReportWriter) {
    lines.push(
      "//* A REPORT SECTION is not Enterprise COBOL. It is expanded by the",
      "//* Report Writer precompiler (5798-DYR) before the compiler sees it.",
      "//RWPRE    EXEC PGM=SPCRWCOB",
      "//STEPLIB  DD DISP=SHR,DSN=RW.SCXRPREC",
      "//SYSPRINT DD SYSOUT=*",
      source,
      "//RWWORK   DD UNIT=SYSDA,SPACE=(CYL,(1,1))",
      "//SYSINS   DD DSN=&&RWOUT,DISP=(NEW,PASS),UNIT=SYSDA,",
      "//            SPACE=(CYL,(1,1))",
    );
    source = "//SYSIN    DD DSN=&&RWOUT,DISP=(OLD,DELETE)";
    earlierStep = true;
  }

  // The CICS translator runs next: it rewrites EXEC CICS into calls before the
  // precompiler and then the compiler read the source.
  if (needsCics) {
    lines.push(
      "//* EXEC CICS must be translated before any compiler reads the source.",
      `//TRANSLAT EXEC PGM=DFHECP1$${earlierStep ? cond : ""}`,
      "//STEPLIB  DD DISP=SHR,DSN=CICSTS.SDFHLOAD",
      "//SYSPRINT DD SYSOUT=*",
      source,
      "//SYSPUNCH DD DSN=&&TRANOUT,DISP=(NEW,PASS),UNIT=SYSDA,",
      "//            SPACE=(CYL,(1,1))",
    );
    source = "//SYSIN    DD DSN=&&TRANOUT,DISP=(OLD,DELETE)";
    earlierStep = true;
  }

  if (needsDb2) {
    lines.push(
      "//* EXEC SQL must be precompiled, and the resulting DBRM bound, before",
      "//* the program can run. Neither step is optional.",
      `//PRECOMP  EXEC PGM=DSNHPC,PARM='HOST(COB2)'${earlierStep ? cond : ""}`,
      "//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD",
      `//DBRMLIB  DD DISP=SHR,DSN=DIST.DBRMLIB(${moduleName})`,
      "//SYSPRINT DD SYSOUT=*",
      source,
      "//SYSCIN   DD DSN=&&PRECOUT,DISP=(NEW,PASS),UNIT=SYSDA,",
      "//            SPACE=(CYL,(1,1))",
    );
    source = "//SYSIN    DD DSN=&&PRECOUT,DISP=(OLD,DELETE)";
    earlierStep = true;
  }

  lines.push(
    `//COMPILE  EXEC PGM=IGYCRCTL${earlierStep ? cond : ""}`,
    "//SYSPRINT DD SYSOUT=*",
    // A COPY resolves against SYSLIB. Without it the copy statements find
    // nothing and the compile fails on undefined data names.
    ...(options.usesCopybooks
      ? ["//SYSLIB   DD DISP=SHR,DSN=BANKLANG.COPYLIB"]
      : []),
    source,
    "//SYSLIN   DD DSN=&&OBJ,DISP=(NEW,PASS),UNIT=SYSDA,",
    "//            SPACE=(CYL,(1,1))",
    // The link-edit step is what gives the load module its name, which is what
    // a later EXEC PGM= and a BIND MEMBER() have to agree with.
    "//LKED     EXEC PGM=IEWL,COND=(4,LT)",
    "//SYSPRINT DD SYSOUT=*",
    "//SYSLIN   DD DSN=&&OBJ,DISP=(OLD,DELETE)",
    // The precompiler leaves external references to the Report Writer run time
    // library, so the link-edit has to resolve them. Without it the load module
    // is short of every routine the expansion calls.
    ...(needsReportWriter ? ["//SYSLIB   DD DISP=SHR,DSN=RW.SCXRRUN"] : []),
    `//SYSLMOD  DD DISP=SHR,DSN=BANKLANG.LOADLIB(${moduleName})`,
  );

  if (needsDb2) {
    lines.push(
      // IKJEFT01 here, unlike the run step: a BIND that only warns returns 4,
      // and IKJEFT1B stops the moment anything returns non-zero — so the plan
      // below would not be bound because the package warned. The step
      // allocates no datasets, so nothing turns on its abend behaviour.
      "//BIND     EXEC PGM=IKJEFT01,COND=(4,LT)",
      "//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD",
      "//DBRMLIB  DD DISP=SHR,DSN=DIST.DBRMLIB",
      "//SYSTSPRT DD SYSOUT=*",
      "//SYSTSIN  DD *",
      "  DSN SYSTEM(DSN)",
      `  BIND PACKAGE(BANKLANG) MEMBER(${moduleName}) ACT(REP) ISO(CS)`,
      // A package alone cannot be run. RUN names a plan, so the package has to
      // be listed in one; binding only the package leaves the program with
      // nothing to run under and fails at execution rather than at bind.
      `  BIND PLAN(${moduleName}) PKLIST(BANKLANG.*) ACT(REP) ISO(CS)`,
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
    if (needsDb2) {
      // A program with embedded SQL cannot be started by EXEC PGM=. It needs a
      // thread to Db2, and what establishes one is the DSN command processor:
      // the step runs TSO in batch, and DSN RUN attaches the program to the
      // subsystem under a plan. Started directly it gets no thread at all and
      // fails on its first SQL statement.
      // IKJEFT1B rather than IKJEFT01, for the abend. Both return the program's
      // code — DSN puts the highest value from the RUN subcommand in register
      // 15 — but under IKJEFT01 a program that abends does not abend the step:
      // TSO catches it and the step ends *normally* with condition code 12.
      // A step that ended normally takes the normal disposition, so the DELETE
      // on the output datasets below would not be honoured and a half-written
      // dataset would be catalogued after all. IKJEFT1B terminates the step
      // with X'04C', which is what makes a conditional disposition mean
      // something.
      lines.push(
        "//* A Db2 program is run by the DSN command processor under TSO in",
        "//* batch, not by EXEC PGM=. Starting it directly gives it no thread.",
        `//RUN      EXEC PGM=IKJEFT1B,DYNAMNBR=20${cond}`,
        "//STEPLIB  DD DISP=SHR,DSN=DSN.SDSNLOAD",
        "//SYSTSPRT DD SYSOUT=*",
      );
    } else {
      lines.push(`//RUN      EXEC PGM=${moduleName}${cond}`);
    }
    lines.push(
      "//SYSOUT   DD SYSOUT=*",
      // Without these an abend produces no readable dump, and what is left to
      // diagnose it with is the return code.
      "//CEEDUMP  DD SYSOUT=*",
      "//SYSUDUMP DD SYSOUT=*",
    );
    // The sort product spills to work datasets, and three is the customary
    // allocation. A merge needs none — its inputs already arrive in order — so
    // this asks for a real SORT rather than for a SortStatement.
    //
    // Derived here rather than declared by the caller: the program is in hand,
    // and a job whose work datasets depend on a caller remembering to say so is
    // a job that is missing them the first time someone forgets.
    if (
      sortStatements(program).some(
        (entry) => entry.statement.operation === "sort",
      )
    ) {
      for (const index of [1, 2, 3]) {
        lines.push(
          `//SORTWK0${index} DD UNIT=SYSDA,SPACE=(CYL,(5,5)),DISP=(NEW,DELETE,DELETE)`,
        );
      }
    }
    for (const file of program.files) {
      const dd = toDdName(file.name).padEnd(8);
      const dsn = `BANKLANG.${toDdName(file.name)}`;
      if (file.mode === "input") {
        lines.push(`//${dd} DD DISP=SHR,DSN=${dsn}`);
      } else if (file.mode === "update") {
        // An updated file is read and rewritten in place, so it exists already:
        // NEW would create an empty one and the program would find nothing in
        // it. OLD rather than SHR because a second job reading it mid-update
        // sees a file that is half old and half new.
        lines.push(`//${dd} DD DISP=OLD,DSN=${dsn}`);
      } else {
        // The abnormal disposition matters more than the normal one: a step
        // that dies halfway through writing has produced a partial dataset, and
        // cataloguing it invites the next job to read it as if it were
        // complete.
        lines.push(
          `//${dd} DD DSN=${dsn},DISP=(NEW,CATLG,DELETE),`,
          "//            UNIT=SYSDA,SPACE=(CYL,(1,1))",
        );
      }
    }
    if (needsDb2) {
      // Last, because DD * runs to its delimiter and anything after it would
      // be read as command input rather than as JCL.
      lines.push(
        "//SYSTSIN  DD *",
        "  DSN SYSTEM(DSN)",
        `  RUN PROGRAM(${moduleName}) PLAN(${moduleName}) -`,
        "      LIB('BANKLANG.LOADLIB')",
        "  END",
        "/*",
      );
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

  // The JCL has no source map to keep in step, so the cards are laid out once
  // at the end rather than statement by statement.
  return {
    jcl: `${lines.flatMap((line) => toJclStatement(line)).join("\n")}\n`,
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
  isRestartFile: boolean,
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
    // An alternate key is a second way into the same record. WITH DUPLICATES
    // because that is nearly always why one exists: many accounts per customer,
    // many postings per date.
    for (const alternate of file.alternateKeyNames) {
      clauses.push(
        `               ALTERNATE RECORD KEY IS ${fdFieldName(file, alternate)}`,
      );
      clauses.push(`                   WITH DUPLICATES`);
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

  // OPTIONAL for a restart file, and only for one. The first run of a batch has
  // never written a position, so the dataset does not exist yet; without this
  // the OPEN fails with status 35 and the job dies on the run that had nothing
  // to resume from. OPTIONAL is what COBOL has for a file that may legitimately
  // be absent — it is created on an OPEN I-O. Any other missing file is a
  // genuine failure and still stops the job.
  const optional = isRestartFile ? "OPTIONAL " : "";
  addLine(
    `           SELECT ${optional}${cobolName} ASSIGN TO ${toDdName(file.name)}`,
  );
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
    if (field.renames) {
      continue;
    }
    emitField(
      field.name,
      field.type,
      level,
      indent,
      addLine,
      fieldClauses(field),
    );
  }
}

/** COBOL level numbers step 05, 10, 15 with nesting depth. */
function levelNumber(level: number): string {
  return String(Math.min(level * 5, 45)).padStart(2, "0");
}

/**
 * The data description clauses a field carries.
 *
 * One place, because there are several emitters and they must not drift: the
 * generated copybook once omitted clauses the inline record had, and under
 * `copybookMode: "copy"` that was the difference between the layout the
 * compiler reported and the layout the program got.
 */
/**
 * Level-66 regroupings, after the record's own fields.
 *
 * A `RENAMES` names a run of fields that is already there and gets no storage
 * of its own, which is what distinguishes it from a `REDEFINES`. COBOL requires
 * it to follow every entry it names, so it is emitted last.
 */
function emitRenames(
  field: IRField,
  group: string,
  addLine: (line?: string) => void,
  indent: string,
): void {
  if (!field.renames) {
    return;
  }
  // Both ends are qualified by the group. The same record is emitted in working
  // storage and again inside every FD that holds it, so an unqualified field
  // name is ambiguous across them.
  addLine(
    `${indent}66  ${toCobolFieldName(field.name)} RENAMES ${toCobolFieldName(field.renames.from)} OF ${group}` +
      ` THRU ${toCobolFieldName(field.renames.to)} OF ${group}.`,
  );
}

/** Every level-66 in a record, after its own fields. */
function emitAllRenames(
  record: IRRecord,
  group: string,
  addLine: (line?: string) => void,
  indent: string,
): void {
  for (const field of record.fields) {
    emitRenames(field, group, addLine, indent);
  }
}

function fieldClauses(field: IRField): {
  redefines: string | null;
  dependingOn: string | null;
  synchronized: boolean;
  justified: boolean;
  blankWhenZero: boolean;
  initialValue: string | null;
  ascendingKey: string | null;
} {
  return {
    redefines: field.redefines,
    dependingOn: field.dependingOn,
    synchronized: field.synchronized,
    justified: field.justified,
    blankWhenZero: field.blankWhenZero,
    initialValue: field.initialValue,
    ascendingKey: field.ascendingKey,
  };
}

function emitField(
  name: string,
  type: IRType,
  level: number,
  indent: string,
  addLine: (line?: string) => void,
  /** `REDEFINES`, and `DEPENDING ON` for a variable-length table. */
  clauses: {
    redefines?: string | null;
    dependingOn?: string | null;
    synchronized?: boolean;
    justified?: boolean;
    blankWhenZero?: boolean;
    initialValue?: string | null;
    ascendingKey?: string | null;
  } = {},
): void {
  const cobolName = toCobolFieldName(name);
  const lvl = levelNumber(level);
  // A redefining field is a second reading of storage another field already
  // occupies, so the clause goes on the name and no storage is added.
  const redefines = clauses.redefines
    ? ` REDEFINES ${toCobolFieldName(clauses.redefines)}`
    : "";
  // DEPENDING ON says how much of the table this record uses. The fixed bound
  // stays as the maximum, because the storage still has to be reserved.
  const depending = clauses.dependingOn
    ? ` DEPENDING ON ${toCobolFieldName(clauses.dependingOn)}`
    : "";
  // SYNC goes after the picture, and is what tells the compiler to insert the
  // slack bytes the layout report accounts for.
  const sync = clauses.synchronized ? " SYNCHRONIZED" : "";
  // JUSTIFIED reverses the padding on an alphanumeric MOVE, so a code lands in
  // the right of the field rather than the left. BLANK WHEN ZERO is how a
  // report line with no movement prints blank instead of 0.00.
  const justified = clauses.justified ? " JUSTIFIED RIGHT" : "";
  const blankWhenZero = clauses.blankWhenZero ? " BLANK WHEN ZERO" : "";
  // COBOL does not allow VALUE in the FILE SECTION: an FD record describes a
  // buffer the file fills, so there is nothing to initialise. The same record
  // carries its initial values in working storage and drops them here.
  const initialValue =
    clauses.initialValue && !suppressInitialValues
      ? ` VALUE ${clauses.initialValue}`
      : "";

  // A bounded array becomes OCCURS. Arrays of records nest their fields.
  if (type.kind === "array") {
    // A table of tables is nested OCCURS, and COBOL subscripts the innermost
    // name with every dimension: `RATE-ITEM (I, J)`. The inner item therefore
    // needs a name of its own, which the outer group's does not give it.
    if (type.element.kind === "array") {
      addLine(
        `${indent}${lvl}  ${cobolName}${redefines} OCCURS ${depending ? "1 TO " : ""}${type.length} TIMES${depending}`,
      );
      addLine(`${indent}        INDEXED BY ${tableIndexName(name)}.`);
      emitField(
        innerTableName(name),
        type.element,
        level + 1,
        indent,
        addLine,
        { initialValue: clauses.initialValue },
      );
      return;
    }
    if (type.element.kind === "record") {
      addLine(
        `${indent}${lvl}  ${cobolName}${redefines} OCCURS ${depending ? "1 TO " : ""}${type.length} TIMES${depending}`,
      );
      // ASCENDING KEY is the promise that lets SEARCH ALL bisect. It comes
      // before INDEXED BY, which is the order COBOL requires.
      if (clauses.ascendingKey) {
        addLine(
          `${indent}        ASCENDING KEY IS ${toCobolFieldName(clauses.ascendingKey)}`,
        );
      }
      addLine(`${indent}        INDEXED BY ${tableIndexName(name)}.`);
      emitRecordFields(type.element.fields, level + 1, addLine);
      return;
    }
    addLine(
      `${indent}${lvl}  ${(cobolName + redefines).padEnd(20)} ${formatCobolType(type.element)}`,
    );
    addLine(
      `${indent}        OCCURS ${depending ? "1 TO " : ""}${type.length} TIMES${depending}`,
    );
    addLine(`${indent}        INDEXED BY ${tableIndexName(name)}.`);
    return;
  }

  if (type.kind === "record") {
    addLine(`${indent}${lvl}  ${cobolName}${redefines}.`);
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

  // A bool carries its own `VALUE 'N'`, being false unless set. An explicit
  // initial value replaces it rather than being written beside it, which COBOL
  // would reject as two VALUE clauses on one field.
  const picture = initialValue
    ? formatCobolType(type).replace(/ VALUE '.'$/, "")
    : formatCobolType(type);

  addLine(
    `${indent}${lvl}  ${(cobolName + redefines).padEnd(20)} ${picture}${sync}${justified}${blankWhenZero}${initialValue}.`,
  );

  // Enum members become level-88 condition names, the idiomatic COBOL form.
  if (type.kind === "enum") {
    for (const member of type.members) {
      addLine(
        `${indent}    88  ${enumConditionName(name, member).padEnd(28)} VALUE "${member}".`,
      );
    }
  }
}

/**
 * True while an FD or SD record is being written, where COBOL forbids `VALUE`.
 *
 * The same record is emitted in working storage and again inside every file
 * that holds it, so the clause has to be dropped in one place and kept in the
 * other rather than being decided when the field was declared.
 */
let suppressInitialValues = false;

/**
 * The name of the item inside a table of tables.
 *
 * COBOL puts every subscript on the innermost data name, so the inner
 * dimension has to be named even though nothing in the source names it.
 */
function innerTableName(fieldName: string): string {
  return `${fieldName}Item`;
}

/**
 * The same name the declaration gave the inner item, in its COBOL spelling.
 *
 * A reference like `RATES OF BOOK` keeps its qualification: only the data name
 * itself gains the suffix, so the group it belongs to still qualifies it.
 */
function withInnerTableName(base: string, depth: number): string {
  const suffix = "-ITEM".repeat(depth);
  const separator = base.indexOf(" OF ");
  return separator < 0
    ? `${base}${suffix}`
    : `${base.slice(0, separator)}${suffix}${base.slice(separator)}`;
}

function nullIndicatorName(fieldName: string): string {
  return `${toCobolFieldName(fieldName)}-IND`;
}

function enumConditionName(fieldName: string, member: string): string {
  return `${toCobolFieldName(fieldName)}-${toCobolName(member)}`;
}

/**
 * The level-88 to `SET`, when an assignment sets an enum field to a member.
 *
 * Only a record field, and only qualified by the group it sits in — which is
 * exactly the qualification the equivalent `MOVE` already carries, and it is
 * needed for the same reason: the same record is emitted in working storage and
 * again inside every `FD` that holds it, so an unqualified condition name is
 * ambiguous the moment a second record has a field of the same name.
 *
 * A local of enum type keeps its `MOVE`. Locals are `01` items that the emitter
 * only qualifies when two routines collide, so a condition name on one has no
 * group to be qualified by, and a `SET` there would be right until the day
 * somebody declared the same local elsewhere.
 */
function enumConditionAssignment(statement: IRAssignStatement): string | null {
  const target = statement.target;
  const value = statement.expression;
  if (
    target.kind !== "MemberAccess" ||
    target.resolvedType.kind !== "enum" ||
    value.kind !== "EnumMember"
  ) {
    return null;
  }

  return `${enumConditionName(target.member, value.member)} OF ${toCobolName(target.recordName)}`;
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

/**
 * A `nested function` as a COBOL contained program.
 *
 * The difference from a sibling is what it can see. A contained program reads
 * the container's `GLOBAL` items directly, so the module's records are in scope
 * without being passed — which is the whole reason to write one rather than
 * take another parameter. `COMMON` lets the container's other contained
 * programs call it too.
 *
 * Locals go in WORKING-STORAGE rather than LOCAL-STORAGE, because COBOL forbids
 * LOCAL-STORAGE in a contained program. That is also why a nested function
 * cannot recurse, and why `BANK-TYPE-027` says so rather than letting one
 * quietly share a single copy of its locals across invocations.
 */
function emitNestedProgram(
  fn: IRFunction,
  addLine: (line?: string) => void,
): void {
  const programName = nestedProgramName(fn.name);
  // A record parameter is not passed at all: the container declares the record
  // GLOBAL, so the contained program reads it by its own name. Passing it as
  // well would be a second name for storage it can already see. Scalars still
  // come through LINKAGE, because a value has to be handed over.
  const passed = fn.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter((entry) => entry.parameter.type.kind !== "record");
  const linkageNames = new Map(
    passed.map((entry, position) => [entry.index, `LK-P${position + 1}`]),
  );
  const resultName = "LK-RESULT";
  const locals = collectFunctionLocals(fn.body);

  addLine("");
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${programName} COMMON.`);
  addLine("");
  addLine(`       DATA DIVISION.`);
  if (locals.length > 0) {
    addLine(`       WORKING-STORAGE SECTION.`);
    for (const local of locals) {
      addLine(
        `       01  ${toCobolFieldName(local.name).padEnd(20)} ${formatCobolType(local.declaredType)}.`,
      );
    }
  }

  addLine(`       LINKAGE SECTION.`);
  for (const entry of passed) {
    addLine(
      `       01  ${(linkageNames.get(entry.index) ?? "").padEnd(20)} ${formatCobolType(entry.parameter.type)}.`,
    );
  }
  addLine(
    `       01  ${resultName.padEnd(20)} ${formatCobolType(fn.returnType)}.`,
  );

  addLine("");
  addLine(
    `       PROCEDURE DIVISION USING ${[
      ...passed.map((entry) => linkageNames.get(entry.index) ?? ""),
      resultName,
    ].join(" ")}.`,
  );
  addLine(`       ${toCobolParagraphName(fn.name)}-BODY.`);

  const previousBindings = currentBindings;
  currentBindings = new Map([
    ...locals.map(
      (local) => [local.name, toCobolFieldName(local.name)] as [string, string],
    ),
    ...fn.parameters.map(
      (parameter, index) =>
        [
          parameter.name,
          parameter.type.kind === "record"
            ? toCobolName(parameter.type.name)
            : (linkageNames.get(index) ?? ""),
        ] as [string, string],
    ),
  ]);

  emitStatement(fn.body, addLine, 11, resultName);

  currentBindings = previousBindings;

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
    emitBoundsChecks(statement, addLine, indent);
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
        emitWhileStatement(statement, addLine, indentLevel, resultName, false);
        break;
      case "AssignStatement":
        emitAssignStatement(statement, addLine, indent);
        break;
      case "ExpressionStatement":
        emitExpressionStatement(statement, addLine, indent);
        break;
      case "FileStatement":
        emitFileStatement(statement, addLine, indentLevel, resultName, false);
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
      case "ReturnCodeStatement":
        addLine(
          `${indent}MOVE ${renderExpression(statement.value)} TO ${RETURN_CODE_FIELD}`,
        );
        break;
      case "SplitStatement":
        emitSplitStatement(statement, addLine, indent);
        break;
      case "SerializeStatement":
        emitSerializeStatement(
          statement,
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "XmlParseStatement":
        emitXmlParseStatement(
          statement,
          xmlHandlerIndexes.get(statement) ?? 0,
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "ReportStatement":
        addLine(
          `${indent}${statement.operation.toUpperCase()} ${toCobolName(statement.target)}`,
        );
        break;
      case "ProgramCallStatement":
        emitProgramCallStatement(
          statement,
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "DliStatement":
        emitDliStatement(
          statement,
          requireDatabase(statement.databaseName),
          addLine,
          indent,
        );
        break;
      case "SortStatement":
        emitSortStatement(statement, addLine, indent);
        break;
      case "ReleaseStatement":
        emitReleaseStatement(statement, addLine, indent);
        break;
      case "RestartStatement":
        emitRestartStatement(
          statement,
          addLine,
          indentLevel,
          resultName,
          false,
        );
        break;
      case "CheckpointStatement":
        emitCheckpointStatement(statement, addLine, indent);
        break;
      case "ConsoleStatement":
        emitConsoleStatement(statement, addLine, indent);
        break;
      case "ResetStatement":
        addLine(
          `${indent}INITIALIZE ${resolveIdentifier(statement.recordName)}`,
        );
        break;
      case "SearchStatement":
        emitSearchStatement(statement, addLine, indentLevel, resultName, false);
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
  addLine(`           MOVE ${RETURN_CODE_FIELD} TO RETURN-CODE`);
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
  } else {
    // Nothing in the program says what to do about this. Leaving it here is
    // what a raise used to do: the body stops where it failed, the wrapper
    // returns, and the step ends with return code zero — a transaction that
    // abandoned its work reported the same success as one that finished it.
    // An operator gets the code that was raised and a return code that says
    // the step did not do what it was submitted to do.
    addLine(
      `           DISPLAY "TRANSACTION FAILED ${transaction.name} " ${FAILURE_CODE_FIELD} UPON SYSOUT`,
    );
    addLine(`           MOVE 12 TO ${RETURN_CODE_FIELD}`);
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
    emitBoundsChecks(statement, addLine, indent);
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
        emitWhileStatement(statement, addLine, indentLevel, "", true);
        break;
      case "AssignStatement":
        emitAssignStatement(statement, addLine, indent);
        break;
      case "ExpressionStatement":
        emitExpressionStatement(statement, addLine, indent);
        break;
      case "FileStatement":
        emitFileStatement(statement, addLine, indentLevel, "", true);
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
      case "ReturnCodeStatement":
        addLine(
          `${indent}MOVE ${renderExpression(statement.value)} TO ${RETURN_CODE_FIELD}`,
        );
        break;
      case "SplitStatement":
        emitSplitStatement(statement, addLine, indent);
        break;
      case "SerializeStatement":
        emitSerializeStatement(statement, addLine, indentLevel, "", true);
        break;
      case "XmlParseStatement":
        emitXmlParseStatement(
          statement,
          xmlHandlerIndexes.get(statement) ?? 0,
          addLine,
          indentLevel,
          "",
          true,
        );
        break;
      case "ReportStatement":
        addLine(
          `${indent}${statement.operation.toUpperCase()} ${toCobolName(statement.target)}`,
        );
        break;
      case "ProgramCallStatement":
        emitProgramCallStatement(statement, addLine, indentLevel, "", true);
        break;
      case "DliStatement":
        emitDliStatement(
          statement,
          requireDatabase(statement.databaseName),
          addLine,
          indent,
        );
        break;
      case "SortStatement":
        emitSortStatement(statement, addLine, indent);
        break;
      case "ReleaseStatement":
        emitReleaseStatement(statement, addLine, indent);
        break;
      case "CheckpointStatement":
        emitCheckpointStatement(statement, addLine, indent);
        break;
      case "RestartStatement":
        emitRestartStatement(statement, addLine, indentLevel, "", true);
        break;
      case "ConsoleStatement":
        emitConsoleStatement(statement, addLine, indent);
        break;
      case "ResetStatement":
        addLine(
          `${indent}INITIALIZE ${resolveIdentifier(statement.recordName)}`,
        );
        break;
      case "SearchStatement":
        emitSearchStatement(statement, addLine, indentLevel, "", true);
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
  /**
   * True inside a transaction, whose body may contain effects a function body
   * may not. Without this a `debit`, an `audit`, or a CICS command inside a
   * `while` reached the function-body emitter and threw — every other loop and
   * branch already carried the flag, and this one did not.
   */
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const counter = loopCounterName(statement);

  addLine(`${indent}MOVE 0 TO ${counter}`);
  addLine(
    `${indent}PERFORM UNTIL ${counter} >= ${statement.limit} OR NOT (${renderCondition(statement.condition)})`,
  );
  addLine(`${indent}    ADD 1 TO ${counter}`);
  if (inTransaction) {
    emitTransactionBody(statement.body, addLine, indentLevel + 4);
  } else {
    emitStatement(statement.body, addLine, indentLevel + 4, resultName);
  }
  // The condition is evaluated again before every iteration after the first,
  // and the body may have moved the subscript it reads since the guard that
  // ran ahead of the loop. Repeating it here covers each of those evaluations:
  // the one before the loop covers the first, this one covers the rest.
  emitBoundsChecks(
    { ...statement, body: { ...statement.body, statements: [] } },
    addLine,
    " ".repeat(indentLevel + 4),
  );
  addLine(`${indent}END-PERFORM`);
}

/**
 * `DISPLAY` to the job log, and `ACCEPT` from the job or the clock.
 *
 * `UPON SYSOUT` rather than a bare DISPLAY, so the message lands in the job's
 * output where an operator reads it rather than wherever the runtime defaults
 * to. `FROM DATE YYYYMMDD` gives the four-digit year, which the unqualified
 * form does not.
 */
function emitConsoleStatement(
  statement: IRConsoleStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  if (statement.operation === "log") {
    addLine(
      `${indent}DISPLAY ${statement.values.map((value) => renderExpression(value)).join(" ")} UPON SYSOUT`,
    );
    return;
  }

  const target = renderExpression(statement.target as IRExpression);
  switch (statement.source) {
    case "date":
      addLine(`${indent}ACCEPT ${target} FROM DATE YYYYMMDD`);
      return;
    case "time":
      addLine(`${indent}ACCEPT ${target} FROM TIME`);
      return;
    default:
      // What the job passed on the EXEC statement's PARM.
      addLine(`${indent}ACCEPT ${target} FROM SYSIN`);
      return;
  }
}

/**
 * A restart point.
 *
 * Counting rather than checkpointing every record is the whole trade: a commit
 * costs time, and rework after a failure costs the records since the last one.
 * The position is written first and the work committed after, so a restart that
 * finds a position can trust that everything up to it is durable.
 */
function emitCheckpointStatement(
  statement: IRCheckpointStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const counter = checkpointCounterName(statement.fileName);
  const fileRecord = fileRecordNameFor(statement.fileName);
  const source = resolveIdentifier(statement.recordName);

  addLine(`${indent}ADD 1 TO ${counter}`);
  addLine(`${indent}IF ${counter} >= ${statement.every}`);
  addLine(`${indent}    MOVE 0 TO ${counter}`);
  for (const field of statement.recordFields) {
    const name = toCobolFieldName(field.name);
    if (field.arrayLength !== null) {
      continue;
    }
    addLine(
      `${indent}    MOVE ${name} OF ${source} TO ${name} OF ${fileRecord}`,
    );
  }
  // One record under one key, rewritten each time, rather than a stream of
  // positions appended to a file. The first checkpoint of a run writes it; the
  // rest replace it. A restart then reads exactly one record and knows it is
  // the furthest point that was committed.
  addLine(`${indent}    WRITE ${fileRecord}`);
  addLine(`${indent}        INVALID KEY REWRITE ${fileRecord}`);
  addLine(`${indent}    END-WRITE`);
  // After the position, not before: a commit that lands with the position not
  // yet written would leave a restart resuming from further back than the work
  // that is already durable, and the records in between are posted twice.
  if (statement.commitsSql) {
    addLine(`${indent}    EXEC SQL COMMIT END-EXEC`);
  }
  addLine(`${indent}END-IF`);
}

/**
 * `restart <file> into <record> { ... } else { ... }`
 *
 * The other half of a checkpoint. Without it the position is written down and
 * never looked at, so the rerun a checkpoint exists to make safe still starts
 * at the beginning and posts everything twice.
 *
 * A keyed read: the record's key field says which position is being asked for,
 * and INVALID KEY is the first run, when there is nothing to resume from.
 */
function emitRestartStatement(
  statement: IRRestartStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const fileRecord = fileRecordNameFor(statement.fileName);
  const target = resolveIdentifier(statement.recordName);
  const found = restartFoundFlag(statement.fileName);

  if (statement.keyFieldName) {
    const key = toCobolFieldName(statement.keyFieldName);
    addLine(`${indent}MOVE ${key} OF ${target} TO ${key} OF ${fileRecord}`);
  }
  addLine(`${indent}MOVE "N" TO ${found}`);
  addLine(`${indent}READ ${fileCobolName(statement.fileName)}`);
  addLine(`${indent}    INVALID KEY CONTINUE`);
  addLine(`${indent}    NOT INVALID KEY MOVE "Y" TO ${found}`);
  addLine(`${indent}END-READ`);
  addLine(`${indent}IF ${found} = "Y"`);
  for (const field of statement.recordFields) {
    if (field.arrayLength !== null) {
      continue;
    }
    const name = toCobolFieldName(field.name);
    addLine(
      `${indent}    MOVE ${name} OF ${fileRecord} TO ${name} OF ${target}`,
    );
  }
  emitNestedBlock(
    statement.resumed,
    addLine,
    indentLevel + 4,
    resultName,
    inTransaction,
  );
  if (statement.fresh) {
    addLine(`${indent}ELSE`);
    emitNestedBlock(
      statement.fresh,
      addLine,
      indentLevel + 4,
      resultName,
      inTransaction,
    );
  }
  addLine(`${indent}END-IF`);
}

/** Whichever of the two body emitters the enclosing context calls for. */
function emitNestedBlock(
  block: IRBlock,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  if (inTransaction) {
    emitTransactionBody(block, addLine, indentLevel);
  } else {
    emitStatement(block, addLine, indentLevel, resultName);
  }
}

/** True when a restart found the position it was looking for. */
function restartFoundFlag(fileName: string): string {
  return `${toCobolName(fileName)}-RS-FOUND`;
}

/** Records taken since the last restart point was written. */
function checkpointCounterName(fileName: string): string {
  return `${toCobolName(fileName)}-CP-COUNT`;
}

/**
 * The condition for an OPEN that did not work.
 *
 * On the first character rather than on `NOT = "00"`, because "00" is not the
 * only success. The first character is the status key: 0 is successful
 * completion, and the rest of the class says what was unusual about it. "05" is
 * an OPTIONAL file that was not there and has been created — which is the
 * ordinary first run of a batch that keeps a restart position, and stopping the
 * job for it would mean a restartable batch could never run its first night.
 * "07" is a tape-oriented CLOSE option on a device that is not tape.
 *
 * Anything from 1 upwards is at-end, invalid key, a permanent error, a logic
 * error, or an implementor code, and none of those is an OPEN that worked.
 */
function openFailed(status: string): string {
  return ioFailed(status, []);
}

/**
 * The condition for any I/O statement that did not work.
 *
 * On the status key for the reason above. `expected` names the statuses this
 * particular statement legitimately produces and the program is written to
 * branch on: end of file on a read, a key that was not there on a keyed read or
 * a browse, a duplicate key on a write to a KSDS. Those say the request found
 * nothing, not that the file is broken, and the program handles them itself —
 * treating them as failures would stop the job at the ordinary end of a batch
 * loop.
 */
function ioFailed(status: string, expected: string[]): string {
  return [
    `${status}(1:1) NOT = "0"`,
    ...expected.map((code) => `${status} NOT = "${code}"`),
  ].join(" AND ");
}

/**
 * Stop the job when an I/O statement failed, naming the file and the status.
 *
 * IBM's guidance is to test the file status key after each input or output
 * request, and until this existed only `OPEN` was tested. A `WRITE` that filled
 * the volume, a `CLOSE` that could not write its last buffer, a `DELETE` against
 * a record that had already gone: each set the status, nothing read it, and the
 * batch carried on to a return code of zero. A short output file that reports
 * success is the failure nobody investigates until someone reconciles a month
 * later and finds the postings were never written.
 *
 * Conventional codes: 12 says the step failed, which is what this is.
 */
function emitFileStatusCheck(
  operation: string,
  fileName: string,
  status: string,
  expected: string[],
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(`${indent}IF ${ioFailed(status, expected)}`);
  addLine(
    `${indent}    DISPLAY "${operation} FAILED ${fileName} STATUS " ${status} UPON SYSOUT`,
  );
  if (inSortProcedure) {
    // Control may not leave a sort procedure while the sort is running, so the
    // GOBACK is not available here. Setting SORT-RETURN to 16 is how a
    // procedure tells the sort product to give up, and the test after the SORT
    // statement is what then stops the job.
    addLine(`${indent}    MOVE 16 TO SORT-RETURN`);
  } else {
    addLine(`${indent}    MOVE 12 TO RETURN-CODE`);
    addLine(`${indent}    GOBACK`);
  }
  addLine(`${indent}END-IF`);
}

/**
 * `SORT` or `MERGE`, through the sort-work file COBOL requires.
 *
 * `USING` and `GIVING` let the sort open, read, write, and close the files
 * itself, which is the form a program wants when it has nothing to do to the
 * records on the way through. The alternative — input and output procedures —
 * exists for when it does, and is not in the subset.
 */
function emitSortStatement(
  statement: IRSortStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const work = sortWorkName(statement.output);
  const keys = statement.keys
    .map(
      (key) =>
        `${key.descending ? "DESCENDING" : "ASCENDING"} KEY ${toCobolFieldName(key.name)} OF ${sortWorkRecordName(statement.output)}`,
    )
    .join(`\n${indent}         `);

  addLine(`${indent}${statement.operation.toUpperCase()} ${work}`);
  addLine(`${indent}         ${keys}`);

  // A procedure replaces the clause it stands in for: USING and an INPUT
  // PROCEDURE are alternatives, because the sort either reads the files itself
  // or receives records from the program, not both.
  if (statement.inputProcedure) {
    addLine(
      `${indent}    INPUT PROCEDURE IS ${sortProcedureName(statement, "input")}`,
    );
  } else {
    addLine(
      `${indent}    USING ${statement.inputs.map((input) => fileCobolName(input)).join(" ")}`,
    );
  }

  if (statement.outputProcedure) {
    addLine(
      `${indent}    OUTPUT PROCEDURE IS ${sortProcedureName(statement, "output")}`,
    );
  } else {
    addLine(`${indent}    GIVING ${fileCobolName(statement.output)}`);
  }

  // The sort product reports its outcome in SORT-RETURN — 0, or 16 for a sort
  // that did not complete — and IBM's guidance is to test it after every SORT
  // and MERGE, because what a program does having ignored it is undefined. A
  // failed sort leaves the output file short or empty, so a batch that carries
  // on writes a plausible-looking result from part of its input.
  const operation = statement.operation.toUpperCase();
  addLine(`${indent}IF SORT-RETURN NOT = 0`);
  addLine(
    `${indent}    DISPLAY "${operation} FAILED ${statement.output} SORT-RETURN " SORT-RETURN UPON SYSOUT`,
  );
  addLine(`${indent}    MOVE 16 TO RETURN-CODE`);
  addLine(`${indent}    GOBACK`);
  addLine(`${indent}END-IF`);

  // SORT-RETURN is not the whole story for the files the sort opens itself.
  // Under NOFASTSRT the sort does not check open, close, or I/O errors on a
  // USING or GIVING file, and IBM's guidance for a program that declares a file
  // status and no ERROR declarative — which is every program this compiler
  // emits — is to test the status key as well as SORT-RETURN. The status is
  // set either way; without this nothing reads it.
  //
  // A file handled by a procedure is not tested here, because the procedure
  // opened it and already checked.
  const unchecked = [
    ...(statement.inputProcedure ? [] : statement.inputs),
    ...(statement.outputProcedure ? [] : [statement.output]),
  ];
  for (const file of [...new Set(unchecked)]) {
    const status = fileStatusNames.get(file);
    if (!status) {
      continue;
    }
    addLine(`${indent}IF ${openFailed(status)}`);
    addLine(
      `${indent}    DISPLAY "${operation} FAILED ${file} STATUS " ${status} UPON SYSOUT`,
    );
    addLine(`${indent}    MOVE 16 TO RETURN-CODE`);
    addLine(`${indent}    GOBACK`);
    addLine(`${indent}END-IF`);
  }
}

/**
 * The sections a sort's procedures become.
 *
 * They are emitted at the end of the program, after the last GOBACK, because a
 * section placed in the flow of control would be run again on the way past —
 * an INPUT PROCEDURE is entered by SORT and by nothing else.
 *
 * The loop and the end-of-data test are generated. Hand-writing them is where
 * this shape is usually got wrong: a RETURN whose AT END is forgotten reads the
 * last record forever.
 */
function emitSortProcedureSections(
  statement: IRSortStatement,
  addLine: (line?: string) => void,
  inTransaction: boolean,
): void {
  // Everything emitted from here to the end of the function runs while the sort
  // is running, so an I/O failure inside it reports through SORT-RETURN.
  inSortProcedure = true;
  try {
    emitSortProcedureBodies(statement, addLine, inTransaction);
  } finally {
    inSortProcedure = false;
  }
}

function emitSortProcedureBodies(
  statement: IRSortStatement,
  addLine: (line?: string) => void,
  inTransaction: boolean,
): void {
  const input = statement.inputProcedure;
  if (input) {
    const flag = sortProcedureEndFlag(statement, "input");
    addLine("");
    addLine(`       ${sortProcedureName(statement, "input")} SECTION.`);
    // Each input file in turn, which is what USING would have done.
    statement.inputs.forEach((file, index) => {
      const last = index === statement.inputs.length - 1;
      const status = fileStatusNames.get(file) ?? null;
      addLine(`           OPEN INPUT ${fileCobolName(file)}`);
      // A failed OPEN here cannot be handled the way one in the body is: a
      // GOBACK would leave the procedure while the sort is running, which is
      // not allowed. Setting SORT-RETURN to 16 is how a procedure tells the
      // sort product to give up, and the test after the SORT statement then
      // stops the job. Without it the READ falls straight to AT END and the
      // sort quietly orders no records at all.
      if (status) {
        addLine(`           IF ${openFailed(status)}`);
        addLine(
          `               DISPLAY "OPEN FAILED ${file} STATUS " ${status} UPON SYSOUT`,
        );
        addLine(`               MOVE 16 TO SORT-RETURN`);
        addLine(`           ELSE`);
      }
      const body = status ? " ".repeat(4) : "";
      addLine(`${body}           MOVE "N" TO ${flag}`);
      addLine(`${body}           PERFORM UNTIL ${flag} = "Y"`);
      addLine(`${body}               READ ${fileCobolName(file)}`);
      addLine(`${body}                   AT END MOVE "Y" TO ${flag}`);
      addLine(`${body}                   NOT AT END`);
      emitSortRecordMapping(
        fileRecordNameFor(file),
        resolveIdentifier(input.recordName),
        input.recordFields,
        addLine,
        `${body}${" ".repeat(23)}`,
      );
      emitSortProcedureBody(
        statement,
        input,
        addLine,
        23 + body.length,
        inTransaction,
      );
      addLine(`${body}               END-READ`);
      addLine(`${body}           END-PERFORM`);
      addLine(`${body}           CLOSE ${fileCobolName(file)}`);
      if (status) {
        emitFileStatusCheck(
          "CLOSE",
          file,
          status,
          [],
          addLine,
          `${body}           `,
        );
      }
      if (status) {
        addLine(`           END-IF${last ? "." : ""}`);
      } else if (last) {
        addLine(`${body}           CONTINUE.`);
      }
    });
  }

  const output = statement.outputProcedure;
  if (output) {
    const flag = sortProcedureEndFlag(statement, "output");
    addLine("");
    addLine(`       ${sortProcedureName(statement, "output")} SECTION.`);
    // GIVING would have opened and written the file; with an output procedure
    // that is the program's job, so the generated loop does it.
    const status = fileStatusNames.get(statement.output) ?? null;
    addLine(`           OPEN OUTPUT ${fileCobolName(statement.output)}`);
    // As in the input procedure, SORT-RETURN rather than GOBACK: control may
    // not leave a sort procedure while the sort is running.
    if (status) {
      addLine(`           IF ${openFailed(status)}`);
      addLine(
        `               DISPLAY "OPEN FAILED ${statement.output} STATUS " ${status} UPON SYSOUT`,
      );
      addLine(`               MOVE 16 TO SORT-RETURN`);
      addLine(`           ELSE`);
    }
    const body = status ? " ".repeat(4) : "";
    addLine(`${body}           MOVE "N" TO ${flag}`);
    addLine(`${body}           PERFORM UNTIL ${flag} = "Y"`);
    addLine(`${body}               RETURN ${sortWorkName(statement.output)}`);
    addLine(`${body}                   AT END MOVE "Y" TO ${flag}`);
    addLine(`${body}                   NOT AT END`);
    emitSortRecordMapping(
      sortWorkRecordName(statement.output),
      resolveIdentifier(output.recordName),
      output.recordFields,
      addLine,
      `${body}${" ".repeat(23)}`,
    );
    emitSortProcedureBody(
      statement,
      output,
      addLine,
      23 + body.length,
      inTransaction,
    );
    addLine(`${body}               END-RETURN`);
    addLine(`${body}           END-PERFORM`);
    addLine(`${body}           CLOSE ${fileCobolName(statement.output)}`);
    if (status) {
      emitFileStatusCheck(
        "CLOSE",
        statement.output,
        status,
        [],
        addLine,
        `${body}           `,
      );
      addLine(`           END-IF.`);
    } else {
      addLine(`${body}           CONTINUE.`);
    }
  }
}

/** Emits one procedure's body, with `release` bound to this sort. */
function emitSortProcedureBody(
  statement: IRSortStatement,
  procedure: IRSortProcedure,
  addLine: (line?: string) => void,
  indentLevel: number,
  inTransaction: boolean,
): void {
  const previous = currentSortRelease;
  currentSortRelease = {
    record: sortWorkRecordName(statement.output),
    fields: procedure.recordFields,
  };
  if (inTransaction) {
    emitTransactionBody(procedure.body, addLine, indentLevel);
  } else {
    emitStatement(procedure.body, addLine, indentLevel, "");
  }
  currentSortRelease = previous;
}

/**
 * Moves every field between a file record and the procedure's record.
 *
 * Field by field for the same reason `read` and `write` are: it makes the
 * correspondence visible in the generated COBOL and survives a layout that is
 * compatible rather than byte-identical.
 */
function emitSortRecordMapping(
  source: string,
  target: string,
  fields: { name: string; arrayLength: number | null }[],
  addLine: (line?: string) => void,
  indent: string,
): void {
  for (const field of fields) {
    const name = toCobolFieldName(field.name);
    if (field.arrayLength !== null) {
      addLine(
        `${indent}PERFORM VARYING ${COPY_INDEX_FIELD} FROM 1 BY 1 UNTIL ${COPY_INDEX_FIELD} > ${field.arrayLength}`,
      );
      addLine(
        `${indent}    MOVE ${name} OF ${source} (${COPY_INDEX_FIELD}) TO ${name} OF ${target} (${COPY_INDEX_FIELD})`,
      );
      addLine(`${indent}END-PERFORM`);
      continue;
    }
    addLine(`${indent}MOVE ${name} OF ${source} TO ${name} OF ${target}`);
  }
}

/** `RELEASE` — the statement an input procedure exists for. */
function emitReleaseStatement(
  statement: IRReleaseStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  if (!currentSortRelease) {
    throw new Error("release outside a sort input procedure");
  }
  emitSortRecordMapping(
    resolveIdentifier(statement.recordName),
    currentSortRelease.record,
    currentSortRelease.fields,
    addLine,
    indent,
  );
  addLine(`${indent}RELEASE ${currentSortRelease.record}`);
}

/** `UNSTRING source DELIMITED BY d INTO a b c`. */
function emitSplitStatement(
  statement: IRSplitStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const source = renderExpression(statement.source);
  addLine(
    `${indent}UNSTRING ${source} DELIMITED BY ${renderExpression(statement.delimiter)}`,
  );
  addLine(
    `${indent}    INTO ${statement.targets.map((target) => renderExpression(target)).join(" ")}`,
  );
  // The overflow condition is raised when every receiver has been filled and
  // the sending field still has characters nobody looked at. Without the phrase
  // those characters are simply dropped: a reference split into two when it had
  // three parts leaves the third nowhere, and the program carries on holding a
  // value that is a prefix of the one it was given.
  //
  // Reported rather than raised, because taking the first parts of a longer
  // field is a thing a program may mean to do — but a return code of 4 says the
  // run was not the ordinary one, without stopping a job that is fine.
  addLine(`${indent}    ON OVERFLOW`);
  addLine(
    `${indent}        DISPLAY "SPLIT OVERFLOW ${source}: MORE PARTS THAN RECEIVERS" UPON SYSOUT`,
  );
  // Never downwards: an earlier step of the same run may already have set 8 or
  // 12, and a warning must not report the job as less wrong than it is.
  addLine(`${indent}        IF ${RETURN_CODE_FIELD} < 4`);
  addLine(`${indent}            MOVE 4 TO ${RETURN_CODE_FIELD}`);
  addLine(`${indent}        END-IF`);
  addLine(`${indent}END-UNSTRING`);
}

/**
 * One `RD` and its report groups.
 *
 * The control hierarchy is written outermost first with `FINAL` in front, which
 * is the order COBOL breaks in: a change in an outer control breaks every inner
 * one too, and the final total comes last of all.
 */
function emitReport(report: IRReport, addLine: (line?: string) => void): void {
  const controls = [
    "FINAL",
    ...report.controls.map(
      (control) =>
        `${toCobolFieldName(control)} OF ${toCobolName(report.recordName)}`,
    ),
  ];
  const clauses = [
    `       RD  ${toCobolName(report.name)}`,
    `           CONTROLS ARE ${controls.join(" ")}`,
  ];
  if (report.page) {
    const margins = [`           PAGE LIMIT ${report.page.limit} LINES`];
    if (report.page.heading !== null) {
      margins.push(`HEADING ${report.page.heading}`);
    }
    if (report.page.firstDetail !== null) {
      margins.push(`FIRST DETAIL ${report.page.firstDetail}`);
    }
    if (report.page.lastDetail !== null) {
      margins.push(`LAST DETAIL ${report.page.lastDetail}`);
    }
    if (report.page.footing !== null) {
      margins.push(`FOOTING ${report.page.footing}`);
    }
    clauses.push(margins.join(" "));
  }
  clauses.forEach((clause, index) =>
    addLine(index === clauses.length - 1 ? `${clause}.` : clause),
  );

  for (const group of report.groups) {
    emitReportGroup(group, report, addLine);
  }
  addLine("");
}

/** The `TYPE IS` clause for each group, as COBOL spells it. */
const REPORT_GROUP_CLAUSES: Record<IRReport["groups"][number]["type"], string> =
  {
    pageHeading: "PAGE HEADING",
    pageFooting: "PAGE FOOTING",
    detail: "DETAIL",
    controlHeading: "CONTROL HEADING",
    controlFooting: "CONTROL FOOTING",
  };

function emitReportGroup(
  group: IRReport["groups"][number],
  report: IRReport,
  addLine: (line?: string) => void,
): void {
  const control =
    group.type === "controlHeading" || group.type === "controlFooting"
      ? ` ${group.control ? `${toCobolFieldName(group.control)} OF ${toCobolName(report.recordName)}` : "FINAL"}`
      : "";
  const name = group.name ? `${toCobolName(group.name)} ` : "";
  addLine(
    `       01  ${name}TYPE IS ${REPORT_GROUP_CLAUSES[group.type]}${control}.`,
  );

  for (const line of group.lines) {
    const position =
      line.position.kind === "absolute"
        ? `LINE ${line.position.value}`
        : `LINE PLUS ${line.position.value}`;
    addLine(`           05  ${position}.`);
    for (const column of line.columns) {
      addLine(
        `               10  COLUMN ${column.column} ${reportColumnClause(column, report)}.`,
      );
    }
  }
}

/**
 * The picture and the source of one printed column.
 *
 * A literal prints itself and the picture is its own width. A field or a total
 * prints the value, so the picture comes from the field's type — which is why
 * an amount reaches a report readable: a `COMP-3` balance cannot be printed,
 * and its edited picture is generated from its own precision and scale rather
 * than counted out by hand.
 */
function reportColumnClause(
  column: IRReport["groups"][number]["lines"][number]["columns"][number],
  report: IRReport,
): string {
  const source = column.source;
  if (source.kind === "ReportLiteral") {
    return `PIC X(${source.value.length}) VALUE "${source.value}"`;
  }
  if (source.kind === "ReportPageNumber") {
    return "PIC ZZZ9 SOURCE PAGE-COUNTER";
  }

  const reference = reportFieldReference(source.field, report);
  return source.kind === "ReportSum"
    ? `${reportTotalPicture(source.field)} SUM ${reference}`
    : `${reportFieldPicture(source.field)} SOURCE ${reference}`;
}

/**
 * The picture a `sum` column prints its total with — wider than the field it
 * totals, because a total is bigger than a row.
 *
 * Report Writer takes the internal total field's precision from the *picture of
 * the SUM entry* whenever the item being totalled lives outside the REPORT
 * SECTION, which is always the case here: the values come from the record in
 * working storage. Printing a total with the row's own picture therefore sizes
 * the accumulator for one row. A branch of two postings of 9,999,999.99 then
 * totals 9,999,999.98 instead of 19,999,999.98 — the high-order digit is gone,
 * the columns still line up, the step ends with return code zero, and the only
 * way to notice is to add the report up by hand.
 *
 * So the total is given every digit the target's arithmetic has: the operand's
 * own scale, and the rest integers. There is no honest way to derive a narrower
 * one, because how large a total gets depends on how many rows arrive, which is
 * not known until the job runs.
 */
function reportTotalPicture(field: string): string {
  const declared = currentReportRecord?.fields.find(
    (entry) => entry.name === field,
  );
  const type = declared?.type;
  if (type?.kind !== "decimal" && type?.kind !== "currency") {
    // Not a field COBOL can total. `BANK-FILE-011` rejects that before
    // emission, so reaching here is a compiler bug rather than a program one.
    return reportFieldPicture(field);
  }

  return editedPicture(
    type.scale > 0 ? "grouped" : "plain",
    MAX_TOTAL_DIGITS,
    type.scale,
    currentDecimalPoint,
  );
}

/**
 * Digits a report total is given.
 *
 * Enterprise COBOL's default `ARITH(COMPAT)` carries eighteen, which is also
 * the widest packed or display item the record can hold, so a total this wide
 * cannot be overflowed by any number of rows the program could read.
 */
const MAX_TOTAL_DIGITS = 18;

/**
 * The COBOL name a report column reads, qualified by the record it belongs to.
 *
 * Qualification is not optional here: the same record is emitted in working
 * storage and again inside any FD that holds it, so an unqualified field name
 * is ambiguous exactly when the report is useful.
 */
function reportFieldReference(field: string, report: IRReport): string {
  return `${toCobolFieldName(field)} OF ${toCobolName(report.recordName)}`;
}

/**
 * The picture a report column prints a field with.
 *
 * A report is what a person reads, so a number is printed in its edited form
 * rather than as stored. That is the point: a `COMP-3` balance cannot be
 * printed at all, and here its edited picture comes from its own precision and
 * scale rather than being counted out by hand.
 */
function reportFieldPicture(field: string): string {
  const declared = currentReportRecord?.fields.find(
    (entry) => entry.name === field,
  );
  if (!declared) {
    return "PIC X(20)";
  }

  const type = declared.type;
  if (type.kind === "decimal" || type.kind === "currency") {
    return editedPicture(
      type.scale > 0 ? "grouped" : "plain",
      type.precision,
      type.scale,
      currentDecimalPoint,
    );
  }
  return formatCobolType(type);
}

/**
 * The handler index for each `xml ... processing`, keyed by the statement.
 *
 * The statement and its handler section are emitted in different places, so
 * both look the name up here rather than counting independently.
 */
let xmlHandlerIndexes = new Map<IRXmlParseStatement, number>();

/**
 * The status field each file declares, for the check emitted after each I/O.
 *
 * The statement carries the file's name, not its status field, and the check
 * has to test the one that file declared rather than any other.
 */
let fileStatusNames = new Map<string, string>();

/**
 * True while a sort's input or output procedure is being emitted.
 *
 * Control may not leave a sort procedure while the sort is running, so an I/O
 * failure inside one reports itself through `SORT-RETURN` rather than through
 * the `GOBACK` used everywhere else.
 */
let inSortProcedure = false;

/** Declared databases, for resolving a DL/I statement to its PCB and segment. */
let databaseTable = new Map<string, IRDatabase>();

function requireDatabase(name: string): IRDatabase {
  const database = databaseTable.get(name);
  if (!database) {
    throw new Error(`Unknown database during emission: ${name}`);
  }
  return database;
}

/** The record a report's columns read from, while that report is emitted. */
let currentReportRecord: IRRecord | null = null;

/**
 * `JSON GENERATE` / `XML GENERATE`, and the `PARSE` that reads one back.
 *
 * COBOL matches the document against the group's own field names, so nothing
 * here describes the shape — the record is the schema, in both directions.
 *
 * Generating writes into a fixed field and space-fills the rest, which is why
 * `count` matters: it is the only way the caller can tell the text from the
 * padding. Parsing needs no count, because the document says where it ends.
 */
function emitSerializeStatement(
  statement: IRSerializeStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const verb = statement.format.toUpperCase();
  const text = renderExpression(statement.target);
  const record = renderExpression(statement.source);
  const clause =
    statement.direction === "generate"
      ? `GENERATE ${text} FROM ${record}${
          statement.count
            ? ` COUNT IN ${renderExpression(statement.count)}`
            : ""
        }`
      : `PARSE ${text} INTO ${record}`;

  addLine(`${indent}${verb} ${clause}`);
  if (statement.onError) {
    addLine(`${indent}    ON EXCEPTION`);
    if (inTransaction) {
      emitTransactionBody(statement.onError, addLine, indentLevel + 8);
    } else {
      emitStatement(statement.onError, addLine, indentLevel + 8, resultName);
    }
  }
  addLine(`${indent}END-${verb}`);

  // A JSON PARSE has two ways to go wrong and `ON EXCEPTION` catches one.
  // Exception conditions terminate the statement and set JSON-CODE; nonexception
  // conditions do not terminate it, set JSON-STATUS, and "might result in the
  // receiver being partially modified". So a document whose names do not match
  // the record leaves the statement completing normally, the exception branch
  // untaken, and the record holding some fields and not others — which is the
  // shape of a record that parsed cleanly.
  //
  // Reported rather than raised, because a nonexception condition is not always
  // an error: a document carrying fields this record does not declare is one,
  // and is often exactly what was expected of it.
  if (statement.direction === "parse" && statement.format === "json") {
    addLine(`${indent}IF JSON-STATUS NOT = 0`);
    addLine(
      `${indent}    DISPLAY "JSON PARSE INCOMPLETE JSON-STATUS " JSON-STATUS UPON SYSOUT`,
    );
    addLine(`${indent}END-IF`);
  }
}

/**
 * Every `xml ... processing` in the program, in emission order.
 *
 * The handler is a section, and a section has to sit outside the flow of
 * control, so the statement and its handler are emitted in different places and
 * have to agree on a name.
 */
function xmlParseStatements(program: IRProgram): {
  statement: IRXmlParseStatement;
  owner: string;
  parameters: IRParameter[];
  inTransaction: boolean;
}[] {
  type Owned = {
    statement: IRXmlParseStatement;
    owner: string;
    parameters: IRParameter[];
    inTransaction: boolean;
  };
  const found: Owned[] = [];
  let owner: Omit<Owned, "statement"> = {
    inTransaction: false,
    owner: "",
    parameters: [],
  };

  const walk = (block: IRBlock): void => {
    for (const statement of block.statements) {
      if (statement.kind === "XmlParseStatement") {
        found.push({ statement, ...owner });
      }
      for (const nested of [
        (statement as { body?: IRBlock }).body,
        (statement as { notFound?: IRBlock }).notFound,
        (statement as { thenBranch?: IRBlock }).thenBranch,
        (statement as { elseBranch?: IRBlock | null }).elseBranch,
        (statement as { onError?: IRBlock | null }).onError,
      ]) {
        if (nested) {
          walk(nested);
        }
      }
    }
  };

  // Transactions first, then functions, which is the order the statements are
  // emitted in — the handler's name has to match the one the statement wrote.
  for (const transaction of program.transactions) {
    owner = {
      inTransaction: true,
      owner: transaction.name,
      parameters: transaction.parameters,
    };
    walk(transaction.body);
  }
  for (const fn of program.functions) {
    owner = { inTransaction: false, owner: fn.name, parameters: fn.parameters };
    walk(fn.body);
  }
  return found;
}

/** The section name a handler is reached by, and the element register it uses. */
/**
 * How much split character content one XML element may accumulate.
 *
 * A split can happen at any point in the stream, so the pieces have to land
 * somewhere before the value is complete. 4096 is well past any field this
 * language can declare to receive one, so the buffer is never the thing that
 * truncates -- the MOVE into the bound field is, which is what a MOVE does
 * anyway and what the field itself declares.
 */
const XML_CONTENT_BUFFER = 4096;

function xmlHandlerName(index: number): string {
  return `BANK-XML-${index + 1}`;
}

/**
 * The function codes, the search arguments, and the status fields.
 *
 * A search argument is a fixed byte layout, not a string the program builds:
 * eight bytes of segment name, `(`, eight bytes of field name, the operator,
 * the value, and `)`. Writing it as a group with the value as its own field is
 * what lets the program move a key in without rebuilding the rest.
 */
function emitDliWorkingStorage(
  program: IRProgram,
  addLine: (line?: string) => void,
): void {
  if (program.databases.length === 0) {
    return;
  }

  const used = new Set<IRDliStatement["operation"]>();
  for (const owned of dliStatements(program)) {
    used.add(owned.operation);
  }
  for (const operation of [...used].sort()) {
    addLine(
      `       01  ${dliFunctionName(operation).padEnd(20)} PIC X(4) VALUE "${DLI_FUNCTIONS[operation]}".`,
    );
  }

  for (const database of program.databases) {
    if (database.statusName) {
      addLine(
        `       01  ${toCobolFieldName(database.statusName).padEnd(20)} PIC XX.`,
      );
    }
    const key = database.record.fields.find(
      (field) => field.type.kind === "string",
    );
    const width =
      key && key.type.kind === "string" ? key.type.length : database.keyLength;
    addLine(`       01  ${ssaName(database.name)}.`);
    addLine(
      `           05  FILLER               PIC X(8) VALUE "${database.segmentName.padEnd(8)}".`,
    );
    addLine(`           05  FILLER               PIC X VALUE "(".`);
    addLine(
      `           05  FILLER               PIC X(8) VALUE "${database.keyName.padEnd(8)}".`,
    );
    addLine(`           05  FILLER               PIC XX VALUE " =".`);
    addLine(
      `           05  ${`${ssaName(database.name)}-VALUE`.padEnd(20)} PIC X(${Math.max(width, 1)}).`,
    );
    addLine(`           05  FILLER               PIC X VALUE ")".`);

    // Nine bytes: the segment name and a trailing space, which is what makes it
    // unqualified rather than the start of a qualification.
    addLine(`       01  ${unqualifiedSsaName(database.name)}.`);
    addLine(
      `           05  FILLER               PIC X(8) VALUE "${database.segmentName.padEnd(8)}".`,
    );
    addLine(`           05  FILLER               PIC X VALUE " ".`);
  }
}

/** Every DL/I statement in the program, however deeply nested. */
function dliStatements(program: IRProgram): IRDliStatement[] {
  const found: IRDliStatement[] = [];
  const walk = (block: IRBlock): void => {
    for (const statement of block.statements) {
      if (statement.kind === "DliStatement") {
        found.push(statement);
      }
      for (const nested of [
        (statement as { body?: IRBlock }).body,
        (statement as { notFound?: IRBlock }).notFound,
        (statement as { thenBranch?: IRBlock }).thenBranch,
        (statement as { elseBranch?: IRBlock | null }).elseBranch,
        (statement as { onError?: IRBlock | null }).onError,
      ]) {
        if (nested) {
          walk(nested);
        }
      }
    }
  };
  for (const transaction of program.transactions) {
    walk(transaction.body);
  }
  for (const fn of program.functions) {
    walk(fn.body);
  }
  return found;
}

/** The DL/I function code each operation calls with, padded as DL/I wants it. */
const DLI_FUNCTIONS: Record<IRDliStatement["operation"], string> = {
  getUnique: "GU  ",
  getNext: "GN  ",
  // A get-hold retrieves the segment *and* holds it, which is the only thing
  // that makes a later REPL or DLET legal — without it DL/I answers DJ.
  getHoldUnique: "GHU ",
  getHoldNext: "GHN ",
  insertSegment: "ISRT",
  replaceSegment: "REPL",
  deleteSegment: "DLET",
};

function dliFunctionName(operation: IRDliStatement["operation"]): string {
  return `DLI-${DLI_FUNCTIONS[operation].trim()}`;
}

/**
 * The I/O PCB, which every IMS program receives first.
 *
 * Its mask is not a database PCB: it carries the logical terminal name, the
 * date and time of the message, and the sequence number, and its status is
 * where a system service call reports itself.
 */
const IO_PCB_NAME = "IO-PCB";

function pcbName(database: string): string {
  return `${toCobolName(database)}-PCB`;
}

/** The qualified search argument: segment, field, operator, value. */
function ssaName(database: string): string {
  return `${toCobolName(database)}-SSA`;
}

/**
 * The unqualified search argument: eight bytes of segment name and a space.
 *
 * `GN` without one returns the next segment of *any* type in hierarchical
 * order, which is almost never what a program reading one segment type wants,
 * and `ISRT` without one has nothing telling DL/I which segment to insert.
 */
function unqualifiedSsaName(database: string): string {
  return `${toCobolName(database)}-SSA-U`;
}

/**
 * One `CALL "CBLTDLI"`.
 *
 * DL/I takes a function code, the PCB the region passed in, the segment area,
 * and — for a qualified read — a search argument. A `getNext` deliberately
 * passes no argument: it walks from wherever the last call left the position,
 * which is what makes it the next one.
 *
 * The status the call leaves in the PCB is copied into the declared status
 * field afterwards, so the program reads it the same way it reads a file
 * status rather than reaching into the PCB itself.
 */
function emitDliStatement(
  statement: IRDliStatement,
  database: IRDatabase,
  addLine: (line?: string) => void,
  indent: string,
): void {
  const pcb = pcbName(statement.databaseName);
  const operands = [dliFunctionName(statement.operation), pcb];

  if (statement.recordName) {
    operands.push(resolveIdentifier(statement.recordName));
  } else {
    // DLET acts on the segment the preceding get-hold left held, but the area
    // is still an operand of the call.
    operands.push(toCobolName(database.record.name));
  }

  switch (statement.operation) {
    // A unique read is qualified: it names the segment, the field, and the
    // value to match.
    case "getUnique":
    case "getHoldUnique":
      addLine(
        `${indent}MOVE ${renderExpression(statement.key as IRExpression)} TO ${ssaName(statement.databaseName)}-VALUE`,
      );
      operands.push(ssaName(statement.databaseName));
      break;
    // A next read and an insert name the segment without qualifying it. The
    // read would otherwise walk segments of every type; the insert would have
    // nothing saying what to insert.
    case "getNext":
    case "getHoldNext":
    case "insertSegment":
      operands.push(unqualifiedSsaName(statement.databaseName));
      break;
    // REPL and DLET take no argument: they act on what the get-hold held.
    case "replaceSegment":
    case "deleteSegment":
      break;
  }

  addLine(`${indent}CALL "CBLTDLI" USING ${operands.join(", ")}`);
  if (database.statusName) {
    addLine(
      `${indent}MOVE ${pcb}-STATUS TO ${toCobolFieldName(database.statusName)}`,
    );
  }
}

/**
 * `CALL <name> USING <record>` and `CANCEL <name>`.
 *
 * The name is a value rather than a literal in the source, which is what makes
 * the call dynamic: a product code selects the module that prices it, and a new
 * product ships as a new load module without relinking its callers.
 *
 * `ON EXCEPTION` is the whole safety story. A static call that cannot be
 * resolved fails at link time where somebody sees it; this one fails in the
 * middle of a batch.
 */
function emitProgramCallStatement(
  statement: IRProgramCallStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const program = renderExpression(statement.program);

  if (statement.operation === "cancel") {
    // CANCEL drops the loaded module, so the next call gets it with its working
    // storage as the compiler left it rather than as the last call left it.
    addLine(`${indent}CANCEL ${program}`);
    return;
  }

  const using = statement.using
    ? ` USING ${renderExpression(statement.using)}`
    : "";
  addLine(`${indent}CALL ${program}${using}`);
  if (statement.onError) {
    addLine(`${indent}    ON EXCEPTION`);
    if (inTransaction) {
      emitTransactionBody(statement.onError, addLine, indentLevel + 8);
    } else {
      emitStatement(statement.onError, addLine, indentLevel + 8, resultName);
    }
  }
  addLine(`${indent}END-CALL`);
}

/**
 * `XML PARSE`, and the handler section that reads the document.
 *
 * COBOL calls the procedure once per token — a start tag, its content, an end
 * tag — and the procedure decides what to keep by reading `XML-EVENT` and
 * `XML-TEXT`. Writing that by hand is where an XML reader goes wrong, so the
 * bindings are declared and this generates the machine: remember the element a
 * start tag opened, move the content of the ones that were named, forget it
 * again at the end tag.
 */
function emitXmlParseStatement(
  statement: IRXmlParseStatement,
  index: number,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  addLine(`${indent}XML PARSE ${renderExpression(statement.source)}`);
  addLine(`${indent}    PROCESSING PROCEDURE ${xmlHandlerName(index)}`);
  if (statement.onError) {
    addLine(`${indent}    ON EXCEPTION`);
    if (inTransaction) {
      emitTransactionBody(statement.onError, addLine, indentLevel + 8);
    } else {
      emitStatement(statement.onError, addLine, indentLevel + 8, resultName);
    }
  }
  addLine(`${indent}END-XML`);
}

/** The handler section for one `xml ... processing`. */
function emitXmlHandlerSection(
  statement: IRXmlParseStatement,
  index: number,
  addLine: (line?: string) => void,
): void {
  const name = xmlHandlerName(index);
  addLine("");
  addLine(`       ${name} SECTION.`);
  addLine(`           EVALUATE XML-EVENT`);
  // The content of an element arrives after its start tag, so the name has to
  // be remembered to know what the characters belong to.
  addLine(`             WHEN "START-OF-ELEMENT"`);
  addLine(`               MOVE XML-TEXT TO ${name}-ELEM`);
  // A new element starts a new value, so nothing of the last one is left to be
  // concatenated onto.
  addLine(`               MOVE SPACES TO ${name}-BUF`);
  addLine(`               MOVE 1 TO ${name}-PTR`);
  addLine(`             WHEN "CONTENT-CHARACTERS"`);
  // Every fragment is appended. XML-INFORMATION is 2 while the content is
  // continued in a later event and 1 on the last piece, so the field is only
  // assigned once the whole value is in hand. Where the register is not set at
  // all the test is simply never 2, and each append is followed by an
  // assignment — which still ends holding everything appended.
  addLine(`               STRING XML-TEXT DELIMITED BY SIZE INTO ${name}-BUF`);
  addLine(`                   WITH POINTER ${name}-PTR`);
  addLine(`               END-STRING`);
  addLine(`               IF XML-INFORMATION NOT = 2`);
  addLine(`                 EVALUATE ${name}-ELEM`);
  for (const binding of statement.bindings) {
    addLine(`                   WHEN "${binding.element}"`);
    const target = renderExpression(binding.target);
    if (binding.numeric) {
      // The content is characters. NUMVAL reads them as a number rather than
      // moving them into a picture that would read the digits positionally.
      addLine(
        `                     COMPUTE ${target} = FUNCTION NUMVAL(${name}-BUF)`,
      );
    } else {
      addLine(`                     MOVE ${name}-BUF TO ${target}`);
    }
  }
  addLine(`                 END-EVALUATE`);
  addLine(`               END-IF`);
  // Forgetting the element at its end tag keeps content that belongs to a
  // parent from being filed under the child that just closed.
  addLine(`             WHEN "END-OF-ELEMENT"`);
  addLine(`               MOVE SPACES TO ${name}-ELEM`);
  addLine(`           END-EVALUATE.`);
}

/**
 * `SEARCH` over a table.
 *
 * The index is set to 1 first, because SEARCH begins wherever the index happens
 * to be pointing and a stale one silently skips the front of the table. `AT END`
 * comes before the `WHEN`, which is the order COBOL requires and also the order
 * that makes the not-found case impossible to leave out.
 */
function emitSearchStatement(
  statement: IRSearchStatement,
  addLine: (line?: string) => void,
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const table = `${toCobolFieldName(statement.arrayFieldName)} OF ${toCobolName(statement.arrayRecordName)}`;
  const index = tableIndexName(statement.arrayFieldName);
  const previous = currentSearchElement;
  currentSearchElement = {
    name: statement.elementName,
    reference: `${table} (${index})`,
  };

  // SEARCH ALL bisects, so it sets the index itself — a SET before it would be
  // discarded, and writing one would suggest the starting point mattered.
  if (!statement.sorted) {
    addLine(`${indent}SET ${index} TO 1`);
  }
  addLine(`${indent}SEARCH ${statement.sorted ? "ALL " : ""}${table}`);
  addLine(`${indent}    AT END`);
  if (inTransaction) {
    emitTransactionBody(statement.notFound, addLine, indentLevel + 8);
  } else {
    emitStatement(statement.notFound, addLine, indentLevel + 8, resultName);
  }
  addLine(`${indent}    WHEN ${renderCondition(statement.condition)}`);
  if (inTransaction) {
    emitTransactionBody(statement.body, addLine, indentLevel + 8);
  } else {
    emitStatement(statement.body, addLine, indentLevel + 8, resultName);
  }
  addLine(`${indent}END-SEARCH`);

  currentSearchElement = previous;
}

/**
 * The element name a `search` binds, and the subscripted table entry it stands
 * for, while that search's condition and body are being emitted.
 */
let currentSearchElement: { name: string; reference: string } | null = null;

/**
 * The sort record a `release` hands its record to, while an input procedure is
 * being emitted. Null everywhere else, which is what makes a stray `release`
 * a compiler bug rather than silently wrong COBOL.
 */
let currentSortRelease: {
  record: string;
  fields: { name: string; arrayLength: number | null }[];
} | null = null;

function emitAssignStatement(
  statement: IRAssignStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  // Setting an enum field to one of its members is what the level-88 condition
  // names are for. `SET STATE-CLOSED OF R TO TRUE` says which state it is;
  // `MOVE "CLOSED" TO STATE OF R` repeats the spelling of the member in the
  // procedure division, where it can drift from the 88 that defines it.
  const condition = enumConditionAssignment(statement);
  if (condition) {
    addLine(`${indent}SET ${condition} TO TRUE`);
    return;
  }

  const target =
    statement.target.kind === "Identifier"
      ? resolveIdentifier(statement.target.name)
      : statement.target.kind === "IndexAccess"
        ? renderExpression(statement.target)
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
  indentLevel: number,
  resultName: string,
  inTransaction: boolean,
): void {
  const indent = " ".repeat(indentLevel);
  const file = fileCobolName(statement.fileName);

  const status = statement.statusName
    ? toCobolFieldName(statement.statusName)
    : null;
  // Every operation is checked, so the check is written once here. The
  // statuses a given statement is allowed to produce are its own, though: an
  // end of file is how a batch loop ends, and a key that was not there is a
  // question answered rather than a file that failed.
  const check = (operation: string, expected: string[] = []): void => {
    const field = fileStatusNames.get(statement.fileName) ?? status;
    if (field) {
      emitFileStatusCheck(
        operation,
        statement.fileName,
        field,
        expected,
        addLine,
        indent,
      );
    }
  };
  const indexed = statement.fileOrganization === "indexed";

  switch (statement.operation) {
    case "open": {
      // I-O is what a master file update needs: the same OPEN serves the READ
      // that finds a record and the REWRITE that puts it back.
      addLine(
        `${indent}OPEN ${statement.fileMode === "input" ? "INPUT" : statement.fileMode === "output" ? "OUTPUT" : "I-O"} ${file}`,
      );
      // An OPEN that failed is not recoverable by carrying on: every read
      // afterwards fails too, and a batch that ignores it produces an empty
      // output file and a return code of zero, which looks exactly like a run
      // with nothing to do. The convention is to report it and stop.
      check("OPEN");
      return;
    }
    case "close":
      addLine(`${indent}CLOSE ${file}`);
      // A CLOSE fails on a file that was never opened, and on an output file
      // whose last buffer could not be written — which is the one that matters,
      // because the records the program thinks it wrote are the ones missing.
      check("CLOSE");
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
      // End of file, or a key that was not there, is what the program's own
      // test is for. Anything else — a data check, a dataset that is not the
      // shape the FD describes — ends the loop just as quietly, halfway through
      // the file, and the job reports success on the records it did read.
      check("READ", [indexed ? "23" : "10"]);
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
      check("READ NEXT", ["10"]);
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
      // A key past the end of the file is the answer to a browse that found
      // nothing, and the program tests for it. A file that is not open, or a
      // sequence error, is not — and a browse that never positioned reads from
      // wherever the file happened to be left.
      check("START", ["23"]);
      return;
    case "write": {
      emitRecordFieldMapping(statement, addLine, indent, "write");
      // AFTER ADVANCING spaces the report before the line rather than writing
      // on top of the last one; ADVANCING PAGE is how a heading starts a page.
      const advancing =
        statement.advancing === null
          ? ""
          : statement.advancing === "page"
            ? " AFTER ADVANCING PAGE"
            : ` AFTER ADVANCING ${statement.advancing} LINES`;
      addLine(
        `${indent}WRITE ${fileRecordNameFor(statement.fileName)}${advancing}`,
      );
      if (status && statement.fileOrganization === "indexed") {
        // A duplicate key is the failure a WRITE to a KSDS actually has, and
        // it is silent unless the status is captured.
        addLine(`${indent}    INVALID KEY MOVE "22" TO ${status}`);
      }
      if (statement.atEndOfPage) {
        addLine(`${indent}    AT END-OF-PAGE`);
        if (inTransaction) {
          emitTransactionBody(statement.atEndOfPage, addLine, indentLevel + 8);
        } else {
          emitStatement(
            statement.atEndOfPage,
            addLine,
            indentLevel + 8,
            resultName,
          );
        }
      }
      if (
        statement.atEndOfPage ||
        (status && statement.fileOrganization === "indexed")
      ) {
        addLine(`${indent}END-WRITE`);
      }
      // The failure this catches is the one a batch never notices: the volume
      // filling, or a record outside the declared length range. The write does
      // not happen, the loop carries on, and the output file is short by
      // however many records were left — with a return code of zero on it.
      check("WRITE", indexed ? ["22"] : []);
      return;
    }
    case "rewrite":
      emitRecordFieldMapping(statement, addLine, indent, "write");
      addLine(`${indent}REWRITE ${fileRecordNameFor(statement.fileName)}`);
      if (status && statement.fileOrganization === "indexed") {
        addLine(`${indent}    INVALID KEY MOVE "23" TO ${status}`);
        addLine(`${indent}END-REWRITE`);
      }
      // A rewrite that did not happen leaves the record as it was, so a
      // balance the program has already computed is simply not stored, and
      // nothing downstream can tell that from a balance that did not change.
      check("REWRITE", indexed ? ["23"] : []);
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
      check("DELETE", ["23"]);
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
 * Emits a range check for every computed subscript a statement evaluates.
 *
 * COBOL does not check subscripts. An index past the end of a table reads or
 * writes whatever storage follows it, which inside a record is the next field:
 * `bands[11]` of a ten-element table assigned to is the field declared after
 * the table, silently holding a value nothing assigned to it.
 */
function emitBoundsChecks(
  statement: IRStatement,
  addLine: (line?: string) => void,
  indent: string,
): void {
  for (const check of collectStatementBoundsChecks(statement)) {
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
      // No routine to raise into — a sort procedure, or a handler entered by
      // the run time rather than called. The failure is named and the step is
      // failed rather than left to a status field nothing reads.
      addLine(
        `${indent}    DISPLAY "SUBSCRIPT OUT OF RANGE " ${check.index} UPON SYSOUT`,
      );
      if (inSortProcedure) {
        // Control may not leave a sort procedure while the sort is running, so
        // the subscript is also brought inside the table: the step is already
        // failing, and an in-range access is the one that cannot corrupt the
        // record on the way out.
        addLine(`${indent}    MOVE 16 TO SORT-RETURN`);
        addLine(`${indent}    MOVE ${check.length} TO ${check.index}`);
      } else {
        addLine(`${indent}    MOVE 12 TO RETURN-CODE`);
        addLine(`${indent}    GOBACK`);
      }
    }
    addLine(`${indent}END-IF`);
  }
}

/**
 * Every computed subscript a statement evaluates, in the order it evaluates
 * them.
 *
 * The walk is structural rather than a case per expression kind, and that is
 * deliberate. Guarding was previously written as a switch over the kinds an
 * expression could be, reached only from the right-hand side of an assignment,
 * and it leaked at every seam: the subscript on an assignment's *target* was
 * unguarded, so `book.bands[at].cap = ...` with `at` past the end wrote over
 * whatever followed the table — a neighbouring field of the same record, which
 * then held a value nothing in the program had assigned to it. So were the
 * subscripts in an `if` condition, in a `log`, and in every statement inside a
 * sort procedure. Kinds the switch had never been extended for — the numeric,
 * string, and temporal calls — dropped their arguments' subscripts too.
 *
 * Walking the statement's own data instead means a subscript is guarded because
 * it is there, not because someone remembered to add its context to a list, and
 * a statement kind added later is covered without being thought about.
 *
 * Nested blocks are skipped: their statements are emitted separately and guard
 * themselves, and a guard hoisted out of a branch would run on the path that
 * does not take it.
 */
function collectStatementBoundsChecks(
  statement: IRStatement,
): { index: string; length: number }[] {
  const checks = collectBoundsChecks(statement);
  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.index} ${check.length}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectBoundsChecks(
  root: unknown,
): { index: string; length: number }[] {
  const checks: { index: string; length: number }[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const entry = node as Record<string, unknown>;

    // A block is emitted separately, with its own guards.
    if (Array.isArray(entry.statements)) {
      return;
    }

    // The subscript is evaluated before the element it selects, so an inner
    // one is guarded before the outer one that uses it.
    if (entry.kind === "IndexAccess") {
      walk(entry.index);
      if (entry.needsBoundsCheck && (entry.length as number) > 0) {
        checks.push({
          index: renderDecimalExpression(entry.index as IRExpression),
          length: entry.length as number,
        });
      }
      walk(entry.target);
      return;
    }
    if (entry.kind === "MemberAccess" && entry.index) {
      walk(entry.index);
      if (entry.indexNeedsBoundsCheck && (entry.indexLength as number) > 0) {
        checks.push({
          index: renderDecimalExpression(entry.index as IRExpression),
          length: entry.indexLength as number,
        });
      }
      return;
    }

    for (const value of Object.values(entry)) {
      walk(value);
    }
  };

  walk(root);
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
            if (!callee?.isRecursive && !callee?.isNested) {
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
      } else if (callee?.isRecursive || callee?.isNested) {
        // COBOL paragraphs are not reentrant, so a recursive function is a
        // separate RECURSIVE program reached with CALL. A nested function is
        // reached the same way, being a contained program rather than a
        // paragraph.
        const operands = [
          ...expression.args
            // A nested function reads a record through the container's GLOBAL
            // declaration, so only the scalars are handed over.
            .map((argument, index) => ({ argument, index }))
            .filter(
              (entry) =>
                !callee.isNested ||
                entry.argument.resolvedType.kind !== "record",
            )
            .map((entry) => parameterFieldName(expression.callee, entry.index)),
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
  // Subscripts are guarded once per statement, before anything it evaluates,
  // rather than here — an assignment's target is subscripted too, and this is
  // reached only for the value being assigned.
  emitCallsIn(expression, addLine, indent);

  // `concat` and `now` assemble a value with STRING, which is a statement and
  // cannot be the right-hand side of a MOVE.
  if (
    expression.kind === "StringCall" &&
    (expression.operation === "concat" ||
      expression.operation === "now" ||
      expression.operation === "countOf" ||
      expression.operation === "replaceChars")
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
    emitCompute(
      `${indent}COMPUTE ${target} ROUNDED MODE IS ${COBOL_ROUNDING_MODES[expression.mode]} = ${renderDecimalExpression(expression.operand)}`,
      target,
      expression,
      addLine,
      indent,
    );
    return;
  }

  emitCompute(
    `${indent}COMPUTE ${target} = ${renderDecimalExpression(expression)}`,
    target,
    expression,
    addLine,
    indent,
  );
}

/**
 * A `COMPUTE`, guarded against a result too large for the field receiving it.
 *
 * Without `ON SIZE ERROR` the Language Reference is explicit about what COBOL
 * does: "If the ON SIZE ERROR phrase is not specified and a size error condition
 * occurs, truncation rules apply and the value of the affected resultant
 * identifier is computed." Truncation here is of the *high-order* digits, so a
 * balance of `decimal<9, 2>` receiving 9,999,999.99 + 9,999,999.99 was left
 * holding 9,999,999.98 — ten million short, with nothing said and a return code
 * of zero. Two amounts a field can each hold do not add up to one it can.
 *
 * Division by zero raises the same condition, so the guard covers that too: the
 * alternative is a program that ends abnormally in the middle of a batch with
 * no indication of which computation did it.
 *
 * With the phrase, COBOL leaves the receiving field alone rather than storing
 * the wrong answer, which is what makes stopping here safe: the value never
 * reaches the ledger. The field is named because a job log saying only that some
 * arithmetic overflowed is not something anyone can act on at three in the
 * morning.
 */
function emitCompute(
  statement: string,
  target: string,
  expression: IRExpression,
  addLine: (line?: string) => void,
  indent: string,
): void {
  if (!canSizeError(expression)) {
    addLine(statement);
    return;
  }

  addLine(statement);
  addLine(`${indent}    ON SIZE ERROR`);
  addLine(
    `${indent}        DISPLAY "ARITHMETIC OVERFLOW ${target}" UPON SYSOUT`,
  );
  if (inSortProcedure) {
    // Control may not leave a sort procedure while the sort is running, the
    // same reason the file status check sets SORT-RETURN rather than returning.
    addLine(`${indent}        MOVE 16 TO SORT-RETURN`);
  } else {
    addLine(`${indent}        MOVE 12 TO RETURN-CODE`);
    addLine(`${indent}        GOBACK`);
  }
  addLine(`${indent}END-COMPUTE`);
}

/**
 * Whether a computation can produce a value the receiving field cannot hold.
 *
 * Naming a value cannot: an identifier, a field, or a literal already fits the
 * type it was declared with, and moving one into a field of the same type is
 * exact. Combining values can, and so can rounding — 9.99 rounded to one place
 * carries into a digit that may not be there.
 *
 * The test is deliberately on the shape of the expression rather than on a
 * per-function analysis of how large each intrinsic's result can get. Guarding
 * a computation that turns out not to need it costs four lines that never run;
 * missing one costs a wrong number that nothing reports.
 */
function canSizeError(expression: IRExpression): boolean {
  switch (expression.kind) {
    case "BinaryArithmetic":
    case "Rounded":
    case "NumericCall":
      return true;
    default:
      return false;
  }
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

/**
 * The commarea a CICS transaction was passed, and the check that it exists.
 *
 * `DFHCOMMAREA` is the caller's storage, and it is only addressable when the
 * caller passed one — `EIBCALEN` is how a program knows. Reading it when
 * `EIBCALEN` is zero addresses whatever happens to be there, which is a storage
 * violation rather than an empty record, so IBM's guidance is to test first
 * always.
 *
 * What follows the test was the real defect: the transaction's first record
 * parameter is working storage, and nothing moved the commarea into it. The
 * program read uninitialised bytes and every test passed, because the reference
 * CICS runtime supplies no commarea and the assertions were about branches.
 */
function emitCommareaEntry(
  transaction: IRTransaction,
  addLine: (line?: string) => void,
): void {
  const commarea = commareaRecord(transaction);
  if (!commarea) {
    return;
  }

  // Not merely "was one passed": IBM's rule is that the program verifies
  // EIBCALEN matches what it expects, because a discrepancy risks a storage
  // violation. A caller that passes ten bytes to a program whose record is
  // seventy-two leaves the MOVE below reading sixty-two bytes of whatever
  // follows the commarea — which is somebody else's storage, and reads clean.
  //
  // Zero is the same test: no commarea where one is required is a broken
  // contract rather than an empty request, and returning quietly would make it
  // look like the transaction ran.
  addLine(`           IF EIBCALEN < LENGTH OF DFHCOMMAREA`);
  addLine(`               EXEC CICS ABEND ABCODE("BKNC") END-EXEC`);
  addLine(`           END-IF`);
  addLine(`           MOVE DFHCOMMAREA TO ${toCobolName(commarea.name)}`);
}

/**
 * The commarea on the way out.
 *
 * `DFHCOMMAREA` is the caller's own storage, so whatever the transaction
 * changed in that record is what the caller expects to see when it gets control
 * back. Without this the program can read its input and still return nothing.
 */
function emitCommareaExit(
  transaction: IRTransaction,
  addLine: (line?: string) => void,
): void {
  const commarea = commareaRecord(transaction);
  if (!commarea || endsWithReturnTransid(transaction.body)) {
    return;
  }
  addLine(`           MOVE ${toCobolName(commarea.name)} TO DFHCOMMAREA`);
}

/** The record a CICS transaction receives through its commarea: the first one. */
function commareaRecord(transaction: IRTransaction): { name: string } | null {
  if (!transaction.isCics) {
    return null;
  }
  const parameter = transaction.parameters.find(
    (entry) => entry.type.kind === "record",
  );
  return parameter && parameter.type.kind === "record" ? parameter.type : null;
}

/** `for each` index variables need storage, like any other local. */
/** True when a body's last statement hands control back to CICS itself. */
function endsWithReturnTransid(block: IRBlock): boolean {
  const last = block.statements[block.statements.length - 1];
  return last?.kind === "CicsStatement" && last.operation === "returnTransid";
}

/** Files a program checkpoints to, each needing a counter. */
function checkpointedFiles(program: IRProgram): string[] {
  return statementFileNames(program, "CheckpointStatement");
}

/** Files a program restarts from, each needing a found flag. */
function restartedFiles(program: IRProgram): string[] {
  return statementFileNames(program, "RestartStatement");
}

/**
 * The files named by every statement of one kind, wherever it sits.
 *
 * A walk rather than a search of the serialized IR: a regular expression over
 * JSON depends on the order the lowering happens to build its objects in, which
 * is not something the lowering promises.
 */
function statementFileNames(program: IRProgram, kind: string): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    const entry = node as { kind?: unknown; fileName?: unknown };
    if (entry.kind === kind && typeof entry.fileName === "string") {
      found.add(entry.fileName);
    }
    Object.values(node).forEach(walk);
  };

  walk(program.transactions);
  return [...found];
}

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

  const record = statement.commarea
    ? resolveIdentifier(statement.commarea)
    : null;

  switch (statement.operation) {
    case "link": {
      const commarea = record ? ` COMMAREA(${record})` : "";
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

    // A CICS file command reaches a VSAM dataset through CICS rather than
    // through COBOL file control: there is no OPEN, no CLOSE, and no FD,
    // because the region owns the dataset and the program only asks.
    case "readFile":
      addLine(
        `${indent}EXEC CICS READ FILE("${statement.program}")${record ? ` INTO(${record})` : ""}${statement.key ? ` RIDFLD(${renderExpression(statement.key)})` : ""}${resp} END-EXEC`,
      );
      return;
    case "writeFile":
      addLine(
        `${indent}EXEC CICS WRITE FILE("${statement.program}")${record ? ` FROM(${record})` : ""}${statement.key ? ` RIDFLD(${renderExpression(statement.key)})` : ""}${resp} END-EXEC`,
      );
      return;
    case "rewriteFile":
      // No RIDFLD: a rewrite updates the record the preceding read holds, so
      // naming a key here would describe a different operation.
      addLine(
        `${indent}EXEC CICS REWRITE FILE("${statement.program}")${record ? ` FROM(${record})` : ""}${resp} END-EXEC`,
      );
      return;

    // Temporary storage is the scratchpad an online transaction passes state
    // through between the halves of a pseudo-conversation.
    case "writeQueue":
      addLine(
        `${indent}EXEC CICS WRITEQ TS QUEUE("${statement.program}")${record ? ` FROM(${record})` : ""}${resp} END-EXEC`,
      );
      return;
    case "readQueue":
      addLine(
        `${indent}EXEC CICS READQ TS QUEUE("${statement.program}")${record ? ` INTO(${record})` : ""}${resp} END-EXEC`,
      );
      return;

    // Ends the task naming what runs next, which is how a pseudo-conversation
    // continues: CICS frees the program between the halves and starts the named
    // transaction when the terminal replies.
    case "returnTransid":
      addLine(
        `${indent}EXEC CICS RETURN TRANSID("${statement.program}")${record ? ` COMMAREA(${record})` : ""} END-EXEC`,
      );
      return;
  }
}

function sqlParameterName(statementName: string, index: number): string {
  return `${toCobolName(statementName)}-H${index + 1}`;
}

/**
 * The decimal point convention of the program being emitted.
 *
 * It changes how an edited picture is written, so it has to reach
 * `formatCobolType`, which has no other route to the emit options.
 */
let currentDecimalPoint: "point" | "comma" = "point";

/** Cursors the program declares, for rewriting `WHERE CURRENT OF`. */
let cursorNames = new Set<string>();

/**
 * The assign name on a sort-work file's SELECT.
 *
 * `ASSIGN TO` is required on the SELECT and the name is then **treated as
 * documentation** — IBM's own example assigns two SD files to the same name.
 * Nothing is allocated for it and no DD statement answers to it.
 *
 * So it deliberately is not `SORTWK01`. That is the DD the sort product reads
 * for its first *work dataset*, which is a different thing that the job does
 * allocate; putting it here would read as though the SD were bound to it, and
 * anyone who changed one to match the other would find that neither mattered.
 */
function sortWorkDdName(_fileName: string): string {
  return "SORTWORK";
}

/** The sort-work file a SORT or MERGE runs through. */
function sortWorkName(fileName: string): string {
  return `${toCobolName(fileName)}-SORT-FILE`;
}

function sortWorkRecordName(fileName: string): string {
  return `${toCobolName(fileName)}-SORT-RECORD`;
}

/** Output files a program sorts or merges into, each needing an SD. */
function sortedFiles(program: IRProgram): string[] {
  return [
    ...new Set(sortStatements(program).map((entry) => entry.statement.output)),
  ];
}

/**
 * Every SORT or MERGE in the program, wherever it is nested, with the routine
 * that owns it.
 *
 * A procedure's body is emitted as a section of its own but still refers to the
 * owning routine's parameters, so the owner has to travel with the statement.
 */
interface OwnedSort {
  statement: IRSortStatement;
  inTransaction: boolean;
  owner: string;
  parameters: IRParameter[];
}

function sortStatements(program: IRProgram): OwnedSort[] {
  const found: OwnedSort[] = [];
  let owner: Omit<OwnedSort, "statement"> = {
    inTransaction: false,
    owner: "",
    parameters: [],
  };
  const walk = (block: IRBlock): void => {
    for (const statement of block.statements) {
      if (statement.kind === "SortStatement") {
        found.push({ statement, ...owner });
        for (const procedure of [
          statement.inputProcedure,
          statement.outputProcedure,
        ]) {
          if (procedure) {
            walk(procedure.body);
          }
        }
      }
      for (const nested of [
        (statement as { body?: IRBlock }).body,
        (statement as { notFound?: IRBlock }).notFound,
        (statement as { thenBranch?: IRBlock }).thenBranch,
        (statement as { elseBranch?: IRBlock | null }).elseBranch,
      ]) {
        if (nested) {
          walk(nested);
        }
      }
    }
  };
  for (const transaction of program.transactions) {
    owner = {
      inTransaction: true,
      owner: transaction.name,
      parameters: transaction.parameters,
    };
    walk(transaction.body);
  }
  for (const fn of program.functions) {
    owner = { inTransaction: false, owner: fn.name, parameters: fn.parameters };
    walk(fn.body);
  }
  return found;
}

/**
 * Names for the section a sort procedure becomes and the flag that stops its
 * loop, derived from the statement's position so they are deterministic and
 * unique without a counter.
 */
function sortProcedureName(
  statement: IRSortStatement,
  kind: "input" | "output",
): string {
  const { line, column } = statement.span.start;
  return `BANK-SORT-${kind === "input" ? "IN" : "OUT"}-${line}-${column}`;
}

function sortProcedureEndFlag(
  statement: IRSortStatement,
  kind: "input" | "output",
): string {
  return `${sortProcedureName(statement, kind)}-END`;
}

/**
 * The index register a table is searched through.
 *
 * COBOL's SEARCH walks an index rather than a subscript, so every OCCURS
 * carries one. It costs nothing when nothing searches the table, and it is the
 * idiomatic declaration either way.
 */
function tableIndexName(fieldName: string): string {
  return `${toCobolFieldName(fieldName)}-IDX`;
}

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
/**
 * A numeric builtin, as the COBOL intrinsic that does the same thing.
 *
 * Every one of these is COBOL's own arithmetic rather than something this
 * compiler works out, which is the reason to route through them: `ANNUITY` is
 * the repayment factor Enterprise COBOL was given for exactly this industry,
 * and a version written in a loop rounds differently in the final instalment.
 */
function renderNumericCall(expression: IRNumericCallExpression): string {
  const args = expression.args.map(renderExpression);
  const [first, second] = args;

  switch (expression.operation) {
    case "abs":
      return `FUNCTION ABS(${first})`;
    case "mod":
      return `FUNCTION MOD(${first}, ${second})`;
    case "rem":
      return `FUNCTION REM(${first}, ${second})`;
    case "min":
      return `FUNCTION MIN(${first}, ${second})`;
    case "max":
      return `FUNCTION MAX(${first}, ${second})`;
    case "annuity":
      return `FUNCTION ANNUITY(${first}, ${second})`;
    case "presentValue":
      return `FUNCTION PRESENT-VALUE(${first}, ${second})`;
    case "toNumber":
      // NUMVAL-C rather than NUMVAL: a number arriving as text in a banking
      // feed carries grouping and a currency symbol as often as not, and
      // NUMVAL-C reads both. It reads a plain number too.
      return `FUNCTION NUMVAL-C(${first})`;
    case "isNumeric":
      // TEST-NUMVAL-C returns zero when the characters convert, and otherwise
      // the position of the one that stopped it. Asking first is the
      // difference between rejecting a record and abending on it.
      return `(FUNCTION TEST-NUMVAL-C(${first}) = 0)`;
    case "integerPart":
      return `FUNCTION INTEGER-PART(${first})`;
    case "fractionPart":
      return `FUNCTION FRACTION-PART(${first})`;
    case "sign":
      return `FUNCTION SIGN(${first})`;
    case "reverse":
      return `FUNCTION REVERSE(${first})`;
    case "textLength":
      // The declared width of a COBOL field is fixed, so LENGTH would answer a
      // question nobody asked. This is what the field actually holds, trailing
      // spaces excluded — the length a variable-length feed needs to write.
      return `FUNCTION STORED-CHAR-LENGTH(${first})`;
  }
}

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
    case "countOf":
    case "replaceChars":
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
  // INSPECT counts and converts in place, so both need a statement and a
  // target that already holds the value being examined.
  if (expression.operation === "countOf") {
    addLine(`${indent}MOVE 0 TO ${target}`);
    addLine(
      `${indent}INSPECT ${renderExpression(expression.args[0])} TALLYING ${target} FOR ALL ${renderExpression(expression.args[1])}`,
    );
    return;
  }

  if (expression.operation === "replaceChars") {
    addLine(
      `${indent}MOVE ${renderExpression(expression.args[0])} TO ${target}`,
    );
    addLine(
      `${indent}INSPECT ${target} CONVERTING ${renderExpression(expression.args[1])} TO ${renderExpression(expression.args[2])}`,
    );
    return;
  }

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
    case "NumericCall":
      return renderNumericCall(expression);
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
    case "IndexAccess": {
      // COBOL subscripts the innermost name with every dimension at once —
      // `RATE-ITEM (I, J)`, not `RATE (I) (J)` — so a chain of index accesses
      // collapses into one reference.
      const subscripts: string[] = [];
      let target: IRExpression = expression;
      let depth = 0;
      while (target.kind === "IndexAccess") {
        subscripts.unshift(renderExpression(target.index));
        target = target.target;
        depth += 1;
      }
      const base = renderExpression(target);
      // Only the deepest name carries the subscripts, and a table of tables
      // names its inner item separately.
      const name = depth > 1 ? withInnerTableName(base, depth - 1) : base;
      return `${name} (${subscripts.join(", ")})`;
    }
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
  // Inside a search, the bound element name stands for the table entry the
  // index is pointing at, so a field of it qualifies by the subscripted table.
  if (currentSearchElement?.name === expression.targetName) {
    return currentSearchElement.reference;
  }

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
      .filter((fn) => !fn.isRecursive && !fn.isNested)
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
      return editedPicture(
        type.style,
        type.precision,
        type.scale,
        currentDecimalPoint,
      );
    case "temporal":
      return temporalPicture(type.unit);
    case "decimal":
      return decimalPicture(type.precision, type.scale, type.usage);
    case "string":
      return type.national
        ? `PIC N(${type.length}) USAGE NATIONAL`
        : `PIC X(${type.length})`;
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

/**
 * The copybook for a record, as the record's own COBOL declaration.
 *
 * It goes through the same emitter the program does. A flat list of pictures
 * was not the same record: it dropped `REDEFINES`, `OCCURS`, `SYNCHRONIZED`,
 * the nested groups, and the 88-levels. Under `copybookMode: "copy"` the
 * program's storage *is* the copybook, so those omissions were not cosmetic —
 * a redefining field took storage of its own and pushed every later field
 * along, a table collapsed to a single element, and an aligned field lost the
 * slack bytes the layout report accounts for.
 */
export function renderCopybook(record: IRRecord): string {
  // A copybook is source: the compiler reads the member in the same reference
  // format as the program that copies it, so the 01 sits in Area A at column 8
  // like any other level indicator. Starting it in column 1 put `  AC` in the
  // sequence number area and `C` in the indicator area, and every line of every
  // generated copybook was rejected before the program had a chance to fail.
  const lines: string[] = [];
  const addLine = (line = ""): void => {
    lines.push(...toReferenceFormat(line));
  };

  addLine("       *> Generated by bankc.");
  addLine("       *> Do not edit this file directly.");
  addLine(`       01  ${toCobolName(record.name)}.`);
  emitRecordFields(record.fields, 1, addLine);
  emitAllRenames(record, toCobolName(record.name), addLine, " ".repeat(11));

  return `${lines.join("\n")}\n`;
}

export function countPackedDecimalBytes(precision: number): number {
  return packedDecimalByteLength(precision);
}
