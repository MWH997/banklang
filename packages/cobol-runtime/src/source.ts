/**
 * Reading COBOL source the way a COBOL compiler reads it.
 *
 * Fixed reference format is not a style: columns 1-6 are the sequence number
 * area, column 7 is the indicator, columns 8-72 are the program, and columns
 * 73-80 are ignored. A reader that takes the whole line accepts programs the
 * target compiler would truncate, which is the failure
 * `packages/cobol-backend/src/reference-format.ts` exists to prevent on the way
 * out. This module makes the same rule true on the way back in, so what runs
 * here is what an Enterprise COBOL compiler would see.
 *
 * Two things happen here and nowhere else:
 *
 * - **Column 73 onwards is discarded.** A generated program never puts anything
 *   there, but a hand-edited one might, and silently executing an identification
 *   field is how a divergence between this interpreter and the real compiler
 *   would start.
 * - **Continuation is resolved.** A hyphen in column 7 continues the previous
 *   line's literal with no separator; every other line joins with a space,
 *   because COBOL statements are free to span lines and the generated emitter
 *   wraps them at column 72.
 */

/** A line of program text, with the physical line it came from. */
export interface SourceLine {
  /** Columns 8-72, trailing blanks removed. */
  text: string;
  /** 1-based physical line, for diagnostics that a reader can act on. */
  line: number;
  /** True when column 7 held a hyphen. */
  continuation: boolean;
}

/** The last column an Enterprise COBOL compiler reads. */
const LAST_COLUMN = 72;

/** Column 7, one-based; index 6, zero-based. */
const INDICATOR = 6;

/**
 * Compiler-directing statements, which are not program text.
 *
 * `CBL` and `PROCESS` carry the options the program is compiled under. The
 * emitter writes two `CBL` lines at the top of every program and they say what
 * `ARITH`, `TRUNC` and `NUMPROC` are set to. Those settings matter, and
 * `docs/numeric-model.md` covers them, but they are read by `optionsOf` rather than
 * executed, so they do not belong in the statement stream.
 */
const DIRECTIVE = /^\s{0,6}(CBL|PROCESS)\s/i;

export interface ReadResult {
  lines: SourceLine[];
  /** `ARITH(COMPAT)` and the rest, upper-cased, in the order they were given. */
  directives: string[];
}

/** Splits raw source into the lines a fixed-format compiler would see. */
export function readFixedFormat(source: string): ReadResult {
  const lines: SourceLine[] = [];
  const directives: string[] = [];

  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = index + 1;

    if (DIRECTIVE.test(raw)) {
      directives.push(raw.trim().toUpperCase());
      continue;
    }

    // Short of the indicator column there is nothing but a sequence number.
    if (raw.length <= INDICATOR && raw.trim() === "") {
      continue;
    }

    const indicator = raw[INDICATOR] ?? " ";
    if (indicator === "*" || indicator === "/") {
      continue;
    }

    const text = raw.slice(INDICATOR + 1, LAST_COLUMN).trimEnd();
    if (text.trim() === "") {
      continue;
    }

    lines.push({ text, line, continuation: indicator === "-" });
  }

  return { lines, directives };
}

/* ------------------------------------------------------------------ *
 * Tokens.
 * ------------------------------------------------------------------ */

export type TokenKind =
  "word" | "number" | "string" | "punct" | "period" | "end";

export interface Token {
  kind: TokenKind;
  /** Words arrive upper-cased; COBOL is case-insensitive outside literals. */
  text: string;
  /** For a string token, the literal's characters with quotes removed. */
  value?: string;
  line: number;
  /**
   * One-based source column.
   *
   * Load-bearing, not decoration. COBOL tells a paragraph name from a statement
   * by which area it starts in: columns 8-11 are Area A and a name there begins
   * a paragraph, columns 12-72 are Area B and a word there is part of a
   * statement. Without the column, `DISPLAY-TOTALS.` as a paragraph header and a
   * sentence ending in a name are the same token sequence.
   */
  column: number;
}

/** The last column of Area A. A name starting at or before it is a paragraph. */
export const AREA_A_END = 11;

/**
 * A COBOL word: letters, digits and embedded hyphens.
 *
 * The hyphen is the reason this cannot be a naive split. `WS-ACCOUNT-BAL` is one
 * word and `A - B` is a subtraction, and the only thing that separates them is
 * whether the hyphen has spaces around it. Every generated program spaces its
 * operators, and so does every program in `runtime/`.
 */
const WORD = /^[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*/;

/** `12`, `12.34`, `.5`, where a sign is a separate token. */
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)/;

/** Two-character operators, longest first so `>=` never lexes as `>` then `=`. */
const OPERATORS = [
  ">=",
  "<=",
  "<>",
  "**",
  "(",
  ")",
  ",",
  ";",
  ":",
  "+",
  "-",
  "*",
  "/",
  "=",
  ">",
  "<",
];

/**
 * Turns program lines into tokens.
 *
 * A period is its own kind rather than punctuation because it ends a sentence,
 * and a parser that has to ask "is this token a full stop" at every step reads
 * worse than one that can match on the kind.
 */
