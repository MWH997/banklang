/**
 * Line up each `PIC` clause against the longest name it sits beside.
 *
 * The emitter padded every data name to a fixed column — twenty characters for
 * a level 01, twenty-four for a subordinate entry — which is what a person
 * would do by eye, and a name longer than the column simply overran it:
 *
 *     01  BANK-FAILURE-CODE    PIC X(32) EXTERNAL.
 *     01  VALIDATE-AMOUNT-RESULT PIC X(1) VALUE "N".
 *     01  VALIDATE-AMOUNT-P1   PIC S9(16)V99 COMP-3 VALUE ZERO.
 *
 * One long name and the block stops lining up. It is cosmetic, and it is
 * exactly the cosmetic that decides whether a mainframe reviewer believes the
 * generator was written by somebody who has read production COBOL, so it is a
 * rule with a check rather than a habit.
 *
 * **A run is the siblings of one indent.** Subordinate entries are stepped
 * over rather than treated as a break, because they are a column of their own:
 * the `88`s under a status field, and the `10`s under an `OCCURS`, line up with
 * each other while the `05`s around them go on lining up with each other. A
 * record whose fields are interrupted by a condition name is still one record,
 * and splitting it into three columns is the defect this replaced.
 *
 * **After reference format, and it must stay that way.** Every line of a
 * generated program goes through `toReferenceFormat` as it is emitted, because
 * the source map is written against the line numbers that produces. This pass
 * rewrites lines in place and never adds or removes one. Where the column it
 * wants would put an entry past column 72 that entry falls back to a single
 * space, which is what the fixed column used to give an over-long name: the
 * margin is not negotiable and the rest of the run still lines up.
 */

import { COBOL_LAST_COLUMN } from "./reference-format";

/** Column 7, zero-based: the indicator area, where a `*` marks a comment. */
const INDICATOR_AREA = 6;

/**
 * One data description entry, split where the padding goes.
 *
 * `head` is the indent, the level number and the spaces after it; `tail` is
 * everything from the first clause onwards. Only the run of spaces between the
 * name and the tail is this pass's to change.
 */
interface Entry {
  at: number;
  indent: number;
  level: string;
  head: string;
  name: string;
  tail: string;
}

/**
 * A level number, a name, and at least one clause after it.
 *
 * The clause need not end on this line. An entry wide enough to wrap — a
 * picture carrying `SIGN IS LEADING SEPARATE` — is still one of its group's
 * fields, and leaving it out put a single unaligned line in the middle of an
 * otherwise square record. Its first line is padded like any other, and
 * `alignRun` will not move it past the margin.
 */
const ENTRY = /^(\s+)(\d{2})(\s\s+)([A-Z0-9][A-Z0-9-]*)\s+(\S.*)$/;

/** A level number and a name with nothing after it: a group item. */
const GROUP = /^(\s+)(\d{2})\s\s+[A-Z0-9][A-Z0-9-]*\b/;

/** A DATA DIVISION section header, which says whether entries here align. */
const SECTION = /^\s+([A-Z-]+)\s+SECTION\s*\.\s*$/;

/**
 * The gutter between the longest name in a run and the clause beside it.
 *
 * One space is what the margin can always afford and what a name that overruns
 * its column falls back to. Two is what makes a column read as one: the
 * pictures of a record stand clear of its names rather than butting against
 * the longest of them.
 */
const GUTTER = 2;

/** The levels a data description entry may carry: 01-49, 66, 77 and 88. */
function isDataLevel(level: string): boolean {
  const value = Number(level);
  return (
    (value >= 1 && value <= 49) || value === 66 || value === 77 || value === 88
  );
}

function parse(line: string, at: number): Entry | null {
  const match = ENTRY.exec(line);
  if (!match || !isDataLevel(match[2]!)) {
    return null;
  }
  return {
    at,
    indent: match[1]!.length,
    level: match[2]!,
    head: `${match[1]!}${match[2]!}${match[3]!}`,
    name: match[4]!,
    tail: match[5]!,
  };
}

