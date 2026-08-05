import type { IRRecord, IRType } from "../../ir/src/index";

export function toCobolName(name: string): string {
  return avoidReserved(rawCobolName(name));
}

function rawCobolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export function toCobolProgramId(moduleName: string): string {
  return toCobolName(moduleName);
}

export function toCobolParagraphName(functionName: string): string {
  return toCobolName(functionName);
}

export function toCobolRecordName(record: IRRecord): string {
  return toCobolName(record.name);
}

/**
 * COBOL reserved words, which cannot be used as generated data names.
 *
 * A field called `status`, `value`, or `present` would otherwise emit a data
 * name the compiler rejects, so reserved names get a deterministic `-FLD`
 * suffix.
 *
 * The list is the union of the IBM Enterprise COBOL reserved words and every
 * word GnuCOBOL reserves unconditionally (`cobc --list-reserved`, excluding the
 * context-sensitive entries, which are only reserved in positions the backend
 * never emits a data name into). Both matter: IBM is the target, and GnuCOBOL
 * is what local validation actually runs, so a word missing from either list
 * shows up as a generated program that will not compile.
 */
const RESERVED_WORDS = new Set([
  "ABSENT",
  "ACCEPT",
  "ACCESS",
  "ACTIVE-CLASS",
  "ADD",
  "ADDRESS",
  "ADVANCING",
  "AFTER",
  "ALIGNED",
  "ALL",
  "ALLOCATE",
  "ALPHABET",
  "ALPHABETIC",
  "ALPHABETIC-LOWER",
  "ALPHABETIC-UPPER",
  "ALPHANUMERIC",
  "ALPHANUMERIC-EDITED",
  "ALSO",
  "ALTER",
  "ALTERNATE",
  "AND",
  "ANY",
  "ARE",
  "AREA",
  "AREAS",
  "ARGUMENT-NUMBER",
  "ARGUMENT-VALUE",
  "AS",
  "ASCENDING",
  "ASSIGN",
  "AT",
  "AUTHOR",
  "AUTO-SKIP",
  "AUTOMATIC",
  "AUTOTERMINATE",
  "B-AND",
  "B-NOT",
  "B-OR",
  "B-SHIFT-L",
  "B-SHIFT-LC",
  "B-SHIFT-R",
  "B-SHIFT-RC",
  "B-XOR",
  "BACKGROUND-COLOUR",
  "BACKGROUND-HIGH",
  "BACKGROUND-LOW",
  "BACKGROUND-STANDARD",
  "BASED",
  "BEEP",
  "BEFORE",
  "BINARY",
  "BINARY-C-LONG",
  "BINARY-CHAR",
  "BINARY-DOUBLE",
  "BINARY-INT",
  "BINARY-LONG",
  "BINARY-LONG-LONG",
  "BINARY-SHORT",
  "BIT",
  "BLANK",
  "BLOCK",
  "BOOLEAN",
  "BOTTOM",
  "BY",
  "CALL",
  "CANCEL",
  "CD",
  "CELLS",
  "CF",
  "CH",
  "CHAINING",
  "CHARACTER",
  "CHARACTERS",
  "CLASS",
  "CLOSE",
  "COB-CRT-STATUS",
  "CODE",
  "CODE-SET",
  "COL",
  "COLLATING",
  "COLOR",
  "COLOURS",
  "COLS",
  "COLUMN",
  "COLUMNS",
  "COMMA",
  "COMMAND-LINE",
  "COMMIT",
  "COMMON",
  "COMMUNICATION",
  "COMP",
  "COMP-0",
  "COMP-1",
  "COMP-10",
  "COMP-15",
  "COMP-2",
  "COMP-3",
  "COMP-4",
  "COMP-5",
  "COMP-6",
  "COMP-9",
  "COMP-N",
  "COMP-X",
  "COMPUTATIONAL",
  "COMPUTATIONAL-0",
  "COMPUTATIONAL-1",
  "COMPUTATIONAL-2",
  "COMPUTATIONAL-3",
  "COMPUTATIONAL-4",
  "COMPUTATIONAL-5",
  "COMPUTATIONAL-6",
  "COMPUTATIONAL-N",
  "COMPUTATIONAL-X",
  "COMPUTE",
  "CONDITION",
  "CONFIGURATION",
  "CONSTANT",
  "CONTAINS",
  "CONTENT",
  "CONTINUE",
  "CONTROL",
  "CONTROLS",
  "CONVERTING",
  "COPY",
  "CORR",
  "CORRESPONDING",
  "COUNT",
  "CRT",
  "CRT-UNDER",
  "CURRENCY",
  "CURSOR",
  "DATA",
  "DATA-POINTER",
  "DATE",
  "DAY",
  "DAY-OF-WEEK",
  "DE",
  "DEBUG-ITEM",
  "DEBUGGING",
  "DECIMAL-POINT",
  "DECLARATIVES",
  "DEFAULT",
  "DEFAULT-FONT",
  "DELETE",
  "DELIMITED",
  "DELIMITER",
  "DEPENDING",
  "DESCENDING",
  "DESTINATION",
  "DESTROY",
  "DETAIL",
  "DISABLE",
  "DISPLAY",
  "DISPLAY-1",
  "DIVIDE",
  "DIVISION",
  "DOUBLE",
  "DOWN",
  "DUPLICATES",
  "DYNAMIC",
  "EC",
  "ECHO",
  "EGI",
  "ELSE",
  "EMI",
  "EMPTY-CHECK",
  "ENABLE",
  "END",
  "END-ACCEPT",
  "END-ADD",
  "END-CALL",
  "END-COMPUTE",
  "END-DELETE",
  "END-DISPLAY",
  "END-DIVIDE",
  "END-EVALUATE",
  "END-IF",
  "END-JSON",
  "END-MULTIPLY",
  "END-OF-PAGE",
  "END-PERFORM",
  "END-READ",
  "END-RECEIVE",
  "END-RETURN",
  "END-REWRITE",
  "END-SEARCH",
  "END-SEND",
  "END-START",
  "END-STRING",
  "END-SUBTRACT",
  "END-UNSTRING",
  "END-WRITE",
  "END-XML",
  "ENTRY",
  "ENVIRONMENT",
  "ENVIRONMENT-NAME",
  "ENVIRONMENT-VALUE",
  "EOP",
  "EQUAL",
  "EQUALS",
  "ERROR",
  "ESCAPE",
  "ESI",
  "EVALUATE",
  "EVENT",
  "EXCEPTION",
  "EXCLUSIVE",
  "EXHIBIT",
  "EXIT",
  "EXTEND",
  "EXTERNAL",
  "EXTERNAL-FORM",
  "FACTORY",
  "FALSE",
  "FD",
  "FILE",
  "FILE-CONTROL",
  "FILE-ID",
  "FILLER",
  "FINAL",
  "FIRST",
  "FIXED",
  "FIXED-FONT",
  "FLOAT",
  "FLOAT-DECIMAL-16",
  "FLOAT-DECIMAL-34",
  "FLOAT-EXTENDED",
  "FLOAT-LONG",
  "FLOAT-SHORT",
  "FLOATING",
  "FONT",
  "FOOTING",
  "FOR",
  "FOREGROUND-COLOUR",
  "FORMAT",
  "FREE",
  "FROM",
  "FUNCTION",
  "FUNCTION-ID",
  "FUNCTION-POINTER",
  "GENERATE",
  "GIVING",
  "GLOBAL",
  "GO",
  "GOBACK",
  "GREATER",
  "GROUP",
  "HANDLE",
  "HEADING",
  "HIGH",
  "HIGH-VALUE",
  "HIGH-VALUES",
  "I-O",
  "I-O-CONTROL",
  "ID",
  "IDENTIFICATION",
  "IDENTIFIED",
  "IF",
  "IGNORE",
  "IN",
  "INDEX",
  "INDEXED",
  "INDICATE",
  "INITIAL",
  "INITIALISE",
  "INITIALISED",
  "INITIALIZE",
  "INITIATE",
  "INPUT",
  "INPUT-OUTPUT",
  "INQUIRE",
  "INSPECT",
  "INTO",
  "INVALID",
  "IS",
  "JSON",
  "JSON-CODE",
  "JSON-STATUS",
  "JUST",
  "JUSTIFIED",
  "KEPT",
  "KEY",
  "LABEL",
  "LARGE-FONT",
  "LAST",
  "LAYOUT-MANAGER",
  "LEADING",
  "LEFT",
  "LEFTLINE",
  "LENGTH",
  "LENGTH-CHECK",
  "LESS",
  "LIKE",
  "LIMIT",
  "LIMITS",
  "LINAGE",
  "LINAGE-COUNTER",
  "LINE",
  "LINE-COUNTER",
  "LINES",
  "LINKAGE",
  "LM-RESIZE",
  "LOCAL-STORAGE",
  "LOCALE",
  "LOCK",
  "LOW",
  "LOW-VALUE",
  "LOW-VALUES",
  "MANUAL",
  "MEDIUM-FONT",
  "MEMORY",
  "MENU",
  "MERGE",
  "MESSAGE",
  "MINUS",
  "MODE",
  "MODIFY",
  "MOVE",
  "MULTIPLE",
  "MULTIPLY",
  "NATIONAL",
  "NATIONAL-EDITED",
  "NATIVE",
  "NEGATIVE",
  "NESTED",
  "NEW",
  "NEXT",
  "NO",
  "NO-ECHO",
  "NOT",
  "NOTHING",
  "NULL",
  "NULLS",
  "NUMBER",
  "NUMBER-OF-CALL-PARAMETERS",
  "NUMBERS",
  "NUMERIC",
  "NUMERIC-EDITED",
  "OBJECT",
  "OBJECT-COMPUTER",
  "OCCURS",
  "OF",
  "OFF",
  "OMITTED",
  "ON",
  "ONLY",
  "OPEN",
  "OPTIONAL",
  "OPTIONS",
  "OR",
  "ORDER",
  "ORGANISATION",
  "ORGANIZATION",
  "OTHER",
  "OUTPUT",
  "OVERFLOW",
  "OVERLINE",
  "PACKED-DECIMAL",
  "PADDING",
  "PAGE",
  "PAGE-COUNTER",
  "PERFORM",
  "PF",
  "PH",
  "PHYSICAL",
  "PIC",
  "PICTURE",
  "PIXELS",
  "PLUS",
  "POINTER",
  "POSITION",
  "POSITIVE",
  "PRESENT",
  "PRINTING",
  "PRIORITY",
  "PROCEDURE",
  "PROCEDURE-POINTER",
  "PROCEDURES",
  "PROCEED",
  "PROGRAM",
  "PROGRAM-ID",
  "PROGRAM-POINTER",
  "PROMPT",
  "PROPERTY",
  "PROTOTYPE",
  "PURGE",
  "QUEUE",
  "QUOTE",
  "QUOTES",
  "RAISE",
  "RAISING",
  "RANDOM",
  "RD",
  "READ",
  "RECEIVE",
  "RECEIVED",
  "RECORD",
  "RECORDING",
  "RECORDS",
  "REDEFINES",
  "REEL",
  "REFERENCE",
  "REFERENCES",
  "RELATIVE",
  "RELEASE",
  "REMAINDER",
  "REMOVAL",
  "RENAMES",
  "REPEATED",
  "REPLACE",
  "REPLACING",
  "REPORT",
  "REPORTING",
  "REPORTS",
  "REPOSITORY",
  "RERUN",
  "RESERVE",
  "RESET",
  "RETRY",
  "RETURN",
  "RETURN-CODE",
  "RETURNING",
  "REVERSE",
  "REVERSED",
  "REWIND",
  "REWRITE",
  "RF",
  "RH",
  "RIGHT",
  "RIGHTLINE",
  "ROLLBACK",
  "ROUNDED",
  "RUN",
  "SAME",
  "SCREEN",
  "SD",
  "SEARCH",
  "SECTION",
  "SECURITY",
  "SEGMENT",
  "SEGMENT-LIMIT",
  "SELECT",
  "SEND",
  "SENTENCE",
  "SEPARATE",
  "SEQUENCE",
  "SEQUENTIAL",
  "SET",
  "SHARING",
  "SIGN",
  "SIGNED",
  "SIGNED-INT",
  "SIGNED-LONG",
  "SIGNED-SHORT",
  "SIZE",
  "SMALL-FONT",
  "SORT",
  "SORT-MERGE",
  "SORT-RETURN",
  "SOURCE",
  "SOURCE-COMPUTER",
  "SPACE",
  "SPACES",
  "SPECIAL",
  "SPECIAL-NAMES",
  "STANDARD",
  "STANDARD-1",
  "STANDARD-2",
  "START",
  "STATUS",
  "STOP",
  "STRING",
  "SUB-QUEUE-1",
  "SUB-QUEUE-2",
  "SUB-QUEUE-3",
  "SUBTRACT",
  "SUBWINDOW",
  "SUM",
  "SUPPRESS",
  "SYMBOLIC",
  "SYNC",
  "SYNCHRONISED",
  "SYNCHRONIZED",
  "SYSTEM-DEFAULT",
  "SYSTEM-OFFSET",
  "TABLE",
  "TALLY",
  "TALLYING",
  "TAPE",
  "TERMINATE",
  "TEST",
  "TEXT",
  "THAN",
  "THEN",
  "THREAD",
  "THREADS",
  "THROUGH",
  "THRU",
  "TIME",
  "TIMEOUT",
  "TIMES",
  "TO",
  "TOP",
  "TRADITIONAL-FONT",
  "TRAILING",
  "TRANSFORM",
  "TRUE",
  "TYPE",
  "TYPEDEF",
  "UNIT",
  "UNLOCK",
  "UNSIGNED",
  "UNSIGNED-INT",
  "UNSIGNED-LONG",
  "UNSIGNED-SHORT",
  "UNSTRING",
  "UNTIL",
  "UP",
  "UPDATE",
  "UPON",
  "USAGE",
  "USE",
  "USER-DEFAULT",
  "USING",
  "VAL-STATUS",
  "VALID",
  "VALIDATE",
  "VALIDATE-STATUS",
  "VALUE",
  "VALUES",
  "VARIANT",
  "VARYING",
  "VOLATILE",
  "WAIT",
  "WHEN",
  "WHEN-COMPILED",
  "WINDOW",
  "WITH",
  "WORDS",
  "WORKING",
  "WORKING-STORAGE",
  "WRITE",
  "XML",
  "XML-CODE",
  "XML-EVENT",
  "XML-INFORMATION",
  "XML-NAMESPACE",
  "XML-NAMESPACE-PREFIX",
  "XML-NNAMESPACE",
  "XML-NNAMESPACE-PREFIX",
  "XML-NTEXT",
  "XML-TEXT",
  "ZERO",
  "ZEROES",
  "ZEROS",
]);

