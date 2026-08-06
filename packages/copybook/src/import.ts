/**
 * A production copybook read back into a BankTS record.
 *
 * This is the difference between a compiler for greenfield programs and one
 * that works with an estate. Every bank's records already exist, in copybooks
 * that other programs share, and a language that can only describe records it
 * invented cannot be used on the same data as the programs beside it. The
 * 2026-08-05 audit called it "the single most valuable missing feature".
 *
 * What makes it safe rather than approximate is the round trip. A record
 * imported from a copybook is emitted back to a copybook, and the two are
 * compared field by field: the same names, in the same order, at the same
 * offsets, with the same lengths and the same pictures. A field this reads
 * wrongly moves an offset, and an offset that moves is a program reading
 * somebody else's data — so anything that does not survive the round trip is
 * reported rather than imported, and the import fails.
 *
 * The COBOL a copybook may contain is much larger than what BankTS can say.
 * Where a clause has no BankTS spelling, the field is reported by name with
 * what stopped it, and the caller decides. Reporting is the whole point: an
 * importer that silently drops a clause produces a record that lays out
 * differently from the one every other program on the estate is using.
 */

import type { CopybookInspection } from "./index";

export interface CopybookImportProblem {
  /** COBOL name of the entry the problem is with, or the copybook itself. */
  field: string;
  message: string;
}

export interface CopybookImport {
  /** BankTS record declarations, outermost last, ready to paste into a module. */
  source: string;
  /** The record's BankTS name. */
  recordName: string;
  /** What could not be represented. A non-empty list means `source` is a draft. */
  problems: CopybookImportProblem[];
}

/** One data description entry, as the copybook wrote it. */
interface Entry {
  level: number;
  name: string;
  /** Everything after the name, with runs of whitespace collapsed. */
  clauses: string;
  children: Entry[];
}

/**
 * Split a copybook into entries.
 *
 * Reference format is assumed, because that is what a z/OS copybook is: column
 * 7 is the indicator area, so a `*` or `/` there is a comment and everything
 * from column 73 is the identification area and not part of the text. A
 * copybook written in free format — which some tools now produce — is read the
 * same way as long as nothing sits in the first seven columns, which is the
 * common case.
 */
function readEntries(text: string): Entry[] {
  const statements: string[] = [];
  let pending: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.length > 72 ? raw.slice(0, 72) : raw;
    if (line.length >= 7 && (line[6] === "*" || line[6] === "/")) {
      continue;
    }
    const body = (line.length > 6 ? line.slice(6) : line).trim();
    if (body === "" || body.startsWith("*")) {
      continue;
    }
    pending.push(body);
    if (body.endsWith(".")) {
      statements.push(
        pending.join(" ").replace(/\s+/g, " ").replace(/\.$/, ""),
      );
      pending = [];
    }
  }
  if (pending.length > 0) {
    statements.push(pending.join(" ").replace(/\s+/g, " "));
  }

  const flat: Entry[] = [];
  for (const statement of statements) {
    // `EJECT`, `SKIP1` and their relatives are compiler directives that carry
    // no data, and a copybook may open with any of them.
    if (/^(EJECT|SKIP[123]|TITLE\b)/i.test(statement)) {
      continue;
    }
    const match = /^(\d{1,2})\s+([A-Z0-9$#@-]+)\s*(.*)$/i.exec(statement);
    if (!match) {
      throw new Error(`Not a data description entry: ${statement}`);
    }
    flat.push({
      level: Number(match[1]),
      name: match[2]!.toUpperCase(),
      clauses: match[3]!.trim(),
      children: [],
    });
  }

  return nest(flat);
}

/** Turn the flat list into the tree the level numbers describe. */
function nest(flat: Entry[]): Entry[] {
  const roots: Entry[] = [];
  const stack: Entry[] = [];

  for (const entry of flat) {
    // A condition name belongs to the entry above it whatever its level looks
    // like, and a level-66 renames storage that is already accounted for.
    if (entry.level === 88 || entry.level === 66) {
      (stack[stack.length - 1] ?? { children: roots }).children.push(entry);
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1]!.level >= entry.level) {
      stack.pop();
    }
    (stack[stack.length - 1]?.children ?? roots).push(entry);
    stack.push(entry);
  }

  return roots;
}

