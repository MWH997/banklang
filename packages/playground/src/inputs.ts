/**
 * What the program is given before it runs.
 *
 * The Run tab used to execute every program against zero-initialised storage,
 * so `account-posting`, the example whose entire subject is a balanced
 * transfer, posted 0.00 against 0.00 on the feature sold as "read the postings
 * it made rather than take the compiler's word for them". The one case that
 * proves nothing.
 *
 * A program on z/OS is given its input by the job around it: a dataset the step
 * allocates, the PARM on the `EXEC` card, or a caller's communication area.
 * This describes the same three surfaces for a reader with none of them, and
 * the panel makes each editable:
 *
 * - **The entry record.** A generated batch program holds its transaction's
 *   record parameter in WORKING-STORAGE. Nothing in the program fills it: on a
 *   real system a caller, a PARM or a dataset does, and here the panel does. It
 *   is labelled as what it is, because a reader who thinks the program produced
 *   these numbers by itself has learnt something untrue.
 * - **An input dataset.** Where the program opens a file, its records are built
 *   from the same layout the compiler reports, at the same offsets, in the same
 *   encoding, packed decimal included.
 * - **The PARM.** A program with `PROCEDURE DIVISION USING` is entered with a
 *   parameter area; `run.ts` already builds one, and this is what goes in it.
 *
 * **Records are built from the compiler's own layout document.** Not from
 * hand-counted offsets: if the emitter's layout changes, what the panel writes
 * changes with it, and what shows up is a behavioural difference rather than a
 * field landing two bytes late. This is the same rule `tools/conformance.ts`
 * follows for the seeded records CI executes.
 *
 * The PARM follows that rule through `batchParmFields`, which is the emitter's
 * own account of the parameter area, the list `emitParmParagraph` generates
 * the parsing code from. It was briefly a single opaque `X(512)` seeded blank,
 * on the reasoning that the layout inside a PARM is the program's own
 * convention. It is not: it is this compiler's, and it is already exported.
 * The cost of guessing was that all four PARM-driven examples failed their own
 * length check on the first statement, ended the step with return code 12, and
 * never reached the dataset seeded beside them: the same empty answer this file
 * exists to stop giving, on the one example whose subject is the PARM.
 */

import type {
  CopybookLayoutDocument,
  CopybookLayoutEntry,
  CopybookLayoutReport,
} from "../../copybook/src/index";
import type { IRProgram, IRSql, IRTransaction } from "../../ir/src/index";
import {
  batchParmFields,
  restartControlFiles,
  toDdName,
  type BatchParmField,
} from "../../cobol-backend/src/index";
import { toCobolName } from "../../cobol-ir/src/index";

/** One editable field of a record, as the panel shows it. */
export interface InputField {
  /** The COBOL name, which is what the layout and the program both use. */
  name: string;
  picture: string;
  usage: string;
  bytes: number;
  /** True where the BankTS record declared the field `sensitive`. */
  sensitive: boolean;
}

/** One editable surface: a record in storage, a dataset, the PARM, or Db2. */
export interface InputSurface {
  kind: "entry" | "dataset" | "parm" | "sql";
  /** The 01-level name for a record, the `ASSIGN TO` name for a dataset. */
  name: string;
  /** What this is, in one sentence, for the panel to print above it. */
  note: string;
  fields: InputField[];
  /** One entry per record. An entry record has exactly one. */
  records: Record<string, string>[];
}

/** Everything a program can be given, and what it is seeded with. */
export interface ProgramInputs {
  surfaces: InputSurface[];
  /**
   * Why there is nothing to fill, where that is the case.
   *
   * A program that reads no dataset, takes no PARM and holds no entry record
   * has no input path at all, on z/OS either. Saying so is the point: the
   * numbers being zero is then a fact about the example rather than about the
   * browser, and the reader is not left to guess which.
   */
  reason: string | null;
}

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