/**
 * True when a generated COBOL data name would collide with a reserved word.
 * Exported so tests can assert the mangling rule directly.
 */
export function isReservedCobolWord(name: string): boolean {
  return RESERVED_WORDS.has(name.toUpperCase());
}

function avoidReserved(name: string): string {
  return isReservedCobolWord(name) ? `${name}-FLD` : name;
}

export function toCobolFieldName(fieldName: string): string {
  return toCobolName(fieldName);
}

/** Width of the widest enum member, which is the PIC X(n) size. */
export function enumWidth(members: string[]): number {
  return members.reduce((widest, member) => Math.max(widest, member.length), 1);
}

/**
 * Storage for a date, a time, or a timestamp.
 *
 * `PIC 9(8)` holding YYYYMMDD is the mainframe convention, and it is chosen for
 * a reason that matters: in that layout the ordinary numeric comparison is also
 * the chronological one, and an ordinary sort is a chronological sort. A
 * timestamp is `PIC X(26)`, which is the Db2 host variable format, so it can be
 * read from and written to a TIMESTAMP column without conversion.
 */
export function temporalPicture(unit: "date" | "time" | "timestamp"): string {
  switch (unit) {
    case "date":
      return "PIC 9(8)";
    case "time":
      return "PIC 9(6)";
    case "timestamp":
      return "PIC X(26)";
  }
}

