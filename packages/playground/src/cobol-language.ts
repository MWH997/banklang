import { StreamLanguage, type StringStream } from "@codemirror/language";

/**
 * Highlighting for COBOL in fixed reference format.
 *
 * The output pane showed the generated COBOL as undifferentiated grey while the
 * landing page and every rendered documentation page highlighted the same
 * lines. That is backwards: the playground is where a mainframe engineer reads
 * the output closely, and it was the one place giving them the least help.
 *
 * **Column 7 decides.** An asterisk or a slash there makes the whole line a
 * comment, whatever it says. Highlighting the words inside it as code would
 * misrepresent the output on the page where somebody is deciding whether the
 * output is reviewable. The sequence area, columns 1 to 6, is never program
 * text and is dimmed rather than coloured.
 */

/** Reserved words the emitter actually writes. */
const KEYWORDS = new Set([
  "ACCEPT",
  "ACCESS",
  "ADD",
  "ADDRESS",
  "ADVANCING",
  "AFTER",
  "ALL",
  "ALPHABETIC",
  "ALSO",
  "ALTERNATE",
  "AND",
  "ARE",
  "AREA",
  "ASCENDING",
  "ASSIGN",
  "AT",
  "AUTHOR",
  "BEFORE",
  "BINARY",
  "BLANK",
  "BLOCK",
  "BOTTOM",
  "BY",
  "CALL",
  "CANCEL",
  "CBL",
  "CHARACTERS",
  "CLOSE",
  "COMP",
  "COMP-3",
  "COMP-4",
  "COMP-5",
  "COMPUTATIONAL",
  "COMPUTE",
  "CONFIGURATION",
  "CONTAINS",
  "CONTINUE",
  "CONTROLS",
  "COPY",
  "CORRESPONDING",
  "COUNT",
  "DATA",
  "DATE",
  "DECLARATIVES",
  "DELETE",
  "DELIMITED",
  "DEPENDING",
  "DESCENDING",
  "DETAIL",
  "DISPLAY",
  "DIVIDE",
  "DIVISION",
  "DUPLICATES",
  "DYNAMIC",
  "ELSE",
  "END",
  "END-ADD",
  "END-CALL",
  "END-COMPUTE",
  "END-DELETE",
  "END-DIVIDE",
  "END-EVALUATE",
  "END-EXEC",
  "END-IF",
  "END-MULTIPLY",
  "END-OF-PAGE",
  "END-PERFORM",
  "END-READ",
  "END-RETURN",
  "END-REWRITE",
  "END-SEARCH",
  "END-START",
  "END-STRING",
  "END-SUBTRACT",
  "END-UNSTRING",
  "END-WRITE",
  "ENTRY",
  "ENVIRONMENT",
  "EOP",
  "EQUAL",
  "ERROR",
  "EVALUATE",
  "EXEC",
  "EXIT",
  "EXTEND",
  "EXTERNAL",
  "FD",
  "FILE",
  "FILE-CONTROL",
  "FILLER",
  "FINAL",
  "FIRST",
  "FOOTING",
  "FOR",
  "FROM",
  "FUNCTION",
  "GIVING",
  "GLOBAL",
  "GO",
  "GOBACK",
  "GREATER",
  "HEADING",
  "HIGH-VALUE",
  "HIGH-VALUES",
  "I-O",
  "I-O-CONTROL",
  "IDENTIFICATION",
  "IF",
  "IN",
  "INDEXED",
  "INITIAL",
  "INITIALIZE",
  "INPUT",
  "INPUT-OUTPUT",
  "INSPECT",
  "INTO",
  "INVALID",
  "IS",
  "JUST",
  "JUSTIFIED",
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
  "LOCAL-STORAGE",
  "LOW-VALUE",
  "LOW-VALUES",
  "MERGE",
  "MODE",
  "MOVE",
  "MULTIPLY",
  "NATIONAL",
  "NEXT",
  "NO",
  "NOT",
  "NULL",
  "NUMERIC",
  "OBJECT-COMPUTER",
  "OCCURS",
  "OF",
  "OMITTED",
  "ON",
  "OPEN",
  "OPTIONAL",
  "OR",
  "ORGANIZATION",
  "OTHER",
  "OUTPUT",
  "OVERFLOW",
  "PACKED-DECIMAL",
  "PAGE",
  "PERFORM",
  "PIC",
  "PICTURE",
  "POINTER",
  "POSITIONING",
  "PROCEDURE",
  "PROCESS",
  "PROGRAM",
  "PROGRAM-ID",
  "QUOTE",
  "QUOTES",
  "RANDOM",
  "RD",
  "READ",
  "RECORD",
  "RECORDING",
  "RECORDS",
  "RECURSIVE",
  "REDEFINES",
  "REFERENCE",
  "RELATIVE",
  "RELEASE",
  "REMAINDER",
  "RENAMES",
  "REPLACING",
  "REPORT",
  "RETURN",
  "RETURN-CODE",
  "REWRITE",
  "RIGHT",
  "ROUNDED",
  "RUN",
  "SD",
  "SEARCH",
  "SECTION",
  "SELECT",
  "SENTENCE",
  "SEPARATE",
  "SEQUENTIAL",
  "SET",
  "SIZE",
  "SORT",
  "SOURCE-COMPUTER",
  "SPACE",
  "SPACES",
  "SPECIAL-NAMES",
  "STANDARD",
  "START",
  "STATUS",
  "STOP",
  "STRING",
  "SUBTRACT",
  "SUM",
  "SYNC",
  "SYNCHRONIZED",
  "THAN",
  "THEN",
  "THROUGH",
  "THRU",
  "TIMES",
  "TO",
  "TOP",
  "TRAILING",
  "TRUE",
  "TYPE",
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
  "WORKING-STORAGE",
  "WRITE",
  "ZERO",
  "ZEROES",
  "ZEROS",
]);