/** Digits after the implied decimal point in a picture such as `S9(16)V99`. */
function scaleOf(picture: string): number {
  const repeated = /V9\((\d+)\)/.exec(picture);
  if (repeated) {
    return Number(repeated[1]);
  }
  const literal = /V(9+)/.exec(picture);
  return literal ? literal[1]!.length : 0;
}

/**
 * Whether a picture describes a number rather than text.
 *
 * The leading symbol decides it, not whether a `9` appears anywhere: a
 * `string<9>` is `X(9)`, and asking "does this contain a 9" seeds it with an
 * amount and then writes that amount into an alphanumeric field. An edited
 * picture (`ZZ,ZZ9.99`, `-(16)9.99`) leads with its editing symbol and is
 * text as far as writing into it goes, which is what it should be.
 *
 * The `PIC ` prefix is optional because the layout report includes it and the
 * emitter's PARM fields are written the same way. A test anchored without
 * allowing for it is a test that is always false: `buildRecord` had one, so
 * every numeric field that was not `COMP-3` took the alphanumeric path and
 * would have been written as characters into a binary or zoned item. No record
 * in the corpus has such a field, so nothing caught it.
 */
function isNumericPicture(picture: string): boolean {
  return /^(PIC\s+)?S?9/.test(picture);
}

/**
 * A number as packed decimal: two digits to a byte, sign in the last nibble.
 *
 * 0x0C for positive and 0x0D for negative, which is what COMP-3 means and what
 * `encodePacked` in `tools/conformance.ts` writes for the records CI executes.
 * `tests/playground-inputs.test.ts` holds the two against each other, because
 * two encoders that disagree would make the browser and CI run different
 * programs while reporting the same thing.
 */
export function packDecimal(
  value: number,
  scale: number,
  byteLength: number,
): Uint8Array {
  const negative = value < 0;
  const scaled = Math.round(Math.abs(value) * 10 ** scale);
  const digits = String(scaled).padStart(byteLength * 2 - 1, "0");
  const bytes = new Uint8Array(byteLength);

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const at = Math.floor(index / 2);
    bytes[at] =
      index % 2 === 0 ? (bytes[at]! & 0x0f) | (digit << 4) : bytes[at]! | digit;
  }
  bytes[byteLength - 1] =
    (bytes[byteLength - 1]! & 0xf0) | (negative ? 0x0d : 0x0c);
  return bytes;
}