export function temporalLength(unit: "date" | "time" | "timestamp"): number {
  switch (unit) {
    case "date":
      return 8;
    case "time":
      return 6;
    case "timestamp":
      return 26;
  }
}

/** The edit styles a field may ask for, and what each one means. */
export type EditStyle =
  "plain" | "grouped" | "signed" | "credit" | "protected" | "slashed";

export const EDIT_STYLES: readonly EditStyle[] = [
  "plain",
  "grouped",
  "signed",
  "credit",
  "protected",
  "slashed",
];

/**
 * A numeric-edited picture, built from the value's own precision and scale.
 *
 * The leading digit positions suppress — `Z` blanks them, `*` fills them, which
 * is cheque protection — and the last integer position stays `9` so a zero
 * amount prints as `0.00` rather than as nothing. Decimals never suppress: an
 * amount is read to the penny, and a blank penny column is a defect.
 *
 * The sign goes at the end, because that is where a banker reads it, and `CR`
 * rather than a minus is the accounting convention for a credit balance.
 */
export function editedPicture(
  style: EditStyle,
  precision: number,
  scale: number,
  /**
   * The program's decimal point convention.
   *
   * `DECIMAL-POINT IS COMMA` swaps the roles of the comma and the point
   * *inside pictures too*, so a grouped amount is written `Z.ZZZ.ZZ9,99`. A
   * picture built the other way round is not merely printed oddly — the COBOL
   * compiler rejects it, because the separator would then appear more than
   * once.
   */
  decimalPoint: "point" | "comma" = "point",
): string {
  if (style === "slashed") {
    return "PIC 9999/99/99";
  }

  const groupSeparator = decimalPoint === "comma" ? "." : ",";
  const pointCharacter = decimalPoint === "comma" ? "," : ".";

  const integerDigits = Math.max(precision - scale, 1);
  const suppression = style === "protected" ? "*" : "Z";
  const grouped = style !== "plain";

  let body = "";
  for (let index = 0; index < integerDigits; index += 1) {
    // Built right to left, so the rightmost integer position is the 9 that
    // keeps a zero visible and the separators land every third digit.
    body = (index === 0 ? "9" : suppression) + body;
    if (grouped && index % 3 === 2 && index < integerDigits - 1) {
      body = `${groupSeparator}${body}`;
    }
  }

  const decimals = scale > 0 ? `${pointCharacter}${"9".repeat(scale)}` : "";
  const sign = style === "signed" ? "-" : style === "credit" ? "CR" : "";

  return `PIC ${body}${decimals}${sign}`;
}