/** A COBOL name as a BankTS one: `ACCOUNT-ID` becomes `accountId`. */
export function bankTsName(cobolName: string): string {
  const parts = cobolName
    .toLowerCase()
    .split(/[-_]/)
    .filter((part) => part.length > 0);
  return parts
    .map((part, index) =>
      index === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`,
    )
    .join("");
}

/** A COBOL name as a BankTS record name: `ACCOUNT-REC` becomes `AccountRec`. */
export function bankTsRecordName(cobolName: string): string {
  const name = bankTsName(cobolName);
  return `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
}

/** What a PICTURE and USAGE say, in the terms BankTS has words for. */
interface FieldType {
  text: string;
  problem?: string;
}

/** The digit count a picture describes, expanding `9(4)` and counting `99`. */
function countSymbol(picture: string, symbol: string): number {
  const pattern = new RegExp(`${symbol}(?:\\((\\d+)\\))?`, "gi");
  let total = 0;
  for (const match of picture.matchAll(pattern)) {
    total += match[1] ? Number(match[1]) : 1;
  }
  return total;
}

/**
 * How many bytes a `FILLER` occupies.
 *
 * `reserved <n>` counts bytes, not digits, so this cannot go through `typeFor`:
 * `PIC S9(9) COMP-3` is nine digits and five bytes, and reserving nine would
 * move every field after it four bytes along. Returns null when the entry is
 * something whose storage this importer will not guess at — which is the right
 * answer, because a guess here is a record that lays out wrong and compiles.
 */
function fillerBytes(entry: Entry): number | null {
  const text = entry.clauses.toUpperCase();
  const pictureMatch = /\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)/.exec(text);
  if (!pictureMatch) {
    return null;
  }
  const picture = pictureMatch[1]!.replace(/\.$/, "");

  if (/[AXN]/.test(picture)) {
    const bytes =
      countSymbol(picture, "X") +
      countSymbol(picture, "A") +
      // A national character is two bytes.
      countSymbol(picture, "N") * 2;
    return bytes > 0 ? bytes : null;
  }

  const digits = countSymbol(picture, "9");
  if (digits === 0) {
    return null;
  }

  if (/\bCOMP-3\b|\bCOMPUTATIONAL-3\b|\bPACKED-DECIMAL\b/.test(text)) {
    // Packed decimal: two digits to a byte, plus a nibble for the sign.
    return Math.ceil((digits + 1) / 2);
  }
  if (/\bCOMP-1\b|\bCOMPUTATIONAL-1\b/.test(text)) {
    return 4;
  }
  if (/\bCOMP-2\b|\bCOMPUTATIONAL-2\b/.test(text)) {
    return 8;
  }
  if (/\bCOMP(?:UTATIONAL)?(?:-[45])?\b/.test(text)) {
    // Binary, sized by the digit count the picture declares.
    return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  }

  // DISPLAY: one byte a digit, and one more for a separate sign.
  return digits + (/\bSEPARATE\b/.test(text) ? 1 : 0);
}

/**
 * The BankTS type for one elementary entry.
 *
 * Usage decides the storage and the picture decides the digits, which is how
 * COBOL reads it too. A picture this cannot express is reported by name rather
 * than approximated: a field imported at the wrong length moves every field
 * after it.
 */
