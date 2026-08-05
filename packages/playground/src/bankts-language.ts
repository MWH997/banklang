import { StreamLanguage, type StringStream } from "@codemirror/language";

// Mirrors KEYWORDS in packages/parser/src/index.ts. Highlighting that lags the
// lexer is how a supported keyword ends up looking like an undefined name.
export const PLAYGROUND_KEYWORDS = new Set([
  "module",
  "type",
  "record",
  "function",
  "transaction",
  "file",
  "return",
  "let",
  "if",
  "else",
  "while",
  "for",
  "each",
  "in",
  "switch",
  "case",
  "enum",
  "sensitive",
  "redefines",
  "renames",
  "through",
  "split",
  "json",
  "xml",
  "by",
  "search",
  "sort",
  "merge",
  "report",
  "database",
  "queue",
  "connectQueue",
  "putMessage",
  "getMessage",
  "disconnectQueue",
  "getUnique",
  "getNext",
  "getHoldUnique",
  "getHoldNext",
  "insertSegment",
  "replaceSegment",
  "deleteSegment",
  "call",
  "cancel",
  "initiate",
  "generate",
  "terminate",
  "release",
  "descending",
  "checkpoint",
  "restart",
  "every",
  "log",
  "accept",
  "reset",
  "depending",
  "sync",
  "justified",
  "blankWhenZero",
  "sql",
  "cursor",
  "execute",
  "cics",
  "link",
  "syncpoint",
  "rollback",
  "commit",
  "returnCode",
  "readFile",
  "writeFile",
  "rewriteFile",
  "writeQueue",
  "readQueue",
  "returnTransid",
  "extends",
  "entry",
  "raise",
  "on",
  "failure",
  "error",
  "true",
  "false",
]);

export const PLAYGROUND_TYPES = new Set([
  "decimal",
  "string",
  "national",
  "bool",
  "currency",
  "nullable",
  "date",
  "time",
  "timestamp",
  "edited",
  "binary",
  "zoned",
  "native",
]);

/** Ledger and audit operations are contextual in the grammar, not reserved. */
const OPERATIONS = new Set(["debit", "credit", "audit"]);

/** File declaration clause words, also contextual. */
const CLAUSES = new Set(["sequential", "input", "output", "status"]);

/**
 * A small tokenizer for BankTS. It mirrors the real lexer's token classes so
 * the highlighting cannot drift far from what the compiler actually accepts.
 */
export const bankts = StreamLanguage.define({
  name: "bankts",

  token(stream: StringStream): string | null {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) {
      return "string";
    }

    if (stream.match(/^\d+(?:\.\d+)?/)) {
      return "number";
    }

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current();
      if (PLAYGROUND_KEYWORDS.has(word)) {
        return "keyword";
      }
      if (PLAYGROUND_TYPES.has(word)) {
        return "typeName";
      }
      if (OPERATIONS.has(word)) {
        return "macroName";
      }
      if (CLAUSES.has(word)) {
        return "modifier";
      }
      if (/^[A-Z]/.test(word)) {
        return "typeName";
      }
      return "variableName";
    }

    if (stream.match(/^[<>+\-*/=]/)) {
      return "operator";
    }

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//" },
  },
});