/** Character positions an edited picture occupies. */
export function editedLength(
  style: EditStyle,
  precision: number,
  scale: number,
): number {
  // Length does not depend on the convention: swapping the separators changes
  // which character sits where, not how many there are.
  const picture = editedPicture(style, precision, scale).slice("PIC ".length);
  // Every character in an edited picture is one position, except the repeat
  // notation this builder never emits.
  return picture.length;
}

export function toCobolPicture(type: IRType): string {
  switch (type.kind) {
    case "edited":
      return editedPicture(type.style, type.precision, type.scale);
    case "temporal":
      return temporalPicture(type.unit);
    case "decimal":
      return decimalPicture(type.precision, type.scale, type.usage);
    case "currency":
      // Currency is a compile-time distinction; the storage is packed decimal.
      return decimalPicture(type.precision, type.scale);
    case "enum":
      return `PIC X(${enumWidth(type.members)})`;
    case "nullable":
      return toCobolPicture(type.inner);
    case "array":
      return toCobolPicture(type.element);
    case "string":
      return type.national
        ? `PIC N(${type.length}) USAGE NATIONAL`
        : `PIC X(${type.length})`;
    case "bool":
      return `PIC X VALUE 'N'`;
    case "record":
      return "GROUP";
  }
}

/**
 * How a number is held in storage.
 *
 * A value's precision and scale say what it means; its usage says how the bytes
 * are arranged. Money is `packed` because COMP-3 is what a ledger is stored in.
 * A counter or a subscript is `binary`, which is a halfword or fullword the
 * hardware adds to directly. `display` is zoned decimal, one byte per digit,
 * which is what a great deal of legacy input arrives as — and the reason this
 * distinction exists at all is that a compiler that only knows COMP-3 cannot
 * read an existing estate's copybooks.
 */