export function typeFor(clauses: string): FieldType {
  const text = clauses.toUpperCase();
  const pictureMatch = /\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)/.exec(text);
  if (!pictureMatch) {
    return { text: "", problem: "No PICTURE clause." };
  }
  const picture = pictureMatch[1]!;

  if (/^S?[9SVP()0-9]*$/i.test(picture) === false && /[AXN]/i.test(picture)) {
    // Alphanumeric, alphabetic or national. `X` and `A` are one byte each and
    // `N` is two, which is what `string` and `national` already mean.
    const national = /N/i.test(picture) && !/[AX9]/i.test(picture);
    const length =
      countSymbol(picture, "X") +
      countSymbol(picture, "A") +
      countSymbol(picture, "N");
    if (length === 0) {
      return { text: "", problem: `Cannot size the picture ${picture}.` };
    }
    return { text: `${national ? "national" : "string"}<${length}>` };
  }

  // An edited picture formats a number for printing. Its symbols decide the
  // width, and BankTS describes the two styles it can generate rather than an
  // arbitrary one, so anything else is reported.
  if (
    /[Z*$+\-,B/]/.test(picture) &&
    !/^S?9+(\(\d+\))?V?9*(\(\d+\))?$/.test(picture)
  ) {
    return {
      text: "",
      problem: `The edited picture ${picture} has no BankTS spelling. Declare it as an \`edited<...>\` field by hand, or as \`string<n>\` if the program only moves it.`,
    };
  }

  const integer = countSymbol(picture.split("V")[0] ?? "", "9");
  const scale = picture.includes("V")
    ? countSymbol(picture.split("V")[1] ?? "", "9")
    : 0;
  const digits = integer + scale;
  if (digits === 0) {
    return { text: "", problem: `Cannot size the picture ${picture}.` };
  }
  if (digits > 18) {
    return {
      text: "",
      problem: `${digits} digits, and ARITH(COMPAT) allows 18. The field is wider than any BankTS numeric type.`,
    };
  }

  if (/\bCOMP-3\b|\bCOMPUTATIONAL-3\b|\bPACKED-DECIMAL\b/.test(text)) {
    return { text: `decimal<${digits}, ${scale}>` };
  }
  if (/\bCOMP-5\b|\bCOMPUTATIONAL-5\b/.test(text)) {
    return scale === 0
      ? { text: `native<${digits}>` }
      : {
          text: "",
          problem: "A COMP-5 field with a scale has no BankTS type.",
        };
  }
  // Before the plain COMP test: `\bCOMP\b` matches the head of `COMP-1` too,
  // and reading a floating-point field as a binary integer is exactly the kind
  // of silent misreading this importer exists to refuse.
  if (/\bCOMP-1\b|\bCOMP-2\b|\bCOMPUTATIONAL-[12]\b/.test(text)) {
    return {
      text: "",
      problem:
        "Floating point. A bank's arithmetic is decimal, and BankTS has no floating-point type.",
    };
  }
  if (/\bCOMP(?:UTATIONAL)?(?:-4)?\b|\bBINARY\b/.test(text)) {
    return scale === 0
      ? { text: `binary<${digits}>` }
      : {
          text: "",
          problem: "A binary field with a scale has no BankTS type.",
        };
  }

  // No usage clause means DISPLAY. Which of the two display forms it is comes
  // from the picture: an `S` is a sign the field carries, and without one the
  // field is `PIC 9(n)` — one byte per digit and nothing spent on a sign it
  // cannot hold, which is what most dates, counts and codes on an estate are.
  if (!/^S/i.test(picture)) {
    return { text: `unsigned<${digits}, ${scale}>` };
  }
  if (!/\bSIGN\b/.test(text) || !/\bSEPARATE\b/.test(text)) {
    return {
      text: "",
      problem: `${picture} carries its sign as an overpunch on the last digit. BankTS's \`zoned\` is SIGN IS TRAILING SEPARATE, which is one byte wider, so importing this would move every field after it.`,
    };
  }
  if (!/\bTRAILING\b/.test(text)) {
    return {
      text: "",
      problem: `${picture} carries SIGN IS LEADING SEPARATE. BankTS's \`zoned\` is trailing, and the two put the sign in different bytes.`,
    };
  }
  return { text: `zoned<${digits}, ${scale}>` };
}

