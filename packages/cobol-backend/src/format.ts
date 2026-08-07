/**
 * Formatting COBOL.
 *
 * The compiler already emits canonical COBOL, so this exists for the other
 * direction: a program somebody pasted, edited by hand, or lifted out of a
 * listing. `bankc fmt` reads it, works out what each line is, and writes it back
 * in the shape `docs/generated-code-standards.md` describes.
 *
 * Three rules, and they are the ones a mainframe engineer would apply:
 *
 * - **Area A and Area B are structural.** A division header, a section header,
 *   a paragraph name, an `FD` and a level 01 start in column 8. Everything else
 *   starts in column 12. Putting a paragraph name in Area B does not make it a
 *   paragraph, so this is not decoration — a misplaced name is a compile error
 *   on the target and a silently different program under a compiler that
 *   guesses.
 * - **Nesting is four spaces.** `IF`/`END-IF`, `EVALUATE`/`WHEN`,
 *   `PERFORM`/`END-PERFORM`, `READ`/`END-READ` and the rest indent their bodies,
 *   which is what makes a generated program readable at all.
 * - **Nothing runs past column 72.** The margin is enforced by
 *   `toReferenceFormat`, which continues a line rather than losing its tail.
 *
 * What it does *not* do is change a program. Comments keep their text and their
 * place, literals are never re-wrapped across a boundary that would alter them,
 * and no word is added or removed.
 *
 * **It does not reproduce this emitter's line breaks, and is not meant to.**
 * The emitter puts some clauses on lines of their own where they would have
 * fitted — a `SELECT` and its `ORGANIZATION`, an `ON SIZE ERROR` and its body —
 * because that is how a person reads them. Recovering which of those was a
 * choice and which was a wrap at column 72 is not possible from the text, so
 * formatting generated COBOL produces a program that is correctly formatted and
 * not byte-identical to what came out.
 *
 * That is why `tests/cobol-format.test.ts` checks the property that matters
 * instead: over the whole example corpus, a formatted program is executed and
 * has to produce the same output, the same ledger and the same return code as
 * the program it was formatted from. Byte-identity to one emitter is a
 * coincidence of layout; "runs the same" is the thing a formatter must never
 * break.
 */

import { toReferenceFormat } from "./reference-format";

/** Column 8, where Area A begins. */
const AREA_A = 7;

/** Column 12, where Area B begins. */
const AREA_B = 11;

/** One level of nesting. */
const STEP = 4;

/** Words that open a block and indent what follows. */
const OPENERS = new Set([
  "IF",
  "EVALUATE",
  "PERFORM",
  "READ",
  "WRITE",
  "REWRITE",
  "DELETE",
  "START",
  "COMPUTE",
  "ADD",
  "SUBTRACT",
  "MULTIPLY",
  "DIVIDE",
  "CALL",
  "STRING",
  "UNSTRING",
  "SEARCH",
  "RETURN",
]);

/** Explicit scope terminators, which close what the matching opener opened. */
const CLOSERS = new Set([
  "END-IF",
  "END-EVALUATE",
  "END-PERFORM",
  "END-READ",
  "END-WRITE",
  "END-REWRITE",
  "END-DELETE",
  "END-START",
  "END-COMPUTE",
  "END-ADD",
  "END-SUBTRACT",
  "END-MULTIPLY",
  "END-DIVIDE",
  "END-CALL",
  "END-STRING",
  "END-UNSTRING",
  "END-SEARCH",
  "END-RETURN",
]);

/** Words that begin a line in Area A. */
const AREA_A_WORDS = new Set([
  "IDENTIFICATION",
  "ENVIRONMENT",
  "DATA",
  "PROCEDURE",
  "CONFIGURATION",
  "INPUT-OUTPUT",
  "FILE",
  "WORKING-STORAGE",
  "LOCAL-STORAGE",
  "LINKAGE",
  "REPORT",
  "SCREEN",
  "FILE-CONTROL",
  "I-O-CONTROL",
  "SPECIAL-NAMES",
  "SOURCE-COMPUTER",
  "OBJECT-COMPUTER",
  "REPOSITORY",
  "PROGRAM-ID",
  "AUTHOR",
  "INSTALLATION",
  "DATE-WRITTEN",
  "DATE-COMPILED",
  "SECURITY",
  "FD",
  "SD",
  "RD",
  "DECLARATIVES",
  "END",
]);