/** A zoned or binary numeric, written as the picture says. */
function packNumeric(entry: CopybookLayoutEntry, value: number): Uint8Array {
  const scale = scaleOf(entry.picture);
  const scaled = Math.round(Math.abs(value) * 10 ** scale);
  if (entry.usage === "COMP" || entry.usage === "BINARY") {
    const bytes = new Uint8Array(entry.bytes);
    let rest = value < 0 ? BigInt(-scaled) : BigInt(scaled);
    if (value < 0) {
      // Two's complement, which is what a signed binary item holds.
      rest = (1n << BigInt(entry.bytes * 8)) + rest;
    }
    for (let index = entry.bytes - 1; index >= 0; index -= 1) {
      bytes[index] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    return bytes;
  }
  // Display: one digit per byte, with the sign overpunched on the last one.
  const digits = String(scaled).padStart(entry.bytes, "0").slice(-entry.bytes);
  const bytes = encoder.encode(digits);
  if (value < 0 && /S/.test(entry.picture)) {
    // ASCII overpunch, which is what this runtime and GnuCOBOL both read.
    bytes[entry.bytes - 1] = bytes[entry.bytes - 1]! + 0x40;
  }
  return bytes;
}

/**
 * A fixed-length record, built from the compiler's layout report.
 *
 * Blank-filled first, because that is what an unwritten byte of a record area
 * is on z/OS, and a field the caller left out then reads as spaces rather than
 * as a low value nothing would print.
 */
export function buildRecord(
  layout: CopybookLayoutReport,
  values: Record<string, string>,
): Uint8Array {
  const record = new Uint8Array(layout.totalLength).fill(0x20);

  for (const entry of layout.entries) {
    const value = values[fieldName(entry.path)];
    if (value === undefined || value === "") {
      continue;
    }
    record.set(encodeField(entry, value), entry.offset);
  }

  return record;
}

/**
 * One field's bytes, in the encoding its picture and usage describe.
 *
 * Separated from `buildRecord` because a Db2 row is delivered one host
 * variable at a time rather than as a contiguous record: the `INTO` list can
 * name three fields of a record and the FETCH writes each one on its own.
 */
export function encodeField(
  entry: CopybookLayoutEntry,
  value: string,
): Uint8Array {
  if (entry.usage === "COMP-3") {
    return packDecimal(Number(value), scaleOf(entry.picture), entry.bytes);
  }
  if (isNumericPicture(entry.picture)) {
    return packNumeric(entry, Number(value));
  }
  const text = value.slice(0, entry.bytes).padEnd(entry.bytes, " ");
  return encoder.encode(text).subarray(0, entry.bytes);
}

/** The trailing field name of a layout path such as `ACCOUNT-REC.BALANCE`. */
function fieldName(path: string): string {
  return path.slice(path.indexOf(".") + 1);
}

/**
 * One PARM parameter, as a field of the panel.
 *
 * Named as the BankTS source names it rather than by its COBOL linkage name,
 * because that is the name on the `entry transaction` line the reader is
 * looking at, and `docs/jcl-model.md` documents the PARM template in those
 * terms too.
 */
function parmInputField(field: BatchParmField): InputField {
  return {
    name: field.source,
    // Left as the emitter writes it, `PIC ` and all, because that is how the
    // layout report gives a record's pictures and the panel shows both.
    picture: field.picture,
    // A PARM is characters someone types on an EXEC statement, so every field
    // in it is DISPLAY, a number included, which is why the program tests it
    // with `IS NUMERIC` before it computes on it.
    usage: "DISPLAY",
    bytes: field.width,
    sensitive: false,
  };
}

/**
 * The PARM as the characters a job step passes.
 *
 * Positional, each parameter occupying its declared width. A numeric parameter
 * is written as zoned decimal, every digit, no decimal point, with a separate
 * leading sign where the type has one, because that is the picture the linkage
 * group declares. Writing `1200.00` into `S9(16)V99` instead would fail the
 * program's own `IS NUMERIC` test, which is the point of that test.
 */
/** Every row a cursor is to answer with, as the bytes each host variable gets. */
export interface CursorRows {
  cursor: string;
  /** Rows per FETCH, for a `rowset` cursor. Null is one row at a time. */
  rowset: number | null;
  /** One entry per row; each holds one value per host variable, in order. */
  rows: Uint8Array[][];
}

/**
 * The rows the panel holds, keyed by cursor name rather than by statement.
 *
 * The statement numbers the script is keyed by are assigned by the precompiler,
 * and `run.ts` is where the precompiled text exists. Deriving them from the
 * order the `EXEC SQL` statements appear in would be a second implementation of
 * the precompiler's numbering, the mistake the PARM already made once.
 */
export function cursorRowsOf(
  surfaces: readonly InputSurface[],
  layouts: CopybookLayoutDocument,
  program: IRProgram,
): CursorRows[] {
  const byName = new Map(
    layouts.reports.map((report) => [report.recordName, report]),
  );
  const result: CursorRows[] = [];

  for (const surface of surfaces) {
    if (surface.kind !== "sql") {
      continue;
    }
    const cursor = program.sql.find((each) => each.name === surface.name);
    const layout = cursor?.resultRecordName
      ? byName.get(cursor.resultRecordName)
      : undefined;
    if (!cursor || !layout) {
      continue;
    }
    result.push({
      cursor: surface.name,
      rowset: cursor.rowset,
      rows: surface.records.map((values) =>
        surface.fields.map((field) => {
          const entry = layout.entries.find(
            (each) => fieldName(each.path) === field.name,
          );
          const value = values[field.name] ?? "";
          return entry && value !== ""
            ? encodeField(entry, value)
            : new Uint8Array(0);
        }),
      ),
    });
  }

  return result;
}

export function parmText(surface: InputSurface): string {
  const values = surface.records[0] ?? {};
  return surface.fields
    .map((field) => parmValue(field, values[field.name] ?? ""))
    .join("");
}

function parmValue(field: InputField, value: string): string {
  if (!isNumericPicture(field.picture)) {
    return value.slice(0, field.bytes).padEnd(field.bytes, " ");
  }
  const signed = /SIGN IS LEADING SEPARATE/.test(field.picture);
  const width = field.bytes - (signed ? 1 : 0);
  const number = value === "" ? 0 : Number(value);
  const scaled = Math.round(Math.abs(number) * 10 ** scaleOf(field.picture));
  const digits = String(scaled).padStart(width, "0").slice(-width);
  return signed ? `${number < 0 ? "-" : "+"}${digits}` : digits;
}

/* ------------------------------------------------------------------ *
 * What a program can be given
 * ------------------------------------------------------------------ */

/**
 * A group item is not a field somebody types into: its bytes are the fields
 * inside it. Nor is a table, whose occurrences the panel has no way to show.
 */
function editable(layout: CopybookLayoutReport): CopybookLayoutEntry[] {
  return layout.entries.filter(
    (entry) =>
      entry.picture !== "" &&
      !entry.type.startsWith("record") &&
      !entry.type.startsWith("array") &&
      // A field inside a table occurs more than once and the offsets the panel
      // would write to are only the first occurrence's.
      !entry.path.includes("["),
  );
}

function fieldsOf(layout: CopybookLayoutReport): InputField[] {
  return editable(layout).map((entry) => ({
    name: fieldName(entry.path),
    picture: entry.picture,
    usage: entry.usage,
    bytes: entry.bytes,
    sensitive: entry.sensitive,
  }));
}

/**
 * A value to start a field at.
 *
 * Derived from the name and the picture rather than written out per example,
 * because a panel seeded with blanks is the defect this closes wearing a form
 * around it. The point is that the reader opens the tab and the program has
 * something to do; every value here is theirs to change.
 */
function seedFor(field: InputField, index: number): string {
  const name = field.name.toUpperCase();
  if (field.usage === "COMP-3" || isNumericPicture(field.picture)) {
    if (/RATE|PERCENT/.test(name)) {
      return "0.0450";
    }
    if (/MINIMUM|FLOOR|LIMIT/.test(name)) {
      return "500.00";
    }
    if (/COUNT|NUMBER|SEQ|INDEX/.test(name)) {
      return String(index + 1);
    }
    // A balance larger than the amount taken out of it, so a program that
    // guards a withdrawal takes the path where it permits one. Seeding both at
    // the same figure left every such example on its refusal path, which is a
    // real path and not the one a reader opens the tab to see.
    if (/BALANCE|PRINCIPAL|OPENING/.test(name)) {
      return "5000.00";
    }
    if (/DATE/.test(name)) {
      return "20260807";
    }
    return "1200.00";
  }
  if (/IDEMPOTENCY|CORRELATION|KEY/.test(name)) {
    return `IDEM-${String(index + 1).padStart(4, "0")}`;
  }
  // Two different accounts for the two legs of a transfer. Seeding both from
  // one rule gave `account-posting` a debit and a credit on the same account,
  // which nets to zero: a balanced journal that demonstrates nothing, which is
  // the shape of answer this whole panel exists to stop giving.
  if (/^CREDIT|BENEFICIARY|^TO-/.test(name)) {
    return `ACC-${String(index + 2).padStart(10, "0")}`;
  }
  if (/ACCOUNT|CUSTOMER|PARTY/.test(name)) {
    return `ACC-${String(index + 1).padStart(10, "0")}`;
  }
  if (/BRANCH/.test(name)) {
    return "BRANCH-TILL";
  }
  if (/STATUS|OUTCOME|TYPE|CODE/.test(name)) {
    return "OPEN";
  }
  if (/NAME|DESCRIPTION|NARRATIVE/.test(name)) {
    return "SAMPLE";
  }
  return "";
}

function seedRecord(
  fields: InputField[],
  index: number,
  /** The BankTS record these fields belong to, for the comparison lookup. */
  record?: string,
  /** What the program tests each field against, from `comparedLiterals`. */
  compared?: Map<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field.name] =
      compared?.get(`${record ?? ""}.${field.name}`) ?? seedFor(field, index);
  }
  return values;
}

