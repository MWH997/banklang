/**
 * COBOL's fixed reference format, which is the only one z/OS reads.
 *
 * Enterprise COBOL reads a 72-character line. Columns 1-6 are the sequence
 * number area, column 7 is the indicator area, columns 8-11 are Area A and
 * columns 12-72 are Area B; columns 73-80 are the identification area and are
 * not part of the program. There is no compiler option on z/OS that widens it —
 * `SOURCEFORMAT(EXTEND)` is an AIX option, and the Language Reference states the
 * 72-character line without qualification.
 *
 * Nothing warns about the overflow. The compiler simply does not see the text
 * past column 72, so `ACCOUNT-INPUT-STATUS` arrives as `ACCOUNT-INPUT-S` and the
 * compile fails on an undefined name that a reader looking at the source cannot
 * find. This module is what stops that being generated in the first place.
 *
 * GnuCOBOL does not enforce any of it unless told to: given a file whose first
 * line starts in column 1 it switches to free format on its own, where none of
 * these rules exist. That is why the generated programs passed local validation
 * for as long as they did.
 */

/** The last column of a COBOL source line. */
export const COBOL_LAST_COLUMN = 72;

/** Column 7, where a hyphen marks a continued literal. */
const INDICATOR_COLUMN = 7;

/** Area B starts at column 12; a continuation line's Area A must be blank. */
const AREA_B_COLUMN = 12;

/**
 * How far a continuation is indented past the line it continues.
 *
 * Far enough to read as a continuation rather than as the next statement, and
 * capped so that a deeply nested statement still has room to say anything.
 */
const CONTINUATION_INDENT = 4;
const CONTINUATION_LIMIT = 40;

/**
 * Break one generated line into as many source lines as reference format needs.
 *
 * A line within the margin is returned untouched, which is nearly all of them —
 * this rewrites only what would otherwise be cut off.
 */
export function toReferenceFormat(line: string): string[] {
  if (line.length <= COBOL_LAST_COLUMN) {
    return [line];
  }

  const indent = line.length - line.trimStart().length;
  const body = line.slice(indent);

  // A comment continues as another comment. Flowing it into a continuation line
  // would put the rest of the sentence into the program.
  if (body.startsWith("*")) {
    return wrapComment(indent, body);
  }

  return wrapStatement(indent, body);
}

/** The last column of a JCL statement's fields. */
export const JCL_LAST_COLUMN = 71;

/**
 * Break one generated JCL statement into as many card images as it needs.
 *
 * JCL fields end at column 71 — columns 73-80 are the identification field and
 * are ignored, and a non-blank column 72 means something else again. A JOB card
 * naming a program with a long name runs past it, and what the reader loses is
 * the tail of the card: `NOTIFY=&SYSUID` disappears, or worse, an operand is cut
 * in half and the job is flushed with a JCL error before a step runs.
 *
 * The continuation rule for a parameter field is to break after a complete
 * parameter or subparameter *including its comma*, code `//` in columns 1-2, a
 * blank in column 3, and resume anywhere in columns 4-16. The trailing comma is
 * what says the statement continues; no character in column 72 is needed, and
 * the JCL Reference warns that one there is ignored on a card ending that way.
 *
 * A comment card (`//*`) is not continued at all — it is broken into further
 * comment cards.
 */
export function toJclStatement(line: string): string[] {
  if (line.length <= JCL_LAST_COLUMN) {
    return [line];
  }
  if (line.startsWith("//*")) {
    return wrapWords(line.slice(3).trim(), "//*", JCL_LAST_COLUMN);
  }

  // `//NAME OP operands` — the operand field is the only one that continues, so
  // the name and the operation stay on the first card whatever their length.
  const match = line.match(/^(\/\/\S*\s+\S+\s+)(.*)$/);
  if (!match) {
    return [line];
  }

  // Both groups are mandatory in the pattern that produced this match.
  const [, head, operands] = match as unknown as [string, string, string];
  // Column 16 is the last column a continued field may resume in, and lining
  // every continuation up there is what a reader expects to see.
  const resume = `//${" ".repeat(13)}`;
  const cards: string[] = [];
  let current = head;

  for (const parameter of splitJclParameters(operands)) {
    if (current.length + parameter.length <= JCL_LAST_COLUMN) {
      current += parameter;
      continue;
    }
    if (current !== resume) {
      cards.push(current);
      current = resume;
    }
    if (current.length + parameter.length <= JCL_LAST_COLUMN) {
      current += parameter;
      continue;
    }
    // One parameter wider than a card, which is a long dataset name or a long
    // PARM. A parameter enclosed in apostrophes is continued by running it to
    // column 71 and resuming in column 16, splitting the value if it has to;
    // the one thing that must not land in column 71 is an apostrophe, which
    // the system reads as the end of the parameter.
    let rest = parameter;
    while (current.length + rest.length > JCL_LAST_COLUMN) {
      let take = JCL_LAST_COLUMN - current.length;
      if (rest[take - 1] === "'") {
        take -= 1;
      }
      cards.push(current + rest.slice(0, take));
      rest = rest.slice(take);
      current = resume;
    }
    current += rest;
  }
  cards.push(current);

  return cards;
}