/** Phrases that sit one level in from the statement they belong to. */
const PHRASES = new Set([
  "ELSE",
  "WHEN",
  "AT",
  "NOT",
  "ON",
  "INVALID",
  "SIZE",
  "OVERFLOW",
  "END-OF-PAGE",
  "EOP",
]);

interface Line {
  /** The text with leading and trailing blanks removed. */
  text: string;
  /** True for a line whose indicator column holds `*` or `/`. */
  comment: boolean;
  /** The original indicator character, kept so a continuation stays one. */
  indicator: string;
  /** The line exactly as it arrived, for anything copied through untouched. */
  raw: string;
  /**
   * True when the line began in Area A, columns 8 to 11.
   *
   * The column is what tells a paragraph name from the tail of a wrapped
   * statement. `RECORDING MODE IS F.` wraps to a line holding `F.`, which has
   * exactly the shape of a paragraph header; only the column says it is not
   * one. A formatter that loses the column invents a paragraph on its second
   * pass, which is how this stopped being idempotent.
   */
  areaA: boolean;
}

/**
 * Reads a source into logical lines, keeping comments and continuations as they
 * are.
 *
 * A continuation line is left untouched. Re-indenting one changes where a
 * literal resumes, and a literal that resumes in the wrong column is a
 * different literal.
 */
function read(source: string): Line[] {
  return source.split(/\r?\n/).map((raw) => {
    if (/^\s{0,6}(CBL|PROCESS)\s/i.test(raw)) {
      return {
        text: raw.trimEnd(),
        comment: true,
        indicator: "!",
        raw,
        areaA: true,
      };
    }

    // Columns 1-6 are the sequence area only when they hold a sequence number:
    // blank, or digits. A program that was pasted, or emailed, or pulled out of
    // a listing may start in column 1, and slicing seven characters off it
    // would take the first word of every line. That is not a hypothetical —
    // it is what a program somebody needs this tool for looks like.
    const sequence = raw.slice(0, 6);
    const fixed = sequence.trim() === "" || /^\d+\s*$/.test(sequence);
    if (!fixed) {
      const free = raw.trim();
      return {
        text: free.replace(/^\*>?\s?/, ""),
        comment: free.startsWith("*"),
        indicator: free.startsWith("*") ? "*" : " ",
        raw,
        // A free-format line has no columns to read, so the only signal left is
        // the text itself.
        areaA: true,
      };
    }

    const indicator = raw[6] ?? " ";
    const body = raw.slice(7, 72);
    return {
      text: body.trim(),
      // `*>` in Area B is a comment too, and the emitter writes them there:
      // a note beside a statement is indented with the statement rather than
      // pushed to column 7. Reading one as program text folded it into the
      // sentence above it and put `HALF_UP.` into the PROCEDURE DIVISION.
      comment:
        indicator === "*" ||
        indicator === "/" ||
        body.trimStart().startsWith("*>"),
      indicator,
      raw,
      areaA: body.length > 0 && body[0] !== " " ? true : /^ {0,3}\S/.test(body),
    };
  });
}

/** The first COBOL word of a line, upper-cased. */
function firstWord(text: string): string {
  return /^([A-Za-z0-9-]+)/.exec(text)?.[1]?.toUpperCase() ?? "";
}

/**
 * Statements that are one word and a full stop.
 *
 * `CONTINUE.` and `EXIT.` have exactly the shape of a paragraph header, and
 * treating them as one moves them into Area A — which is not a formatting
 * difference. A word in Area A *is* a paragraph name, so the formatter would
 * have invented a paragraph and broken the `PERFORM ... THRU` above it.
 */
const BARE_STATEMENTS = new Set(["CONTINUE", "EXIT", "GOBACK", "STOP"]);

/** True when the line is a paragraph or section header: a name and a period. */
function isHeader(text: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*(\s+SECTION)?\s*\.\s*$/i.test(text)) {
    return false;
  }
  return !BARE_STATEMENTS.has(firstWord(text));
}