/**
 * Record variables a keyed read takes its key from.
 *
 * `read accountMaster into master key statement.accountId` asks the file for
 * one record, and the key comes out of `statement`, a parameter the program
 * never writes. The rule below excludes every record parameter of a
 * file-reading program on the grounds that the file fills them, which is true
 * of `master` and false of `statement`: `statement-generation` ran with a blank
 * key, the master file answered "no such record", and the one example whose
 * subject is producing a statement demonstrated the not-found path instead.
 *
 * A record the program also reads into is excluded, because then the program
 * fills it. `vsam-browse` looks like a counter-example and is not: it starts a
 * browse at `account.customerId`, but the statement before the `START` is
 * `account.customerId = request.wantedCustomerId`, so the program writes the
 * key it then searches on and a seeded one is a form the reader fills in and
 * the program discards.
 */
function keyedRecords(transaction: IRTransaction): Set<string> {
  const names = new Set<string>();
  const filled = new Set<string>();

  const fromExpression = (node: unknown): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(fromExpression);
      return;
    }
    if ("targetName" in node && typeof node.targetName === "string") {
      names.add(node.targetName);
    }
    Object.values(node).forEach(fromExpression);
  };

  const fromStatements = (node: unknown): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(fromStatements);
      return;
    }
    const statement = node as {
      kind?: string;
      key?: unknown;
      operation?: string;
      recordName?: string | null;
      intoRecord?: string | null;
      commarea?: string | null;
    };
    if (
      (statement.kind === "FileStatement" ||
        statement.kind === "CicsStatement") &&
      statement.key !== undefined
    ) {
      fromExpression(statement.key);
    }
    // What the program writes for itself, by any of the four routes there are.
    if (
      statement.kind === "FileStatement" &&
      (statement.operation === "read" || statement.operation === "readNext") &&
      statement.recordName
    ) {
      filled.add(statement.recordName);
    }
    if (
      statement.kind === "QueueStatement" &&
      statement.operation === "get" &&
      statement.recordName
    ) {
      filled.add(statement.recordName);
    }
    if (statement.kind === "SqlStatement" && statement.intoRecord) {
      filled.add(statement.intoRecord);
    }
    if (statement.kind === "CicsStatement" && statement.commarea) {
      filled.add(statement.commarea);
    }
    Object.values(node).forEach(fromStatements);
  };

  fromStatements(transaction.body);
  for (const name of filled) {
    names.delete(name);
  }
  return names;
}

