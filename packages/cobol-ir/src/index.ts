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
 * COBOL reserved words that are plausible BankTS field names.
 *
 * A field called `status` or `lines` would otherwise emit a data name the
 * compiler rejects, so reserved names get a deterministic suffix. The list
 * covers the words a banking record realistically collides with rather than
 * the full IBM reserved list.
 */
const RESERVED_WORDS = new Set([
  "ACCEPT",
  "ACCESS",
  "ADD",
  "ADDRESS",
  "ALL",
  "ALPHABET",
  "ALSO",
  "ALTER",
  "AND",
  "ANY",
  "AREA",
  "ASCENDING",
  "ASSIGN",
  "AT",
  "AUTHOR",
  "BEFORE",
  "BLOCK",
  "BOTTOM",
  "BY",
  "CALL",
  "CANCEL",
  "CHARACTER",
  "CLASS",
  "CLOSE",
  "CODE",
  "COLUMN",
  "COMMA",
  "COMMON",
  "COMP",
  "COMPUTE",
  "CONTENT",
  "CONTINUE",
  "CONTROL",
  "COPY",
  "COUNT",
  "CURRENCY",
  "DATA",
  "DATE",
  "DAY",
  "DELETE",
  "DELIMITER",
  "DEPENDING",
  "DESCENDING",
  "DISPLAY",
  "DIVIDE",
  "DIVISION",
  "DOWN",
  "DUPLICATES",
  "END",
  "ENTRY",
  "ENVIRONMENT",
  "EQUAL",
  "ERROR",
  "EVALUATE",
  "EXIT",
  "EXTEND",
  "EXTERNAL",
  "FALSE",
  "FILE",
  "FILLER",
  "FIRST",
  "FOOTING",
  "FOR",
  "FROM",
  "FUNCTION",
  "GENERATE",
  "GIVING",
  "GLOBAL",
  "GO",
  "GOBACK",
  "GREATER",
  "GROUP",
  "HIGH",
  "ID",
  "IDENTIFICATION",
  "IF",
  "IN",
  "INDEX",
  "INDEXED",
  "INITIAL",
  "INITIALIZE",
  "INPUT",
  "INSPECT",
  "INTO",
  "INVALID",
  "IS",
  "JUST",
  "KEY",
  "LABEL",
  "LAST",
  "LEADING",
  "LEFT",
  "LENGTH",
  "LESS",
  "LIMIT",
  "LINAGE",
  "LINE",
  "LINES",
  "LINKAGE",
  "LOCK",
  "LOW",
  "MEMORY",
  "MERGE",
  "MESSAGE",
  "MODE",
  "MOVE",
  "MULTIPLY",
  "NATIVE",
  "NEGATIVE",
  "NEXT",
  "NO",
  "NOT",
  "NULL",
  "NUMBER",
  "NUMERIC",
  "OBJECT",
  "OCCURS",
  "OF",
  "OFF",
  "OMITTED",
  "ON",
  "OPEN",
  "OPTIONAL",
  "OR",
  "ORDER",
  "ORGANIZATION",
  "OTHER",
  "OUTPUT",
  "OVERFLOW",
  "PAGE",
  "PERFORM",
  "PIC",
  "PICTURE",
  "POINTER",
  "POSITION",
  "POSITIVE",
  "PROCEDURE",
  "PROGRAM",
  "QUOTE",
  "RANDOM",
  "READ",
  "RECORD",
  "REDEFINES",
  "REEL",
  "REFERENCE",
  "RELATIVE",
  "RELEASE",
  "REMAINDER",
  "REMOVAL",
  "RENAMES",
  "REPLACE",
  "REPORT",
  "RERUN",
  "RESERVE",
  "RESET",
  "RETURN",
  "REVERSED",
  "REWIND",
  "REWRITE",
  "RIGHT",
  "ROUNDED",
  "RUN",
  "SAME",
  "SEARCH",
  "SECTION",
  "SECURITY",
  "SELECT",
  "SENTENCE",
  "SEPARATE",
  "SEQUENCE",
  "SEQUENTIAL",
  "SET",
  "SIGN",
  "SIZE",
  "SORT",
  "SOURCE",
  "SPACE",
  "SPECIAL",
  "STANDARD",
  "START",
  "STATUS",
  "STOP",
  "STRING",
  "SUBTRACT",
  "SUM",
  "SUPPRESS",
  "SYMBOLIC",
  "SYNC",
  "TABLE",
  "TALLYING",
  "TAPE",
  "TERMINATE",
  "TEST",
  "THAN",
  "THEN",
  "THROUGH",
  "THRU",
  "TIME",
  "TIMES",
  "TO",
  "TOP",
  "TRAILING",
  "TRUE",
  "TYPE",
  "UNIT",
  "UNSTRING",
  "UNTIL",
  "UP",
  "UPON",
  "USAGE",
  "USE",
  "USING",
  "VALUE",
  "VALUES",
  "VARYING",
  "WHEN",
  "WITH",
  "WORDS",
  "WORKING",
  "WRITE",
  "ZERO",
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

export function toCobolPicture(type: IRType): string {
  switch (type.kind) {
    case "decimal":
      return decimalPicture(type.precision, type.scale);
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
      return `PIC X(${type.length})`;
    case "bool":
      return `PIC X VALUE 'N'`;
    case "record":
      return "GROUP";
  }
}

export function decimalPicture(precision: number, scale: number): string {
  const integerDigits = precision - scale;
  if (scale === 0) {
    return `PIC S9(${integerDigits}) COMP-3`;
  }

  return `PIC S9(${integerDigits})V${"9".repeat(scale)} COMP-3`;
}

export function packedDecimalByteLength(precision: number): number {
  return Math.ceil((precision + 1) / 2);
}
