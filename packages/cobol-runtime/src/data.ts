/**
 * The DATA DIVISION, as a storage map.
 *
 * A COBOL record is not a struct with fields at whatever offsets a compiler
 * chooses. It is a contiguous run of bytes whose layout the program states, and
 * `REDEFINES` and group moves mean the layout is observable. So this builds
 * exactly that: every item gets an offset and a length inside its 01-level
 * record, and every read and write goes through those numbers.
 *
 * That is also why `packages/copybook` can describe the same layout from the
 * other end. The two agree because both are derived from the same rules in the
 * *Enterprise COBOL Language Reference*, and `tests/cobol-runtime.test.ts`
 * checks a handful of layouts against the copybook reporter to keep it that way.
 */

import type { Cursor } from "./cursor";
import {
  parsePicture,
  storageLength,
  type Picture,
  type Usage,
} from "./picture";
import { CobolSyntaxError, CobolUnsupportedError } from "./source";

export type Area = "working" | "local" | "linkage" | "file";

/** An 88-level condition name and the values that make it true. */
export interface Condition {
  name: string;
  /** `VALUE "00" THRU "09"` is one range; `VALUE 1 2 3` is three. */
  ranges: { from: Literal; to: Literal | null }[];
}

export type Literal =
  | { kind: "text"; value: string }
  | { kind: "number"; value: string }
  | {
      kind: "figurative";
      value: "SPACES" | "ZEROS" | "HIGH-VALUES" | "LOW-VALUES" | "QUOTES";
    };

export interface Field {
  name: string;
  level: number;
  parent: Field | null;
  children: Field[];
  /** Null for a group item, which has no picture of its own. */
  picture: Picture | null;
  usage: Usage;
  /** Offset from the start of the containing record, for occurrence 1. */
  offset: number;
  /** Bytes in one occurrence. */
  elementLength: number;
  /** Bytes in the whole item: `elementLength × occurs`. */
  length: number;
  occurs: number;
  redefines: string | null;
  external: boolean;
  value: Literal | null;
  conditions: Condition[];
  area: Area;
  /** The 01 or 77 this belongs to. */
  root: Field;
  /** Ancestor names, nearest first, for `AMOUNT OF POST-TRANSFER-REQUEST`. */
  qualifiers: string[];
}

/** Clause keywords that end a picture string. */
const AFTER_PICTURE = new Set([
  "VALUE",
  "VALUES",
  "USAGE",
  "COMP",
  "COMP-1",
  "COMP-2",
  "COMP-3",
  "COMP-4",
  "COMP-5",
  "COMPUTATIONAL",
  "COMPUTATIONAL-3",
  "COMPUTATIONAL-4",
  "BINARY",
  "PACKED-DECIMAL",
  "DISPLAY",
  "OCCURS",
  "REDEFINES",
  "EXTERNAL",
  "GLOBAL",
  "SIGN",
  "JUSTIFIED",
  "JUST",
  "SYNCHRONIZED",
  "SYNC",
  "BLANK",
  "IS",
]);

/**
 * Reassembles a picture string from the tokens it lexed into.
 *
 * `S9(16)V99` arrives as five tokens and `-(16)9.99` as four, because a
 * tokenizer that understood picture strings would have to understand them
 * everywhere. Concatenating the token texts with no separator reproduces the
 * original exactly: COBOL forbids a space inside a picture string, so nothing
 * can be lost.
 */
function readPictureText(cursor: Cursor): string {
  let text = "";
  for (;;) {
    const token = cursor.peek();
    if (token.kind === "period" || token.kind === "end") {
      break;
    }
    if (token.kind === "word" && AFTER_PICTURE.has(token.text)) {
      break;
    }
    text += token.text;
    cursor.next();
  }
  if (text === "") {
    throw new CobolSyntaxError(`Line ${String(cursor.line)}: empty PICTURE.`);
  }
  return text;
}

