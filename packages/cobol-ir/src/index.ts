import type { IRType } from "../../ir/src/index";

/**
 * The longest user-defined word IBM Enterprise COBOL accepts.
 *
 * The Language Reference defines a user-defined word as "a character string of
 * not more than 30 characters that forms a user-defined word", and the compiler
 * enforces it. GnuCOBOL's default dialect does not, which is how
 * `IS-ELIGIBLE-FOR-INTEREST-RESULT` — 31 characters — reached a shipped example
 * and a checked-in golden fixture with every local gate green.
 */
export const MAX_COBOL_WORD_LENGTH = 30;

export function toCobolName(name: string): string {
  return fitCobolWord(avoidReserved(rawCobolName(name)));
}

/**
 * Shortens a COBOL word to the 30 characters the target allows.
 *
 * The rule is the one a COBOL programmer uses by hand: abbreviate the longest
 * word to its first four characters, and keep going until the name fits. That
 * turns `IS-ELIGIBLE-FOR-INTEREST-RESULT` into `IS-ELIG-FOR-INTEREST-RESULT`
 * rather than into a truncation that loses the part carrying the meaning
 * (`...-INTEREST-RESUL`) or a hash suffix that reads as machine output.
 *
 * Deterministic and stateless, so the same source name always produces the same
 * COBOL word regardless of what else the program contains or what order things
 * were emitted in. Being stateless is also why this cannot notice that the word
 * it just produced is one another name already reached: two distinct source
 * names that abbreviate alike are a real defect rather than something to paper
 * over, and `checkCobolNameCollisions` in the backend reports them as
 * `BANK-NAME-001`.
 */
export function fitCobolWord(
  word: string,
  limit = MAX_COBOL_WORD_LENGTH,
): string {
  if (word.length <= limit) {
    return word;
  }

  // Four characters is the shortest abbreviation that still reads as the word
  // it came from: ACCT, INTR, ELIG. Below that the name stops being a name.
  const floor = 4;
  const segments = word.split("-");

  // One segment is not an abbreviation problem, it is a length problem.
  //
  // The loop below shortens the longest segment to `floor` and goes round
  // again, which is the right rule when there are several words to trade off.
  // With one word there is nothing to trade: it was cut to four characters and
  // the other twenty-six were thrown away. `settlementreconciliationthreshold`
  // — a legal BankTS identifier, no camel humps for `rawCobolName` to split on
  // — became `SETT`, and any other name sharing those four letters collided
  // with it. Found by mutation testing: nothing exercised this branch.
  if (segments.length === 1) {
    return word.slice(0, limit);
  }
  while (segments.join("-").length > limit) {
    let longest = -1;
    for (let index = 0; index < segments.length; index += 1) {
      if (
        segments[index]!.length > floor &&
        (longest === -1 || segments[index]!.length > segments[longest]!.length)
      ) {
        longest = index;
      }
    }
    if (longest === -1) {
      // Every segment is already at the floor. Cutting the tail would take the
      // suffix off, and the suffix is what tells a routine from its parameter
      // cell, its result field and its exit paragraph — so a long enough
      // function name gave all four the same 30-character word, and the
      // program declared it twice and performed the wrong one. Segments come
      // out of the middle instead, where a long name carries least, and the
      // first and the last are kept.
      while (segments.length > 2 && segments.join("-").length > limit) {
        segments.splice(Math.floor(segments.length / 2), 1);
      }
      return segments.join("-").slice(0, limit).replace(/-+$/, "");
    }
    segments[longest] = segments[longest]!.slice(0, floor);
  }

  return segments.join("-");
}