/**
 * The value a program tests a field against, where it tests one.
 *
 * A seed derived from the field's name is a guess, and on a field the program
 * branches on it is usually the wrong guess: `rawStatus` is a `string<1>`, the
 * name rule answered "OPEN", one byte of that is "O", and the program that
 * settles a transaction when `rawStatus == "A"` settled none of the three it
 * was given. The whole night's first step reported "READ 3, EXTRACTED 0" and
 * ended with return code 4, which is real behaviour on data nobody chose.
 *
 * The program says what it wants. Where a field is compared against a string
 * literal, that literal is the seed, so the panel opens on the path the example
 * exists to show. The first comparison wins: a field tested against several
 * values has no single right answer, and the first is the one the program
 * checks first.
 */
function comparedLiterals(transaction: IRTransaction): Map<string, string> {
  const found = new Map<string, string>();

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const test = node as {
      kind?: string;
      operator?: string;
      left?: { kind?: string; recordName?: string; member?: string };
      right?: { kind?: string; value?: unknown };
    };
    if (
      test.kind === "BinaryComparison" &&
      test.operator === "==" &&
      test.left?.kind === "MemberAccess" &&
      test.left.recordName &&
      test.left.member &&
      test.right?.kind === "StringLiteral" &&
      typeof test.right.value === "string"
    ) {
      const key = `${test.left.recordName}.${toCobolName(test.left.member)}`;
      if (!found.has(key)) {
        found.set(key, test.right.value);
      }
    }
    Object.values(node).forEach(visit);
  };

  visit(transaction.body);
  return found;
}

