import { StreamLanguage, type StringStream } from "@codemirror/language";

// Mirrors KEYWORDS in packages/parser/src/index.ts. Highlighting that lags the
// lexer is how a supported keyword ends up looking like an undefined name.
const KEYWORDS = new Set([
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
  "sql",
  "execute",
  "cics",
  "link",
  "syncpoint",
  "rollback",
  "extends",
  "entry",
  "raise",
  "on",
  "failure",
  "true",
  "false",
]);

const TYPES = new Set(["decimal", "string", "bool", "currency", "nullable"]);

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
      if (KEYWORDS.has(word)) {
        return "keyword";
      }
      if (TYPES.has(word)) {
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