/** The indent and level of a data description entry, group items included. */
function positionOf(line: string): { indent: number; level: string } | null {
  const match = GROUP.exec(line);
  return match && isDataLevel(match[2]!)
    ? { indent: match[1]!.length, level: match[2]! }
    : null;
}

/**
 * The indent of a line that carries no level number, or null for one that
 * cannot be a continuation.
 *
 * A comment is never one: `*` sits in the indicator area at column 7, and a
 * comment between two fields is a break a person put there.
 */
function continuationIndent(line: string): number | null {
  if (line.trim() === "" || line[INDICATOR_AREA] === "*") {
    return null;
  }
  return /^(\s*)/.exec(line)![1]!.length;
}

export function alignPictureColumns(lines: string[]): string[] {
  const output = [...lines];
  // Every entry belongs to exactly one run. A subordinate stepped over by its
  // parents' run still forms a run with its own siblings when it is reached,
  // which is what gives the `88`s under a status field a column of their own.
  const aligned = new Set<number>();
  // A copybook is a record and nothing else, so it starts aligned.
  let alignable = true;

  for (let start = 0; start < output.length; start += 1) {
    const section = SECTION.exec(output[start]!);
    if (section) {
      // Not the REPORT SECTION. Its entries are not data descriptions: an `01`
      // there may carry `TYPE IS PAGE HEADING` with no name at all, and a
      // `COLUMN 1 PIC X(22)` puts a number where a name goes. Reading those as
      // "name, then clause" produced `01  TYPE            IS PAGE HEADING.`
      alignable = section[1] !== "REPORT";
      continue;
    }
    const first = parse(output[start]!, start);
    if (!first || !alignable || aligned.has(start)) {
      continue;
    }

    const run: Entry[] = [first];
    for (let cursor = start + 1; cursor < output.length; cursor += 1) {
      const position = positionOf(output[cursor]!);
      if (!position) {
        // A clause of the entry above, on a line of its own: the `INDEXED BY`
        // under an `OCCURS`, a `COPY` under a group. It carries no name to
        // align and must not split the fields on either side of it — that is
        // what put a record's `05`s into two columns either side of a table.
        const continuation = continuationIndent(output[cursor]!);
        if (continuation !== null && continuation > first.indent) {
          continue;
        }
        // Anything else — a comment, a blank line, an `FD`, a section header,
        // the PROCEDURE DIVISION — ends the run.
        break;
      }
      // Subordinate to the run: a column of its own, stepped over so that the
      // siblings on either side of it stay in one column.
      if (position.indent > first.indent) {
        continue;
      }
      // A shallower entry closes the group this run is inside. So does one at
      // the same indent under a different level number, which is not a
      // sibling however it is laid out.
      if (position.indent < first.indent || position.level !== first.level) {
        break;
      }
      // A group item has no picture to line up, and does not break the fields
      // around it: a record interrupted by an `OCCURS` is still one record.
      const sibling = parse(output[cursor]!, cursor);
      if (sibling) {
        run.push(sibling);
      }
    }

    for (const entry of alignRun(run)) {
      output[entry.at] = entry.line;
      aligned.add(entry.at);
    }
  }

  return output;
}

/** One run of siblings, repadded to a column as many of them can reach. */
function alignRun(run: Entry[]): { at: number; line: string }[] {
  const column =
    Math.max(...run.map((entry) => entry.name.length)) + GUTTER - 1;

  return run.map((entry) => {
    // What this entry can afford: its own line still has to end inside the
    // margin. An entry that cannot reach the column keeps one space, rather
    // than the run being pulled back to the widest line in it.
    const room = COBOL_LAST_COLUMN - entry.head.length - 1 - entry.tail.length;
    const width = Math.min(column, Math.max(room, entry.name.length));
    return {
      at: entry.at,
      line: `${entry.head}${entry.name.padEnd(width)} ${entry.tail}`,
    };
  });
}