/** True when the line begins a data description entry. */
function levelNumber(text: string): number | null {
  const match = /^(\d\d?)\s/.exec(text);
  if (!match) {
    return null;
  }
  const level = Number(match[1]);
  return level >= 1 && level <= 88 ? level : null;
}

export interface FormatCobolResult {
  text: string;
  /** True when the input was already in this shape. */
  unchanged: boolean;
}

/**
 * Physical lines folded back into the logical ones they belong to.
 *
 * A statement wrapped at column 72 arrives as several lines, and re-indenting
 * each of them separately is how a continuation ends up in the wrong column.
 * Folding first and re-wrapping with `toReferenceFormat` — the same function
 * the emitter uses on the way out — is what makes formatting already-formatted
 * output a no-op rather than nearly one.
 *
 * A line continues the one before it when that one did not end in a full stop
 * and this one does not start something new. A hyphen in the indicator column
 * is stronger than any of that: it continues a literal, and joins with no
 * separator at all.
 */
function fold(lines: Line[]): LogicalLine[] {
  const logical: LogicalLine[] = [];
  let open = false;

  for (const line of lines) {
    if (line.comment || line.indicator === "!" || line.text === "") {
      logical.push({
        text: line.text,
        comment: true,
        raw: line.raw,
        areaA: line.areaA,
      });
      // A comment does not close the statement it sits inside.
      continue;
    }

    const previous =
      logical.length > 0 ? logical[logical.length - 1] : undefined;
    if (line.indicator === "-" && previous && !previous.comment) {
      // A continued literal reopens with a quote, and that quote is not part of
      // the value. Concatenating it produced `"...RUN"-SUMMARY"`, which is two
      // literals and a subtraction rather than one string.
      previous.text += reopensLiteral(previous.text, line.text)
        ? line.text.slice(1)
        : line.text;
      open = !previous.text.endsWith(".");
      continue;
    }

    const continues =
      open &&
      previous !== undefined &&
      !startsSomethingNew(line.text, line.areaA) &&
      lastCode(logical) !== undefined;

    if (continues) {
      const target = lastCode(logical)!;
      target.text = `${target.text} ${line.text}`;
      open = !target.text.endsWith(".");
      continue;
    }

    logical.push({
      text: line.text,
      comment: false,
      raw: line.raw,
      areaA: line.areaA,
    });
    open = !line.text.endsWith(".");
  }

  return logical;
}

/**
 * Whether a continuation line reopens the literal the previous one left open.
 *
 * A literal is open when the text so far holds an odd number of its quote
 * character. The continuation then starts with that same quote, and it is a
 * marker rather than data.
 */
function reopensLiteral(sofar: string, continuation: string): boolean {
  for (const quote of ['"', "'"]) {
    const count = [...sofar].filter((character) => character === quote).length;
    if (count % 2 === 1 && continuation.startsWith(quote)) {
      return true;
    }
  }
  return false;
}

interface LogicalLine {
  text: string;
  comment: boolean;
  raw: string;
  areaA: boolean;
}

/** The most recent line that is program text rather than a comment. */
function lastCode(logical: LogicalLine[]): LogicalLine | undefined {
  for (let index = logical.length - 1; index >= 0; index -= 1) {
    if (!logical[index]!.comment) {
      return logical[index];
    }
  }
  return undefined;
}

/** True when a line begins a statement, a clause or an entry of its own. */
function startsSomethingNew(text: string, areaA: boolean): boolean {
  const word = firstWord(text);
  return (
    VERBS.has(word) ||
    CLOSERS.has(word) ||
    PHRASES.has(word) ||
    AREA_A_WORDS.has(word) ||
    levelNumber(text) !== null ||
    (areaA && isHeader(text))
  );
}

/** Verbs, which always begin a statement. */
const VERBS = new Set([
  ...OPENERS,
  "MOVE",
  "GO",
  "GOBACK",
  "STOP",
  "CONTINUE",
  "EXIT",
  "OPEN",
  "CLOSE",
  "SET",
  "INITIALIZE",
  "INSPECT",
  "ACCEPT",
  "CANCEL",
  "RELEASE",
  "MERGE",
  "SORT",
  "SELECT",
  "COPY",
]);