/** How many records a seeded input dataset holds. Enough to see a loop run. */
const SEEDED_RECORDS = 3;

/** How many rows a seeded cursor returns before end of data. */
const SEEDED_ROWS = 3;

/**
 * The fields a FETCH writes, in the order it passes them.
 *
 * The `INTO` list is the calling sequence: `hostVariables` in declaration order
 * with `origin: "result"` are operands 1..n of the generated
 * `CALL "DSNHLI"`, and the script that fills them is keyed by that position.
 * Taking the record's fields in layout order instead would be right only while
 * the two happen to coincide.
 */
function fetchedFields(
  cursor: IRSql,
  layout: CopybookLayoutReport,
): InputField[] {
  const fields: InputField[] = [];

  for (const variable of cursor.hostVariables) {
    if (variable.origin !== "result") {
      continue;
    }
    const name = toCobolName(variable.name);
    const entry = layout.entries.find(
      (each) => fieldName(each.path) === name && each.picture !== "",
    );
    if (entry) {
      fields.push({
        name,
        picture: entry.picture,
        usage: entry.usage,
        bytes: entry.bytes,
        sensitive: entry.sensitive,
      });
    }
  }

  return fields;
}

/**
 * Every surface a program can be given something on, seeded.
 *
 * The entry record first, because it is the one a reader of a transaction is
 * looking for, then a dataset per input file in declaration order.
 */