/**
 * Split an operand field after each complete parameter, keeping its comma.
 *
 * A comma inside parentheses or apostrophes separates subparameters of one
 * parameter rather than ending it, so breaking there would leave the card
 * holding half of a value.
 */
function splitJclParameters(operands: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;

  for (let index = 0; index < operands.length; index += 1) {
    const character = operands[index];
    if (character === "'") {
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(operands.slice(start, index + 1));
      start = index + 1;
    }
  }
  parts.push(operands.slice(start));

  return parts.filter((part) => part.length > 0);
}

function wrapComment(indent: number, body: string): string[] {
  // `*>` is the floating comment indicator and `*` in column 7 comments the
  // whole line; either way the marker is repeated on each line it becomes.
  const marker = body.startsWith("*>") ? "*>" : "*";

  return wrapWords(
    body.slice(marker.length),
    `${" ".repeat(indent)}${marker}`,
    COBOL_LAST_COLUMN,
  );
}

/**
 * Fill lines with words, each opening with `prefix`.
 *
 * Spacing inside the text is left alone rather than collapsed, and a
 * continuation picks up the indentation the text itself started with, so a
 * comment that lines its words up in columns still does after wrapping.
 */
function wrapWords(text: string, prefix: string, last: number): string[] {
  const lead = " ".repeat(text.length - text.trimStart().length);
  const lines: string[] = [];
  let rest = text;

  for (;;) {
    const room = last - prefix.length;
    if (rest.length <= room) {
      lines.push(`${prefix}${rest.trimEnd()}`);
      return lines;
    }
    const cut = rest.lastIndexOf(" ", room);
    if (cut <= lead.length) {
      // One unbreakable run wider than the line. Nothing to do but let it be
      // long, which for a comment costs the reader nothing.
      lines.push(`${prefix}${rest.trimEnd()}`);
      return lines;
    }
    lines.push(`${prefix}${rest.slice(0, cut).trimEnd()}`);
    rest = lead + rest.slice(cut).trimStart();
  }
}

function wrapStatement(indent: number, body: string): string[] {
  const continueAt = Math.max(
    AREA_B_COLUMN - 1,
    Math.min(indent + CONTINUATION_INDENT, CONTINUATION_LIMIT),
  );
  const lines: string[] = [];
  let margin = indent;
  let rest = body;
  // True while the line being built reopens a literal broken at the margin, so
  // it needs the hyphen that says "no space between this and the last line".
  let continued = false;

  for (;;) {
    const room = COBOL_LAST_COLUMN - margin;
    if (rest.length <= room) {
      lines.push(`${linePrefix(margin, continued)}${rest}`);
      return lines;
    }

    // Break at the last space that fits, and keep everything before it exactly
    // as the emitter wrote it: the columns a data description entry lines its
    // pictures up in are the reason anyone can read a record at a glance, and
    // reflowing the whole line to single spaces loses them.
    const cut = lastBreakWithin(rest, room);
    if (cut !== -1) {
      lines.push(
        `${linePrefix(margin, continued)}${rest.slice(0, cut).trimEnd()}`,
      );
      rest = rest.slice(cut + 1).trimStart();
      margin = continueAt;
      continued = false;
      continue;
    }

    // What is left starts with one token too wide for a line of its own.
    // Nothing but a literal can be: a COBOL word is at most 30 characters, and
    // a qualified reference is several words.
    const end = endOfToken(rest, 0);
    const split = splitLiteralToken(
      rest.slice(0, end),
      margin,
      continueAt,
      continued,
    );
    if (split.lines.length === 0) {
      // Unbreakable. Write it long rather than write something else.
      lines.push(`${linePrefix(margin, continued)}${rest}`);
      return lines;
    }
    lines.push(...split.lines);
    margin = continueAt;
    continued = true;
    rest = `${split.tail}${rest.slice(end)}`.trimEnd();
  }
}

/**
 * The blanks a line starts with, and the hyphen when it continues a literal.
 *
 * Column 7 is the indicator area. Without a hyphen there, the last character of
 * the line before is taken to be followed by a space — which for a literal
 * broken at the margin means two literals rather than one, and a DISPLAY that
 * prints half of the message it was given.
 */