export type NumericUsage = "packed" | "binary" | "display" | "native";

export function decimalPicture(
  precision: number,
  scale: number,
  usage: NumericUsage = "packed",
): string {
  const integerDigits = precision - scale;
  const digits =
    scale === 0
      ? `S9(${integerDigits})`
      : `S9(${integerDigits})V${"9".repeat(scale)}`;

  switch (usage) {
    case "packed":
      return `PIC ${digits} COMP-3`;
    case "binary":
      return `PIC ${digits} COMP`;
    case "native":
      // COMP-5 holds the full range the storage can express rather than
      // truncating to the picture's decimal digits, which is what an interface
      // to something outside COBOL needs.
      return `PIC ${digits} COMP-5`;
    case "display":
      // Zoned decimal keeps the sign as an overpunch on the last digit unless
      // told otherwise. SIGN IS TRAILING SEPARATE spends one more byte and
      // makes the field readable as plain text, which is what a file a person
      // or another system reads needs.
      return `PIC ${digits} SIGN IS TRAILING SEPARATE`;
  }
}

export function packedDecimalByteLength(precision: number): number {
  return Math.ceil((precision + 1) / 2);
}

/**
 * Bytes a number occupies, by usage.
 *
 * Binary rounds up to the halfword, fullword, or doubleword that holds the
 * declared number of digits, which is how IBM Enterprise COBOL allocates
 * `COMP`. Zoned decimal is one byte per digit plus the separate sign.
 */
/**
 * The boundary a `SYNCHRONIZED` item starts on.
 *
 * Binary items align to their own width; everything else is byte-aligned and
 * needs no slack. Getting this wrong is how a copybook read against a real
 * dataset lands every later field at the wrong offset.
 */
export function alignmentOf(type: IRType): number {
  if (
    type.kind === "decimal" &&
    (type.usage === "binary" || type.usage === "native")
  ) {
    return type.precision <= 4 ? 2 : type.precision <= 9 ? 4 : 8;
  }
  return 1;
}

/** Slack bytes inserted before an aligned item at the given offset. */
export function slackBefore(offset: number, alignment: number): number {
  const remainder = offset % alignment;
  return remainder === 0 ? 0 : alignment - remainder;
}

export function numericByteLength(
  precision: number,
  usage: NumericUsage,
): number {
  switch (usage) {
    case "packed":
      return packedDecimalByteLength(precision);
    case "binary":
    case "native":
      return precision <= 4 ? 2 : precision <= 9 ? 4 : 8;
    case "display":
      return precision + 1;
  }
}