function readLiteral(cursor: Cursor): Literal {
  const token = cursor.peek();
  if (token.kind === "string") {
    cursor.next();
    return { kind: "text", value: token.value ?? "" };
  }
  if (token.kind === "number") {
    cursor.next();
    return { kind: "number", value: token.text };
  }
  if (token.kind === "punct" && (token.text === "-" || token.text === "+")) {
    cursor.next();
    const number = cursor.next();
    return { kind: "number", value: token.text + number.text };
  }
  if (token.kind === "word") {
    const figurative: Record<string, Literal> = {
      SPACE: { kind: "figurative", value: "SPACES" },
      SPACES: { kind: "figurative", value: "SPACES" },
      ZERO: { kind: "figurative", value: "ZEROS" },
      ZEROS: { kind: "figurative", value: "ZEROS" },
      ZEROES: { kind: "figurative", value: "ZEROS" },
      "HIGH-VALUE": { kind: "figurative", value: "HIGH-VALUES" },
      "HIGH-VALUES": { kind: "figurative", value: "HIGH-VALUES" },
      "LOW-VALUE": { kind: "figurative", value: "LOW-VALUES" },
      "LOW-VALUES": { kind: "figurative", value: "LOW-VALUES" },
      QUOTE: { kind: "figurative", value: "QUOTES" },
      QUOTES: { kind: "figurative", value: "QUOTES" },
    };
    const known = figurative[token.text];
    if (known) {
      cursor.next();
      return known;
    }
  }
  throw new CobolSyntaxError(
    `Line ${String(cursor.line)}: expected a literal, found ${token.text}.`,
  );
}

interface Pending {
  field: Field;
  /** Next free byte inside this group, for occurrence 1. */
  cursor: number;
}

/**
 * Reads data description entries until something that is not one.
 *
 * `stop` decides where the section ends: the caller knows whether the next
 * `PROCEDURE` or `WORKING-STORAGE` word belongs to it.
 */
export function parseDataEntries(
  cursor: Cursor,
  area: Area,
  stop: (cursor: Cursor) => boolean,
): Field[] {
  const roots: Field[] = [];
  const stack: Pending[] = [];
  let previous: Field | null = null;

  while (!cursor.done && !stop(cursor)) {
    const token = cursor.peek();
    if (token.kind !== "number") {
      throw new CobolSyntaxError(
        `Line ${String(token.line)}: expected a level number, found ${token.text}.`,
      );
    }
    const level = Number(cursor.next().text);

    if (level === 88) {
      if (!previous) {
        throw new CobolSyntaxError(
          `Line ${String(token.line)}: an 88 with nothing to qualify.`,
        );
      }
      previous.conditions.push(parseCondition(cursor));
      continue;
    }

    const field = parseEntry(cursor, level, area);

    // Close every group this level ends.
    while (stack.length > 0 && stack[stack.length - 1]!.field.level >= level) {
      closeGroup(stack.pop()!, stack);
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      field.parent = parent.field;
      field.root = parent.field.root;
      field.qualifiers = [parent.field.name, ...parent.field.qualifiers];
      parent.field.children.push(field);
      field.offset =
        redefineTarget(field, parent.field)?.offset ?? parent.cursor;
    } else {
      field.root = field;
      field.offset = 0;
      roots.push(field);
    }

    if (field.picture) {
      field.elementLength = storageLength(field.picture, field.usage);
      field.length = field.elementLength * field.occurs;
      if (parent && field.redefines === null) {
        parent.cursor += field.length;
      }
    } else {
      // A group's size is the sum of its children, which are not read yet.
      stack.push({ field, cursor: 0 });
    }

    previous = field;
  }

  while (stack.length > 0) {
    closeGroup(stack.pop()!, stack);
  }

  return roots;
}

/**
 * Finishes a group once its children are known.
 *
 * A group's size is not stated anywhere — it is the sum of what is under it —
 * so it can only be settled on the way back out. The enclosing group's cursor
 * advances here rather than when the group was opened, which is why the running
 * offset lives on the stack and not on the field.
 */
function closeGroup(pending: Pending, stack: Pending[]): void {
  const group = pending.field;
  group.elementLength = pending.cursor;
  group.length = group.elementLength * group.occurs;
  const parent = stack[stack.length - 1];
  if (parent && group.redefines === null) {
    parent.cursor += group.length;
  }
}

function redefineTarget(field: Field, parent: Field): Field | undefined {
  if (field.redefines === null) {
    return undefined;
  }
  const target = parent.children.find(
    (child) => child.name === field.redefines,
  );
  if (!target) {
    throw new CobolSyntaxError(
      `${field.name} REDEFINES ${field.redefines}, which is not a sibling.`,
    );
  }
  return target;
}

function parseCondition(cursor: Cursor): Condition {
  const name = cursor.word();
  cursor.skipNoise("VALUE", "VALUES", "IS", "ARE");
  const ranges: Condition["ranges"] = [];
  while (!cursor.acceptPeriod()) {
    const from = readLiteral(cursor);
    const to =
      cursor.accept("THRU") || cursor.accept("THROUGH")
        ? readLiteral(cursor)
        : null;
    ranges.push({ from, to });
    if (cursor.done) {
      break;
    }
  }
  return { name, ranges };
}