export function inputsFor(
  program: IRProgram,
  layouts: CopybookLayoutDocument,
): ProgramInputs {
  const byName = new Map(
    layouts.reports.map((report) => [report.recordName, report]),
  );
  const surfaces: InputSurface[] = [];

  // The same rule `findEntryTransaction` uses in the backend: an explicit
  // `entry transaction`, or the only one there is.
  const entry =
    program.transactions.find((transaction) => transaction.isEntry) ??
    program.transactions[0];
  // Only where nothing else already fills it.
  //
  // A file-driven batch is given its input by the file; its record parameters
  // are the totals and the progress it keeps while it runs, and seeding those
  // would start the run with a count somebody typed. A CICS transaction is
  // given a communication area, which the program copies over its own record on
  // entry, so anything put there is overwritten before the first statement that
  // reads it. A queue-driven program is the same case: `getMessage ... into
  // request` writes the message over the record before anything reads it, so a
  // seeded one is a form the reader fills in and the program discards. That is
  // true on z/OS as much as here, which is what makes it worth saying rather
  // than working around.
  //
  // A restart control file is not one of those. It is written by the program's
  // own checkpoint and read for one position, and it fills nothing a reader
  // would otherwise have to supply. Counting it here took the branch and the
  // rate away from `branch-accrual-cursor` the moment that example gained a
  // checkpoint, and the run accrued interest at zero per cent on every account.
  // `restartControlFiles` is the emitter's own answer, which is the same set it
  // writes `SELECT OPTIONAL` for.
  const restartFiles = restartControlFiles(program);
  const readsFile = program.files.some(
    (file) => file.mode !== "output" && !restartFiles.has(file.name),
  );
  const readsQueue = program.queues.some(
    (queue) => queue.direction === "input",
  );
  //
  // A record a keyed read takes its key from is the exception, and it is
  // checked first: the program asks the file for the record that key names, so
  // nothing fills it and a blank one asks for a record that is not there.
  const keyed = entry ? keyedRecords(entry) : new Set<string>();
  const compared = entry ? comparedLiterals(entry) : new Map<string, string>();
  const entryRecord =
    entry?.parameters.find(
      (parameter) =>
        parameter.type.kind === "record" && keyed.has(parameter.name),
    ) ??
    (readsFile || readsQueue || entry?.isCics
      ? undefined
      : entry?.parameters.find(
          (parameter) => parameter.type.kind === "record",
        ));
  if (entry && entryRecord) {
    const layout = byName.get(recordNameOf(entryRecord.type));
    if (layout) {
      const fields = fieldsOf(layout);
      surfaces.push({
        kind: "entry",
        name: layout.cobolName,
        note: `The record ${entry.name} works on. It sits in WORKING-STORAGE and nothing in the program fills it. On z/OS a caller, a PARM or a dataset does, and here this panel does.`,
        fields,
        records: [seedRecord(fields, 0, layout.recordName, compared)],
      });
    }
  }

  // A PARM is a string on the EXEC card, and the program parses it, with code
  // this compiler generated, from this list. `batchParmFields` is what
  // `emitParmParagraph` writes the length check and the MOVEs from, so a panel
  // built on it writes exactly what the program reads, and one field per
  // parameter is the layout rather than an assumption about it. It also knows
  // where a PARM does not arrive at all: CICS is started by a transaction
  // identifier, and an IMS region enters the program with its PCBs.
  const parmFields = batchParmFields(program);
  if (entry && parmFields.length > 0) {
    const fields = parmFields.map(parmInputField);
    const width = parmFields.reduce((sum, field) => sum + field.width, 0);
    surfaces.push({
      kind: "parm",
      name: "PARM",
      note: `What ${entry.name} is started with. On z/OS this is \`PARM=\` on the EXEC card: ${String(width)} characters, positional, one per parameter. A PARM shorter than that is a job submitted wrong, and the program ends the step with return code 12 rather than run on whatever the region left behind.`,
      fields,
      records: [seedRecord(fields, 0)],
    });
  }

  // The rows Db2 answers a cursor with.
  //
  // The reference `runtime/DSNHLI.cbl` succeeds every call it is given no
  // script for, so a FETCH always returned a row and a cursor loop only ever
  // ended by hitting its own bound: `branch-accrual-cursor` ran to its 5000-row
  // limit and ended the step with return code 12, on a program whose subject is
  // a cursor that ends properly. It also wrote no host variables, so the rows
  // it did deliver were empty and the program accrued nothing on all 5000.
  //
  // A cursor is offered exactly as a dataset is: the fields its `INTO` names,
  // and a row per record. How many records there are is how many rows the
  // cursor returns before end of data.
  for (const cursor of program.sql) {
    if (cursor.form !== "cursor" || !cursor.resultRecordName) {
      continue;
    }
    const layout = byName.get(cursor.resultRecordName);
    if (!layout) {
      continue;
    }
    // In the order the `INTO` names them, which is the order the generated
    // FETCH passes them to DSNHLI, the positions the script is keyed by.
    const fields = fetchedFields(cursor, layout);
    if (fields.length === 0) {
      continue;
    }
    surfaces.push({
      kind: "sql",
      name: cursor.name,
      note: `The rows Db2 answers ${cursor.name} with. Each is one row of its SELECT, written into the fields its INTO names; when they run out the cursor gets end of data, which is how the loop finishes rather than reaching its bound.`,
      fields,
      records: Array.from({ length: SEEDED_ROWS }, (_, index) =>
        seedRecord(fields, index, layout.recordName, compared),
      ),
    });
  }

  for (const file of program.files) {
    if (file.mode !== "input") {
      continue;
    }
    const layout = byName.get(file.record.name);
    if (!layout) {
      continue;
    }
    const fields = fieldsOf(layout);
    surfaces.push({
      kind: "dataset",
      name: toDdName(file.name),
      note: `The dataset ${file.name} reads. Each row is one fixed-length record of ${String(layout.totalLength)} bytes, laid out exactly as the copybook says.`,
      fields,
      records: Array.from({ length: SEEDED_RECORDS }, (_, index) =>
        seedRecord(fields, index, layout.recordName, compared),
      ),
    });
  }

  return {
    surfaces,
    reason: surfaces.length > 0 ? null : reasonFor(program),
  };
}