export function formatCobol(source: string): FormatCobolResult {
  const out: string[] = [];

  /** Open scopes in the PROCEDURE DIVISION, deepest last. */
  let depth = 0;
  let inProcedure = false;
  /** Data description entries indent by level: 01 in Area A, the rest under it. */
  let dataLevels: number[] = [];

  const logical = fold(read(source));

  for (const [index, line] of logical.entries()) {
    if (line.comment) {
      if (line.text === "" && line.raw.trim() === "") {
        out.push("");
        continue;
      }
      if (/^\s{0,6}(CBL|PROCESS)\s/i.test(line.raw)) {
        out.push(line.raw.trimEnd());
        continue;
      }
      // Copied through exactly. A comment's indentation is the author's, and a
      // formatter that re-derives it from the surrounding nesting rewrites the
      // program's documentation to say something nobody wrote. Only a comment
      // that arrived without an indicator column gets one.
      out.push(
        line.raw.length > 6 && (line.raw[6] === "*" || line.raw[6] === "/")
          ? line.raw.trimEnd()
          : `      *${line.text === "" ? "" : `> ${line.text}`}`,
      );
      continue;
    }

    const word = firstWord(line.text);

    if (word === "PROCEDURE") {
      inProcedure = true;
      depth = 0;
      dataLevels = [];
    }

    // Area A: a division, a section, a paragraph, an FD, or a level 01.
    const level = levelNumber(line.text);
    if (
      AREA_A_WORDS.has(word) ||
      (line.areaA && isHeader(line.text)) ||
      level === 1 ||
      level === 77
    ) {
      if (level === 1 || level === 77) {
        dataLevels = [level];
      }
      out.push(...emit(AREA_A, line.text));
      continue;
    }

    if (!inProcedure && level !== null) {
      // A subordinate entry indents once per level it is below its 01.
      while (
        dataLevels.length > 0 &&
        dataLevels[dataLevels.length - 1]! >= level
      ) {
        dataLevels.pop();
      }
      const column = AREA_A + STEP * dataLevels.length;
      dataLevels.push(level);
      out.push(...emit(column, line.text));
      continue;
    }

    if (!inProcedure) {
      // A clause of a SELECT or an FD: one level in from it.
      out.push(...emit(AREA_B, line.text));
      continue;
    }

    if (CLOSERS.has(word)) {
      depth = Math.max(0, depth - 1);
      out.push(...emit(indentFor(depth, true) + AREA_A, line.text));
      continue;
    }

    if (PHRASES.has(word)) {
      out.push(
        ...emit(indentFor(Math.max(0, depth - 1), true) + AREA_A, line.text),
      );
      continue;
    }

    out.push(...emit(indentFor(depth, true) + AREA_A, line.text));

    if (OPENERS.has(word) && opensScope(word, logical, index)) {
      depth += 1;
    }
  }

  const text = `${out.join("\n").replace(/\s+$/, "")}\n`;
  return { text, unchanged: text === source };
}

function indentFor(depth: number, inProcedure: boolean): number {
  return inProcedure ? STEP + depth * STEP : STEP;
}

/**
 * Whether a verb opens a scope that something later closes.
 *
 * `PERFORM PARA THRU PARA-EXIT` and `PERFORM UNTIL ... END-PERFORM` start with
 * the same word and only the second indents. Rather than guess from the rest of
 * the line, the matching terminator is looked for ahead, stopping at the end of
 * the sentence — which is where a scope opened without one has to have closed.
 */
function opensScope(
  word: string,
  logical: LogicalLine[],
  from: number,
): boolean {
  if (logical[from]?.text.endsWith(".")) {
    return false;
  }
  const terminator = `END-${word}`;
  let nested = 0;
  for (let index = from + 1; index < logical.length; index += 1) {
    const line = logical[index]!;
    if (line.comment) {
      continue;
    }
    const first = firstWord(line.text);
    if (first === word) {
      nested += 1;
    } else if (first === terminator) {
      if (nested === 0) {
        return true;
      }
      nested -= 1;
    }
    // A full stop ends the sentence, and with it any scope left open in it.
    if (line.text.endsWith(".")) {
      return false;
    }
  }
  return false;
}

/** One logical line, at a column, split to fit the margin. */
function emit(column: number, text: string): string[] {
  return toReferenceFormat(`${" ".repeat(column)}${text}`);
}