export function tokenize(lines: SourceLine[]): Token[] {
  const tokens: Token[] = [];
  let pendingLiteral: {
    quote: string;
    text: string;
    line: number;
    column: number;
  } | null = null;

  for (const source of lines) {
    let rest = source.text;
    /** Column of the first character of `rest`, one-based. */
    const columnOf = (): number => 8 + (source.text.length - rest.length);

    // A literal left open at the end of the previous line resumes here, at the
    // first non-blank character of Area B, with no separator inserted.
    if (pendingLiteral) {
      if (!source.continuation) {
        throw new CobolSyntaxError(
          `Line ${String(source.line)}: a literal was left open on the previous line and this line has no continuation hyphen in column 7.`,
        );
      }
      rest = rest.trimStart();
      // The continuation of a literal re-opens with a quote, and that quote is
      // not part of the value. Reading it as data closed the literal on the
      // spot and turned the rest of the sentence into program text, which is
      // how `"ARITHMETIC OVERFLOW ACCOUNTS-READ OF RUN" "-SUMMARY"` first
      // arrived here as a subtraction.
      if (rest.startsWith(pendingLiteral.quote)) {
        rest = rest.slice(1);
      }
      const closed = closeLiteral(rest, pendingLiteral.quote);
      if (closed === null) {
        pendingLiteral.text += rest;
        continue;
      }
      pendingLiteral.text += closed.value;
      tokens.push({
        kind: "string",
        text: pendingLiteral.quote + pendingLiteral.text + pendingLiteral.quote,
        value: pendingLiteral.text,
        line: pendingLiteral.line,
        column: pendingLiteral.column,
      });
      rest = closed.rest;
      pendingLiteral = null;
    }

    while (rest.length > 0) {
      const trimmed = rest.replace(/^\s+/, "");
      if (trimmed.length === 0) {
        break;
      }
      rest = trimmed;

      // An inline comment runs to the end of the line.
      if (rest.startsWith("*>")) {
        break;
      }

      // A comma or semicolon *followed by a space* is a separator and carries
      // no meaning: `CALL "X" USING A, B` and `USING A B` are the same
      // program. One with no space after it is part of a picture string, where
      // `PIC ZZ,ZZ9.99` needs it kept. That distinction is COBOL's own rule for
      // the separator comma, and it is what lets every list below be parsed by
      // juxtaposition without a special case for punctuation.
      if (
        (rest[0] === "," || rest[0] === ";") &&
        (rest.length === 1 || rest[1] === " ")
      ) {
        rest = rest.slice(1);
        continue;
      }

      const quote = rest[0];
      if (quote === '"' || quote === "'") {
        const closed = closeLiteral(rest.slice(1), quote);
        if (closed === null) {
          pendingLiteral = {
            quote,
            text: rest.slice(1),
            line: source.line,
            column: columnOf(),
          };
          break;
        }
        tokens.push({
          kind: "string",
          text: quote + closed.value + quote,
          value: closed.value,
          line: source.line,
          column: columnOf(),
        });
        rest = closed.rest;
        continue;
      }

      // A period followed by a separator ends a sentence; `1.50` does not.
      if (rest[0] === "." && !/^\.\d/.test(rest)) {
        tokens.push({
          kind: "period",
          text: ".",
          line: source.line,
          column: columnOf(),
        });
        rest = rest.slice(1);
        continue;
      }

      const word = WORD.exec(rest);
      // A bare run of digits is a number, not a word, and `9ABC` cannot occur
      // and `01` as a level number must stay lexable as both, so the number
      // rule is tried first and only wins when the whole match is digits.
      const number = NUMBER.exec(rest);
      if (number && (!word || number[0].length >= word[0].length)) {
        tokens.push({
          kind: "number",
          text: number[0],
          line: source.line,
          column: columnOf(),
        });
        rest = rest.slice(number[0].length);
        continue;
      }
      if (word) {
        tokens.push({
          kind: "word",
          text: word[0].toUpperCase(),
          line: source.line,
          column: columnOf(),
        });
        rest = rest.slice(word[0].length);
        continue;
      }

      const operator = OPERATORS.find((candidate) =>
        rest.startsWith(candidate),
      );
      if (operator) {
        tokens.push({
          kind: "punct",
          text: operator,
          line: source.line,
          column: columnOf(),
        });
        rest = rest.slice(operator.length);
        continue;
      }

      throw new CobolSyntaxError(
        `Line ${String(source.line)}: cannot read ${JSON.stringify(rest.slice(0, 20))}.`,
      );
    }
  }

  if (pendingLiteral) {
    throw new CobolSyntaxError(
      `Line ${String(pendingLiteral.line)}: a literal is never closed.`,
    );
  }

  tokens.push({
    kind: "end",
    text: "",
    line: lines[lines.length - 1]?.line ?? 0,
    column: 0,
  });
  return tokens;
}

/**
 * Finds the end of a literal, honouring the doubled quote that escapes one.
 *
 * `"He said ""no"""` is one literal holding `He said "no"`. Getting this wrong
 * would not be caught by a syntax error; it would end the literal early and
 * carry on lexing the remainder as program text.
 */
function closeLiteral(
  text: string,
  quote: string,
): { value: string; rest: string } | null {
  let value = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char !== quote) {
      value += char;
      index += 1;
      continue;
    }
    if (text[index + 1] === quote) {
      value += quote;
      index += 2;
      continue;
    }
    return { value, rest: text.slice(index + 1) };
  }
  return null;
}

/** A program this interpreter could not read at all. */
export class CobolSyntaxError extends Error {}

/**
 * A construct this interpreter does not implement.
 *
 * Separate from a syntax error on purpose, and never silently ignored. A COBOL
 * interpreter that skips what it does not recognise produces a run that looks
 * like a pass, and a run that looks like a pass is the one failure this project
 * treats as worse than no run at all.
 */
export class CobolUnsupportedError extends Error {}