/**
 * Why a program has no editable input, in its own terms.
 *
 * Four different situations, and telling a reader "there is nothing to fill"
 * without saying which leaves them assuming the browser is the limitation.
 * Every one of these is a fact about the program on z/OS as well.
 *
 * The first branch used to be missing, so a module with no transaction at all
 * was told that "its transaction takes no record" and that "whatever it
 * computes, it computes from constants": two sentences about a program that
 * has no entry point and computes nothing. Wrong in the specific way this
 * panel exists to avoid: confidently, and about the program rather than about
 * the browser.
 */
function reasonFor(program: IRProgram): string {
  const entry =
    program.transactions.find((transaction) => transaction.isEntry) ??
    program.transactions[0];
  if (!entry) {
    return "This module declares records and functions and no transaction, so it has no entry point: there is nothing for a job step to start, and nothing to give it. The COBOL beside it is a module for another program to call.";
  }
  if (entry.isCics) {
    return `${entry.name} is a CICS transaction. Its input is the communication area the caller passes, which a region supplies and this panel does not, so the Run tab executes it against an empty one.`;
  }
  const queue = program.queues.find((each) => each.direction === "input");
  if (queue) {
    return `${entry.name} takes its input off a queue rather than from a dataset or a record: every message is written over ${queue.record.name} by the get before anything reads it. The reference MQ runtime answers with no message, so the drain ends on its first read.`;
  }
  return `${entry.name} reads no dataset, is passed no PARM, and its record parameters are the working storage it keeps while it runs, so there is nothing for a job step to give it.`;
}

/** The record name of a record-typed parameter. */
function recordNameOf(type: { kind: string; name?: string }): string {
  return type.name ?? "";
}

/** The bytes each surface contributes, ready for `runCobol`. */
export function encodeInputs(
  surfaces: readonly InputSurface[],
  layouts: CopybookLayoutDocument,
  program: IRProgram,
): { storage: Map<string, Uint8Array>; files: Map<string, Uint8Array[]> } {
  const byCobolName = new Map(
    layouts.reports.map((report) => [report.cobolName, report]),
  );
  const byFile = new Map(
    program.files.map((file) => [toDdName(file.name), file.record.name]),
  );
  const byRecordName = new Map(
    layouts.reports.map((report) => [report.recordName, report]),
  );

  const storage = new Map<string, Uint8Array>();
  const files = new Map<string, Uint8Array[]>();

  for (const surface of surfaces) {
    if (surface.kind === "entry") {
      const layout = byCobolName.get(surface.name);
      const values = surface.records[0];
      if (layout && values) {
        storage.set(surface.name, buildRecord(layout, values));
      }
      continue;
    }
    if (surface.kind === "dataset") {
      const recordName = byFile.get(surface.name);
      const layout = recordName ? byRecordName.get(recordName) : undefined;
      if (layout) {
        files.set(
          surface.name,
          surface.records.map((values) => buildRecord(layout, values)),
        );
      }
    }
  }

  return { storage, files };
}