function linePrefix(margin: number, continued: boolean): string {
  if (!continued) {
    return " ".repeat(margin);
  }

  return `${" ".repeat(INDICATOR_COLUMN - 1)}-${" ".repeat(margin - INDICATOR_COLUMN)}`;
}

/**
 * The last space in the first `room` characters that a line may break at.
 *
 * A space inside a quoted literal is part of its value, so breaking there would
 * shorten the literal and start the next line with the rest of the text as
 * though it were code.
 */
function lastBreakWithin(text: string, room: number): number {
  let found = -1;
  let index = 0;

  while (index < text.length && index <= room) {
    const character = text[index];
    if (character === '"' || character === "'") {
      index = endOfLiteral(text, index) + 1;
      continue;
    }
    if (character === " ") {
      found = index;
    }
    index += 1;
  }

  return found;
}

/** Where the token starting at `from` ends, passing over any literal in it. */
function endOfToken(text: string, from: number): number {
  let index = from;

  while (index < text.length && text[index] !== " ") {
    if (text[index] === '"' || text[index] === "'") {
      index = endOfLiteral(text, index) + 1;
      continue;
    }
    index += 1;
  }

  return index;
}

/** The index of a literal's closing delimiter, given the opening one. */
function endOfLiteral(text: string, open: number): number {
  const quote: string = text[open]!;
  let index = open + 1;

  while (index < text.length) {
    if (text[index] === quote) {
      // Two together are one quote inside the literal, not the end of it.
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }

  return text.length - 1;
}

/**
 * Break a token that will not fit on a line of its own.
 *
 * Only the literal inside it can be broken, so the token is taken apart into
 * whatever comes before the opening quote, the literal, and whatever follows
 * the closing one — `VALUE 'x…x'.` carries its period with it.
 */
function splitLiteralToken(
  token: string,
  margin: number,
  continueAt: number,
  continued: boolean,
): { lines: string[]; tail: string } {
  const open = token.search(/["']/);
  if (open === -1) {
    // A word with no literal in it cannot be broken. COBOL names are short
    // enough that this does not arise; emitting it whole is better than
    // emitting a line that is silently something else.
    return { lines: [], tail: token };
  }

  const close = endOfLiteral(token, open);

  return splitLiteral(
    token.slice(0, open),
    token.slice(open, close + 1),
    token.slice(close + 1),
    margin,
    continueAt,
    continued,
  );
}

/**
 * Continue an alphanumeric literal across source lines.
 *
 * Every column of a continued line through column 72 is part of the literal, so
 * a continued line has to be filled to the margin exactly — stopping short pads
 * the value with the blanks that follow. Each continuation carries a hyphen in
 * the indicator area and reopens the literal with a quote, and only the last
 * one closes it.
 */
function splitLiteral(
  before: string,
  literal: string,
  after: string,
  firstMargin: number,
  continueAt: number,
  continued: boolean,
): { lines: string[]; tail: string } {
  // The caller passes a literal, which by definition opens with its delimiter.
  const quote = literal[0]!;
  const lines: string[] = [];
  let rest = literal.slice(1, -1);
  let margin = firstMargin;
  let head = before;
  let hyphen = continued;
  // A continuation that opens with two quotes puts one quote in the value,
  // which is how a doubled quote straddling the margin is carried over.
  let opener: string = quote;

  for (;;) {
    const room = COBOL_LAST_COLUMN - margin - head.length - opener.length;
    // Room for what is left of the literal, its closing quote, and whatever
    // follows it — a period, a closing bracket — which cannot start a line.
    if (rest.length + 1 + after.length <= room) {
      return { lines, tail: `${head}${opener}${rest}${quote}${after}` };
    }
    if (room < 1) {
      // Nothing would be consumed, so there is nothing to do but write it long
      // and let the compile fail loudly rather than loop here forever.
      return { lines, tail: `${head}${opener}${rest}${quote}${after}` };
    }

    lines.push(
      `${linePrefix(margin, hyphen)}${head}${opener}${rest.slice(0, room)}`,
    );
    hyphen = true;

    // A doubled quote broken across the margin leaves the first of the pair in
    // column 72; the two quotes at the head of the continuation are the one
    // quote the pair stands for, so the second of the pair is consumed here.
    let trailing = 0;
    while (trailing < room && rest[room - 1 - trailing] === quote) {
      trailing += 1;
    }
    const straddles = trailing % 2 === 1;
    rest = rest.slice(straddles ? room + 1 : room);
    margin = continueAt;
    head = "";
    opener = straddles ? `${quote}${quote}` : quote;
  }
}