/**
 * The `EXEC SQL` and `EXEC CICS` blocks the precompiler translates.
 *
 * Coloured apart from ordinary COBOL because they are not ordinary COBOL: they
 * are another language embedded in it, and on z/OS a separate program reads
 * them before the compiler ever does.
 */
const EMBEDDED = new Set(["SQL", "CICS", "DLI"]);

interface CobolState {
  /** Zero-based column of the next character. */
  column: number;
  /** Inside an `EXEC ... END-EXEC` block. */
  embedded: boolean;
}

export const cobol = StreamLanguage.define<CobolState>({
  name: "cobol",

  startState: () => ({ column: 0, embedded: false }),

  token(stream: StringStream, state: CobolState): string | null {
    if (stream.sol()) {
      state.column = 0;
    }

    // Columns 1-6: the sequence number area, which is not program text.
    if (stream.pos < 6) {
      stream.match(/^.{1,6}/);
      return "lineComment";
    }

    // Column 7: the indicator. An asterisk or slash makes the line a comment.
    if (stream.pos === 6) {
      const indicator = stream.next();
      if (indicator === "*" || indicator === "/") {
        stream.skipToEnd();
        return "comment";
      }
      return null;
    }

    if (stream.eatSpace()) {
      return null;
    }

    // An inline comment runs to the end of the line wherever it starts.
    if (stream.match("*>")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match(/^"(?:[^"]|"")*"?/) || stream.match(/^'(?:[^']|'')*'?/)) {
      return "string";
    }

    if (stream.match(/^[+-]?\d+(?:\.\d+)?/)) {
      return "number";
    }

    // A picture string is one token and reads as a type, not as three
    // keywords and a bracket.
    if (stream.match(/^(?:PIC|PICTURE)\b/i)) {
      return "keyword";
    }
    if (stream.match(/^[SVX9AZ*+\-$,.()/]{2,}(?=\s|$)/)) {
      return "typeName";
    }

    if (stream.match(/^[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*/)) {
      const word = stream.current().toUpperCase();
      if (word === "EXEC") {
        state.embedded = true;
        return "meta";
      }
      if (word === "END-EXEC") {
        state.embedded = false;
        return "meta";
      }
      if (state.embedded) {
        return EMBEDDED.has(word) ? "meta" : "propertyName";
      }
      if (KEYWORDS.has(word)) {
        return "keyword";
      }
      // A level number introduces a data description entry.
      if (/^\d\d?$/.test(word)) {
        return "labelName";
      }
      return "variableName";
    }

    if (stream.match(/^[<>=+\-*/():,]/)) {
      return "operator";
    }

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "*>" },
  },
});