function rawCobolName(name: string): string {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      // A digit starts a word of its own. `WS-TIER-1-RATE` is how the name is
      // written on an estate, and it is what a copybook holds — so without this
      // `CM-ADDR-LINE-1` imports as `cmAddrLine1` and comes back out as
      // `CM-ADDR-LINE1`, a different name for the same field. The importer's
      // round-trip check is what found it.
      .replace(/([A-Za-z])(\d)/g, "$1-$2")
      .replace(/[_\s]+/g, "-")
      .replace(/[^A-Za-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toUpperCase()
  );
}

/**
 * The program-name, which is also the load module's member name.
 *
 * Eight characters and no hyphens, because that is what the name becomes
 * whatever is written here. Under the default `PGMNAME(COMPAT)` the Programming
 * Guide says an external program-name is "folded to uppercase ... truncated to
 * eight characters ... hyphens are translated to zero (0)". So
 * `PROGRAM-ID. ONLINE-ENQUIRY.` defines the entry point `ONLINE0E`, a name
 * nothing else in the build ever writes: the job's `GOPGM=` said `ONLINEEN`,
 * the `EXEC PGM=` said the same, and neither is what the compiler produced.
 *
 * The truncation is also where two modules become one. `ACCOUNT-TRANSFER-IN`
 * and `ACCOUNT-TRANSFER-OUT` are one external name, so a library holding both
 * resolves every call to whichever was bound last — which is why
 * `BANK-JOB-005` refuses a job whose steps build two programs agreeing over
 * those eight characters. A program compiled on its own has nothing to collide
 * with, so a job is the only place the clash is visible.
 *
 * One rule, used by whatever writes the PROGRAM-ID, whatever writes the member
 * name, and whatever writes the `EXEC PGM=` that runs it.
 */
export function toCobolProgramId(moduleName: string): string {
  return toCobolName(moduleName).replace(/-/g, "").slice(0, 8);
}

export function toCobolParagraphName(functionName: string): string {
  return toCobolName(functionName);
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

/**
 * The PDS member name a record's copybook is held under.
 *
 * A member name is one to eight characters of letters, digits, and the national
 * characters — no hyphens — and that is also all the compiler looks at: "when
 * the compiler searches for COPY members in PDS or PDSE datasets ... only the
 * first eight characters of text-name are used as the identifying name". So
 * `COPY ACCOUNT-RECORD` on a PDS looks for a member called `ACCOUNT-`, which no
 * library can hold, while the copybook itself shipped as `ACCOUNTR`. The two
 * were derived by different rules and never met.
 *
 * One rule, used by whatever writes the member and by whatever writes the COPY
 * that reads it.
 */
export function copybookMemberName(recordName: string): string {
  return toCobolName(recordName).replace(/-/g, "").slice(0, 8);
}

export function toCobolFieldName(fieldName: string): string {
  // A `reserved <n>;` slot carries a generated name so the field list stays a
  // list of named things, and it is spelled with a `#` so nothing a programmer
  // writes can collide with it. What it becomes is `FILLER`, which is not a
  // name at all: it is the word COBOL uses for space nothing refers to, and it
  // may repeat within a record.
  if (isReservedSlotName(fieldName)) {
    return "FILLER";
  }
  return toCobolName(fieldName);
}

/** True for the generated name of a `reserved <n>;` slot. */
export function isReservedSlotName(fieldName: string): boolean {
  return fieldName.startsWith("reserved#");
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
      return 'PIC X VALUE "N"';
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
/**
 * How a number is stored.
 *
 * `packed` is COMP-3 and is what a bank's arithmetic runs on. `binary` is COMP,
 * `native` is COMP-5, and the two display forms are the ones a copybook is full
 * of: `display` carries a separate trailing sign, which spends a byte and makes
 * the field readable as text, and `unsigned` carries none at all, which is what
 * `PIC 9(n)` is and what most dates, counts and codes on an estate are declared
 * as. A record imported from a copybook needs both, and a field imported at the
 * wrong length moves every field after it.
 */
export type NumericUsage =
  "packed" | "binary" | "display" | "unsigned" | "native";

export function decimalPicture(
  precision: number,
  scale: number,
  usage: NumericUsage = "packed",
): string {
  const integerDigits = precision - scale;
  const sign = usage === "unsigned" ? "" : "S";
  // `decimal<2, 2>` has no integer digits, and `9(0)` is not a picture: the
  // compiler answers "number or constant in parentheses must be greater than
  // zero". `SV99` is what a value entirely below the decimal point is written
  // as — a rate, a fraction — and it was unreachable from any hand-written
  // fixture, because every one of them had at least one integer digit.
  const wholePart = integerDigits > 0 ? `9(${integerDigits})` : "";
  const digits =
    scale === 0
      ? `${sign}${wholePart}`
      : `${sign}${wholePart}V${"9".repeat(scale)}`;

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
    case "unsigned":
      // No sign at all, which is what `PIC 9(n)` is: one byte per digit and
      // nothing spent on a sign the field cannot hold.
      return `PIC ${digits}`;
  }
}

export function packedDecimalByteLength(precision: number): number {
  return Math.ceil((precision + 1) / 2);
}

/** Digits a numeric item may carry under `ARITH(COMPAT)`, which is the default. */
export const MAX_COMPAT_DIGITS = 18;

/**
 * The field `DIVIDE a BY b GIVING q REMAINDER r` needs for `r`.
 *
 * The Language Reference defines the remainder as "the result of subtracting the
 * product of the quotient and the divisor from the dividend", so its scale is
 * whichever of the dividend's own scale and the quotient's-times-the-divisor's
 * is larger.
 *
 * Its magnitude is bounded: the quotient is truncated at the receiver's scale,
 * so what is left over is below one unit in that last place times the divisor —
 * `|r| < |b| * 10^-s`. That is the receiver's scale fewer integer digits than
 * the divisor itself needs, which is what makes the field fit at all for two
 * eighteen-digit money values.
 *
 * A rounding mode Enterprise COBOL does not have is generated from this
 * remainder, so a remainder that does not fit is not a detail: it is the
 * difference between a proved tie test and a truncated one. `BANK-DEC-006`
 * refuses that program rather than emitting it.
 */
export function divisionRemainderShape(
  dividend: { precision: number; scale: number },
  divisor: { precision: number; scale: number },
  receiverScale: number,
): { integer: number; scale: number } {
  return {
    integer: Math.max(divisor.precision - divisor.scale - receiverScale, 1),
    scale: Math.max(dividend.scale, receiverScale + divisor.scale),
  };
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
 * Not the item's own width. IBM's slack-byte algorithm divides by 2 for a
 * binary item of four digits or fewer and by 4 for one of **five digits or
 * more** — there is no eight for binary, which is reserved for
 * `COMPUTATIONAL-2`. So a doubleword binary occupies eight bytes and still
 * aligns on a fullword.
 *
 * Aligning it to eight inserts slack Enterprise COBOL does not, and every field
 * after it in the record then sits four bytes further along than the dataset
 * has it. Everything non-binary is byte-aligned and needs no slack.
 */
export function alignmentOf(type: IRType): number {
  if (
    type.kind === "decimal" &&
    (type.usage === "binary" || type.usage === "native")
  ) {
    return type.precision <= 4 ? 2 : 4;
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
    case "unsigned":
      return precision;
  }
}