export interface ImportOptions {
  /** Name for the imported record, when the copybook's own is not wanted. */
  recordName?: string;
}

export function importCopybook(
  text: string,
  options: ImportOptions = {},
): CopybookImport {
  const roots = readEntries(text);
  const record = roots.find((entry) => entry.level === 1);
  if (!record) {
    throw new Error("The copybook declares no 01-level record.");
  }

  const problems: CopybookImportProblem[] = [];
  const nested: string[] = [];

  /** One field line, and any record the field's own group needs. */
  const fieldFor = (entry: Entry, within: string): string | null => {
    const name = bankTsName(entry.name);
    const clauses = entry.clauses.toUpperCase();

    // `FILLER` is space nothing names, and `reserved <n>;` is how BankTS says
    // it. The bytes are what matter: a record imported without them lays out
    // short, and every field after the gap is at the wrong offset — which is
    // the one failure a copybook exists to prevent.
    //
    // A FILLER with no PICTURE is a group of them, and its members are
    // imported on their own; only an elementary one becomes a slot.
    if (entry.name === "FILLER") {
      const bytes = fillerBytes(entry);
      if (bytes === null) {
        problems.push({
          field: `${within}.FILLER`,
          message:
            "A FILLER whose length cannot be worked out from its PICTURE would leave every field after it at the wrong offset.",
        });
        return null;
      }
      return `  reserved ${bytes};`;
    }

    const occurs = /\bOCCURS\s+(?:(\d+)\s+TO\s+)?(\d+)(?:\s+TIMES)?/.exec(
      clauses,
    );
    const dependingOn = /\bDEPENDING\s+(?:ON\s+)?([A-Z0-9$#@-]+)/.exec(clauses);
    const ascending = /\bASCENDING\s+(?:KEY\s+)?(?:IS\s+)?([A-Z0-9$#@-]+)/.exec(
      clauses,
    );
    const redefines = /\bREDEFINES\s+([A-Z0-9$#@-]+)/.exec(clauses);

    // A group item is a record of its own, declared before the one that holds
    // it so the reference resolves.
    const elementary = /\bPIC(?:TURE)?\b/.test(clauses);
    let type: string;
    if (elementary) {
      const resolved = typeFor(entry.clauses);
      if (resolved.problem) {
        problems.push({
          field: `${within}.${entry.name}`,
          message: resolved.problem,
        });
        return null;
      }
      type = resolved.text;
    } else {
      const groupName = bankTsRecordName(entry.name);
      nested.push(renderRecord(groupName, entry, `${within}.${entry.name}`));
      type = groupName;
    }

    const suffix = [
      occurs ? `[${occurs[2]}]` : "",
      redefines ? ` redefines ${bankTsName(redefines[1]!)}` : "",
      /\bSYNCHRONIZED\b|\bSYNC\b/.test(clauses) ? " sync" : "",
      /\bJUSTIFIED\b|\bJUST\b/.test(clauses) ? " justified" : "",
      /\bBLANK\s+WHEN\s+ZERO\b/.test(clauses) ? " blankWhenZero" : "",
      dependingOn ? ` depending on ${bankTsName(dependingOn[1]!)}` : "",
      ascending ? ` ascending ${bankTsName(ascending[1]!)}` : "",
    ].join("");

    // A VALUE on an imported field is what the copybook says the field starts
    // as, and dropping it would change what a program reading this record sees
    // before anything writes to it.
    const value = /\bVALUE\s+(?:IS\s+)?('[^']*'|"[^"]*"|[^\s.]+)/.exec(clauses);
    const initial =
      value && !/\bTHRU\b|\bTHROUGH\b/.test(clauses)
        ? ` = ${value[1]!.replace(/^'(.*)'$/, '"$1"')}`
        : "";

    return `  ${name}: ${type}${suffix}${initial};`;
  };

  const renderRecord = (name: string, entry: Entry, path: string): string => {
    const fields = entry.children
      .filter((child) => child.level !== 88 && child.level !== 66)
      .flatMap((child) => {
        const line = fieldFor(child, path);
        return line ? [line] : [];
      });

    for (const child of entry.children) {
      if (child.level === 66) {
        const renames =
          /\bRENAMES\s+([A-Z0-9$#@-]+)(?:\s+THRU\s+([A-Z0-9$#@-]+))?/i.exec(
            child.clauses,
          );
        if (renames) {
          fields.push(
            `  ${bankTsName(child.name)} renames ${bankTsName(renames[1]!)}${
              renames[2] ? ` through ${bankTsName(renames[2])}` : ""
            };`,
          );
        }
      }
    }

    return `record ${name} {\n${fields.join("\n")}\n}`;
  };

  const recordName = options.recordName ?? bankTsRecordName(record.name);
  const top = renderRecord(recordName, record, record.name);

  return {
    source: [...nested, top].join("\n\n"),
    recordName,
    problems,
  };
}

/**
 * A picture as what it describes rather than as how it was written.
 *
 * `PIC X(04)` and `PIC X(4)` are the same thirty-two bits of contract, and so
 * are `COMP` and `COMPUTATIONAL`. The comparison below is about the bytes a
 * record occupies, so the spelling is expanded away first: every repeat count
 * becomes the characters it stands for, and each usage word becomes the one
 * name this compiler writes.
 */
export function normalisePicture(picture: string): string {
  return picture
    .toUpperCase()
    .replace(/\bCOMPUTATIONAL-3\b|\bPACKED-DECIMAL\b/g, "COMP-3")
    .replace(/\bCOMPUTATIONAL-5\b/g, "COMP-5")
    .replace(/\bCOMPUTATIONAL(?:-4)?\b|\bBINARY\b/g, "COMP")
    .replace(
      /([A-Z9$*+\-,./])\((\d+)\)/g,
      (_all, symbol: string, count: string) => symbol.repeat(Number(count)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The two layouts, compared field by field.
 *
 * A copybook is a contract about bytes, so this is what "the import worked"
 * means: the same names in the same order at the same offsets with the same
 * lengths and pictures. Spacing is not part of the contract and is not
 * compared.
 */
export function compareLayouts(
  original: CopybookInspection,
  regenerated: CopybookInspection,
): CopybookImportProblem[] {
  const problems: CopybookImportProblem[] = [];

  if (original.totalLength !== regenerated.totalLength) {
    problems.push({
      field: original.cobolName,
      message: `The copybook is ${original.totalLength} bytes and the imported record is ${regenerated.totalLength}.`,
    });
  }

  const byName = new Map(
    regenerated.fields.map((field) => [field.cobolName, field]),
  );
  for (const field of original.fields) {
    const other = byName.get(field.cobolName);
    if (!other) {
      problems.push({
        field: field.cobolName,
        message: "Present in the copybook and absent from the imported record.",
      });
      continue;
    }
    if (field.offset !== other.offset || field.length !== other.length) {
      problems.push({
        field: field.cobolName,
        message: `At offset ${field.offset} for ${field.length} bytes in the copybook, and at ${other.offset} for ${other.length} in the imported record.`,
      });
      continue;
    }
    if (normalisePicture(field.picture) !== normalisePicture(other.picture)) {
      problems.push({
        field: field.cobolName,
        message: `${field.picture} in the copybook and ${other.picture} in the imported record.`,
      });
    }
  }

  const originalNames = new Set(
    original.fields.map((field) => field.cobolName),
  );
  for (const field of regenerated.fields) {
    if (!originalNames.has(field.cobolName)) {
      problems.push({
        field: field.cobolName,
        message: "Present in the imported record and absent from the copybook.",
      });
    }
  }

  return problems;
}