function parseEntry(cursor: Cursor, level: number, area: Area): Field {
  // FILLER is a name; an omitted name means FILLER.
  const named = cursor.peek().kind === "word";
  const name = named ? cursor.word() : "FILLER";

  const field: Field = {
    name,
    level,
    parent: null,
    children: [],
    picture: null,
    usage: "display",
    offset: 0,
    elementLength: 0,
    length: 0,
    occurs: 1,
    redefines: null,
    external: false,
    value: null,
    conditions: [],
    area,
    root: null as unknown as Field,
    qualifiers: [],
  };
  field.root = field;

  let explicitUsage: Usage | null = null;

  while (!cursor.acceptPeriod()) {
    if (cursor.done) {
      break;
    }
    if (cursor.accept("REDEFINES")) {
      field.redefines = cursor.word();
      continue;
    }
    if (cursor.accept("PIC") || cursor.accept("PICTURE")) {
      cursor.skipNoise("IS");
      field.picture = parsePicture(readPictureText(cursor));
      continue;
    }
    if (cursor.accept("OCCURS")) {
      const count = cursor.next();
      if (count.kind !== "number") {
        throw new CobolUnsupportedError(
          `Line ${String(count.line)}: OCCURS DEPENDING ON is not implemented.`,
        );
      }
      field.occurs = Number(count.text);
      cursor.skipNoise("TIMES");
      // `INDEXED BY` names an index register; the generated code subscripts by
      // an ordinary numeric item, so the names are read and discarded.
      if (cursor.accept("INDEXED")) {
        cursor.skipNoise("BY");
        while (
          cursor.peek().kind === "word" &&
          !AFTER_PICTURE.has(cursor.peek().text)
        ) {
          cursor.next();
        }
      }
      continue;
    }
    if (cursor.accept("VALUE") || cursor.accept("VALUES")) {
      cursor.skipNoise("IS", "ARE");
      field.value = readLiteral(cursor);
      continue;
    }
    if (cursor.accept("EXTERNAL")) {
      field.external = true;
      continue;
    }
    if (cursor.accept("GLOBAL")) {
      continue;
    }
    if (cursor.accept("USAGE")) {
      cursor.skipNoise("IS");
      continue;
    }
    if (
      cursor.accept("COMP-3") ||
      cursor.accept("COMPUTATIONAL-3") ||
      cursor.accept("PACKED-DECIMAL")
    ) {
      explicitUsage = "packed";
      continue;
    }
    if (
      cursor.accept("COMP") ||
      cursor.accept("COMP-4") ||
      cursor.accept("COMP-5") ||
      cursor.accept("COMPUTATIONAL") ||
      cursor.accept("COMPUTATIONAL-4") ||
      cursor.accept("BINARY")
    ) {
      explicitUsage = "binary";
      continue;
    }
    if (cursor.accept("DISPLAY")) {
      explicitUsage = "display";
      continue;
    }
    if (cursor.accept("SIGN")) {
      cursor.skipNoise("IS", "LEADING", "TRAILING", "SEPARATE", "CHARACTER");
      continue;
    }
    if (cursor.accept("SYNCHRONIZED") || cursor.accept("SYNC")) {
      cursor.skipNoise("LEFT", "RIGHT");
      continue;
    }
    if (cursor.accept("JUSTIFIED") || cursor.accept("JUST")) {
      cursor.skipNoise("RIGHT");
      continue;
    }
    if (cursor.accept("BLANK")) {
      cursor.skipNoise("WHEN", "ZERO");
      continue;
    }

    throw new CobolUnsupportedError(
      `Line ${String(cursor.line)}: ${cursor.peek().text} is not a data clause this interpreter implements.`,
    );
  }

  field.usage = explicitUsage ?? "display";
  if (
    field.picture &&
    (field.picture.category === "alphanumeric" ||
      field.picture.category === "alphabetic" ||
      field.picture.category === "numeric-edited" ||
      field.picture.category === "alphanumeric-edited") &&
    field.usage !== "display"
  ) {
    throw new CobolSyntaxError(
      `${field.name}: PIC ${field.picture.mask} cannot be ${field.usage}.`,
    );
  }

  return field;
}

/** Every field under a record, the record itself first. */
export function flatten(field: Field): Field[] {
  return [field, ...field.children.flatMap(flatten)];
}
