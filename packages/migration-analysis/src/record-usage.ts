/**
 * How real COBOL uses more than one record description per file.
 *
 * BankTS allows exactly one record per file and says so as `BANK-FILE-002`.
 * Whether that restriction is a safety property or a hole depends on a number
 * nobody in this repository had: how much real COBOL declares two or more `01`
 * entries under one `FD`, and what those entries are for. Two CobolCodeBench
 * tasks want the feature, and two benchmark tasks are not a reason to add
 * anything to a language.
 *
 * So this counts the shapes rather than the keyword, because "an FD with three
 * records" is at least four different problems:
 *
 * - **Variants.** Header, detail and trailer, told apart by a field at a fixed
 *   offset. A real business-file pattern, and the one BankTS would have to
 *   express safely.
 * - **Overlays.** One layout and a `REDEFINES` of it, which is a second reading
 *   of the same bytes rather than a second kind of record. BankTS already has
 *   `redefines`.
 * - **Padding.** A short `01 FILLER PIC X(n)` beside the real record, which is
 *   a way of declaring a record area rather than a variant at all.
 * - **Copybooks.** `COPY` under the FD, where what the records are cannot be
 *   read from this file.
 *
 * Detection rather than parsing, for the reason the rest of this package gives:
 * these files do not compile without copybooks nobody has. Every pattern is
 * anchored on the line structure of a data description entry, and anything
 * ambiguous is counted in its own bucket rather than assigned to a guess.
 */

import { contentDigest, sourceLines } from "./features";

/** One `FD`, as much of it as can be read without the copybooks. */
export interface FileRecordShape {
  /** The FD's own name. */
  file: string;
  /** `01`-level entries under it, in order. */
  records: string[];
  /** How many of those carry `REDEFINES`. */
  redefining: number;
  /** A `COPY` inside the FD, so the record layout is not in this file. */
  copybook: boolean;
  /** `RECORD IS VARYING` or `RECORD CONTAINS n TO m`. */
  varyingLength: boolean;
  /** Every record is `FILLER`, or a single `PIC X(n)` with no fields. */
  elementaryOnly: boolean;
  /** The records share the name of their first subordinate field. */
  sharedLeadingField: boolean;
  /**
   * A record after the first starts with `FILLER`.
   *
   * The COBOL idiom for a variant file: the first record names the
   * discriminator and the others overlay those bytes with `FILLER` because
   * they have no use for them. `BDS1003.cbl` in the corpus is exactly this —
   * `InsertionRec` carries `TypeCode-TF` with its `88`s, and `DeletionRec`
   * begins `02 FILLER PIC 9(7)`. A shared *name* would miss it entirely.
   */
  leadingFiller: boolean;
  /** An `88` level under one of the records: a named value of a discriminator. */
  conditionNames: boolean;
  /** Byte length of each record, or null where a picture could not be read. */
  lengths: (number | null)[];
  /** How the program opens the file, from its `OPEN` statements. */
  modes: string[];
}

export interface RecordUsage {
  /** Files read that contain at least one `FD`. */
  files: number;
  /** Files containing at least one FD with more than one record. */
  filesWithMultiRecord: number;
  fileDescriptions: number;
  multiRecord: number;
  /** FDs by record count: `"1"`, `"2"`, `"3"`, `"4"`, `"5+"`. */
  recordsPerFile: Record<string, number>;

  /* --- what the several records are, among the multi-record FDs --- */

  /** At least one record is a `REDEFINES` of another: an overlay. */
  overlay: number;
  /** The layouts come from a `COPY`, so this file does not say what they are. */
  copybookDefined: number;
  /** Every record is an elementary item or `FILLER`: a record area, not variants. */
  elementaryOnly: number;
  /**
   * The records are told apart by a field: a shared leading name, a `FILLER`
   * overlaying the discriminator, or an `88` naming its values.
   */
  discriminated: number;
  /** `RECORD IS VARYING` or `RECORD CONTAINS n TO m`: the variants differ in size. */
  varyingLength: number;
  /** Multi-record FDs whose records are all the same measured length. */
  sameLength: number;
  /** Multi-record FDs whose measured lengths differ. */
  differentLength: number;
  /** Multi-record FDs where a picture could not be read, so length is unknown. */
  unmeasuredLength: number;
  /** Multi-record FDs the program opens `INPUT` — the ones a READ must narrow. */
  openedInput: number;
  /** Multi-record FDs the program opens `OUTPUT` or `EXTEND`. */
  openedOutput: number;
  /** Multi-record FDs opened `I-O`. */
  openedIo: number;
  /**
   * None of the above — several named layouts, no overlay, no copybook, no
   * shared leading field. The residue, and the honest size of "variants this
   * analyser could not classify".
   */
  unclassified: number;

  /* --- how the program works with them --- */

  /** `READ f INTO x`, which copies the record area into working storage. */
  readInto: number;
  /** `WRITE r FROM x`, the same on the way out. */
  writeFrom: number;
  /** `WRITE r` naming a record of a multi-record FD: choosing a variant. */
  writeOfVariant: number;
  /** Multi-record FDs whose records are all written by name at least once. */
  everyVariantWritten: number;

  /**
   * Repositories contributing an FD with several *structured* records.
   *
   * The deciding number. A pattern found in one teaching repository is not an
   * estate pattern however many times that repository repeats it, and the
   * print-file idiom — two elementary records, same length, opened OUTPUT —
   * is 93% of every multi-record FD in this corpus.
   */
  variantRepositories: string[];
  /** Repositories contributing a multi-record FD opened INPUT. */
  inputVariantRepositories: string[];
  /**
   * Digests of the distinct file *contents* holding a multi-record FD opened
   * INPUT.
   *
   * The FD count is the wrong denominator for "how common is this", because
   * X-COBOL gathers 168 repositories and a program vendored into five of them
   * is five FDs. 143 multi-record INPUT FDs are 51 distinct file contents, and
   * the distinct ones concentrate in language tooling: parser and grammar
   * fixtures, two compiler test suites, and the NIST CCVS85 conformance suite.
   * Counting files rather than descriptions is what makes that visible.
   */
  inputVariantContents: string[];

  /** The shapes themselves, capped, so a reader can check the counts. */
  examples: FileRecordShape[];
}

export function emptyRecordUsage(): RecordUsage {
  return {
    files: 0,
    filesWithMultiRecord: 0,
    fileDescriptions: 0,
    multiRecord: 0,
    recordsPerFile: {},
    overlay: 0,
    copybookDefined: 0,
    elementaryOnly: 0,
    discriminated: 0,
    varyingLength: 0,
    sameLength: 0,
    differentLength: 0,
    unmeasuredLength: 0,
    openedInput: 0,
    openedOutput: 0,
    openedIo: 0,
    unclassified: 0,
    variantRepositories: [],
    inputVariantRepositories: [],
    inputVariantContents: [],
    readInto: 0,
    writeFrom: 0,
    writeOfVariant: 0,
    everyVariantWritten: 0,
    examples: [],
  };
}

/** How many shapes to keep, so the evidence file stays a file. */
const EXAMPLE_LIMIT = 40;

/**
 * Clauses saying the records are not all the same length.
 *
 * `RECORDING MODE IS V` is IBM's way of saying it and is what the corpus's
 * variant files actually carry — `RECORD IS VARYING` is the standard's.
 * `RECORDING MODE IS F` must not match, which is why the alternation is
 * anchored on the letter.
 */
const VARYING =
  /RECORD\s+(IS\s+)?VARYING|RECORD\s+CONTAINS\s+\d+\s+TO\s+\d+|RECORDING\s+MODE\s+(IS\s+)?V\b/;

/** `FD  NAME` or `SD  NAME` — the start of a file description. */
const FD_START = /^\s*(FD|SD)\s+([A-Z0-9][A-Z0-9-]*)/;

/** A data description entry, with its level and name. */
const ENTRY = /^\s*(\d{1,2})\s+([A-Z0-9][A-Z0-9-]*|FILLER)\b(.*)$/;

/** Anything that ends the FILE SECTION or the entry list of one FD. */
const SECTION_END =
  /^\s*(WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|REPORT|COMMUNICATION|SCREEN)\s+SECTION|^\s*PROCEDURE\s+DIVISION/;

/**
 * The `FD`s of one program, with what can be read of their records.
 *
 * The FD's own clauses run to the first period; the record entries follow it
 * until the next `FD`, `SD` or section header. Both are found by line shape
 * rather than by parsing, so a continuation of a clause across lines is read as
 * part of the clause and a `01` in area A starts a record.
 */
export function fileRecordShapes(text: string): FileRecordShape[] {
  const lines = sourceLines(text);
  const modes = openModes(lines);
  const shapes: FileRecordShape[] = [];
  let current: FileRecordShape | null = null;
  /** Subordinate field names of each record, first only. */
  let leading: (string | null)[] = [];
  /** True while still inside the FD's own clauses, before their period. */
  let inClauses = false;

  const close = (): void => {
    if (current) {
      current.sharedLeadingField =
        leading.length > 1 &&
        leading[0] !== null &&
        leading.every((name) => name !== null && name === leading[0]);
      current.leadingFiller = leading
        .slice(1)
        .some((name) => name === "FILLER");
      current.modes = modes.get(current.file) ?? [];
      shapes.push(current);
    }
    current = null;
    leading = [];
    inClauses = false;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const start = FD_START.exec(line);
    if (start) {
      close();
      current = {
        file: start[2] ?? "",
        records: [],
        redefining: 0,
        copybook: false,
        varyingLength: VARYING.test(line),
        elementaryOnly: true,
        sharedLeadingField: false,
        leadingFiller: false,
        conditionNames: false,
        lengths: [],
        modes: [],
      };
      inClauses = !line.includes(".");
      continue;
    }
    if (!current) {
      continue;
    }
    if (SECTION_END.test(line)) {
      close();
      continue;
    }
    if (inClauses) {
      if (VARYING.test(line)) {
        current.varyingLength = true;
      }
      if (line.includes(".")) {
        inClauses = false;
      }
      continue;
    }
    if (/^\s*COPY\s+/.test(line)) {
      current.copybook = true;
      continue;
    }
    const entry = ENTRY.exec(line);
    if (!entry) {
      continue;
    }
    const level = Number(entry[1]);
    const name = entry[2] ?? "";
    const rest = entry[3] ?? "";
    if (level === 88) {
      current.conditionNames = true;
      continue;
    }
    if (level === 1) {
      current.records.push(name);
      leading.push(null);
      current.lengths.push(pictureLength(rest));
      if (/\bREDEFINES\b/.test(rest)) {
        current.redefining += 1;
      }
      // An `01` with no PICTURE has subordinate fields; one with a PICTURE is
      // the whole record and has none. Either way the next `05` decides.
      continue;
    }
    if (current.records.length > 0) {
      const at = current.records.length - 1;
      if (leading[at] === null || leading[at] === undefined) {
        // The first subordinate field, which is where a discriminator lives.
        // `elementaryOnly` becomes false the moment one exists, and the
        // running length restarts from this field rather than from the `01`'s
        // own (absent) picture.
        current.elementaryOnly = false;
        leading[at] = name;
        current.lengths[at] = 0;
      }
      const running = current.lengths[at];
      const field = pictureLength(rest);
      // A group's length is the sum of its elementary items. `OCCURS` and
      // `REDEFINES` make that arithmetic wrong, and a wrong length reported as
      // a length is worse than none, so the record is left unmeasured.
      current.lengths[at] =
        running === null || running === undefined || field === null
          ? null
          : /\bOCCURS\b|\bREDEFINES\b/.test(rest)
            ? null
            : running + field;
    }
  }
  close();
  return shapes;
}

/**
 * Bytes an entry's `PICTURE` occupies, or null when it has none or cannot be
 * read.
 *
 * A group entry has no picture and returns null, which is why the caller
 * restarts the sum at the first subordinate field rather than at the `01`.
 */
function pictureLength(clauses: string): number | null {
  const picture = /\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)/.exec(clauses);
  if (!picture) {
    return null;
  }
  // The period that ends the entry is not a picture position. `PIC X(121).`
  // measured as 122 and every record in the corpus was one byte long, which is
  // the kind of error a measurement nobody tested makes and nobody sees.
  // Only the last one: `ZZ,ZZ9.99` has a period of its own that is a position.
  const expanded = (picture[1] ?? "")
    .replace(/\.$/, "")
    .replace(/([A-Z9])\((\d+)\)/g, (_, symbol: string, count: string) =>
      symbol.repeat(Number(count)),
    );
  if (/[^AXN9SVPZ,./+\-*$BCR0DB]/.test(expanded)) {
    return null;
  }
  const digits = (expanded.match(/9/g) ?? []).length;
  if (/\bCOMP-3\b|\bPACKED-DECIMAL\b/.test(clauses)) {
    return Math.floor(digits / 2) + 1;
  }
  if (/\bCOMP\b|\bCOMP-4\b|\bBINARY\b/.test(clauses)) {
    return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  }
  // `S` and `V` are implied, not stored; `P` is a scaling position with no
  // storage of its own either.
  return expanded.replace(/[SVP]/g, "").length || null;
}

/** `OPEN INPUT A B OUTPUT C` — every file, with how it was opened. */
function openModes(lines: string[]): Map<string, string[]> {
  const modes = new Map<string, string[]>();
  const add = (file: string, mode: string): void => {
    const existing = modes.get(file) ?? [];
    if (!existing.includes(mode)) {
      existing.push(mode);
    }
    modes.set(file, existing);
  };
  for (const line of lines) {
    if (!/\bOPEN\b/.test(line)) {
      continue;
    }
    let mode: string | null = null;
    for (const word of (line.split(/\bOPEN\b/)[1] ?? "").split(/[\s.,]+/)) {
      if (["INPUT", "OUTPUT", "I-O", "EXTEND"].includes(word)) {
        mode = word;
        continue;
      }
      if (mode && /^[A-Z0-9][A-Z0-9-]*$/.test(word)) {
        add(word, mode);
      }
    }
  }
  return modes;
}

/** `WRITE <name>` targets, which is how a program chooses a variant. */
function writeTargets(lines: string[]): { targets: string[]; from: number } {
  const targets: string[] = [];
  let from = 0;
  for (const line of lines) {
    const write = /\bWRITE\s+([A-Z0-9][A-Z0-9-]*)\b(.*)$/.exec(line);
    if (write) {
      targets.push(write[1] ?? "");
      if (/\bFROM\b/.test(write[2] ?? "")) {
        from += 1;
      }
    }
  }
  return { targets, from };
}

/** Adds one program's measurements to a running total. */
export function addRecordUsage(
  text: string,
  usage: RecordUsage,
  provenance: string | null = null,
): void {
  const shapes = fileRecordShapes(text);
  if (shapes.length === 0) {
    return;
  }
  const lines = sourceLines(text);
  usage.files += 1;
  usage.fileDescriptions += shapes.length;

  const multi = shapes.filter((shape) => shape.records.length > 1);
  if (multi.length > 0) {
    usage.filesWithMultiRecord += 1;
  }

  for (const shape of shapes) {
    const key = shape.records.length >= 5 ? "5+" : String(shape.records.length);
    usage.recordsPerFile[key] = (usage.recordsPerFile[key] ?? 0) + 1;
  }

  const { targets, from } = writeTargets(lines);
  usage.writeFrom += from;
  for (const line of lines) {
    if (/\bREAD\s+[A-Z0-9][A-Z0-9-]*(\s+NEXT|\s+RECORD)*\s+INTO\b/.test(line)) {
      usage.readInto += 1;
    }
  }

  for (const shape of multi) {
    usage.multiRecord += 1;

    // Ranked, so each multi-record FD lands in exactly one bucket and the
    // buckets add up to `multiRecord`. An overlay is an overlay even if its
    // records happen to share a field name.
    if (shape.redefining > 0) {
      usage.overlay += 1;
    } else if (shape.copybook) {
      usage.copybookDefined += 1;
    } else if (shape.elementaryOnly) {
      usage.elementaryOnly += 1;
    } else if (
      shape.sharedLeadingField ||
      shape.leadingFiller ||
      shape.conditionNames
    ) {
      usage.discriminated += 1;
    } else {
      usage.unclassified += 1;
    }

    if (shape.varyingLength) {
      usage.varyingLength += 1;
    }

    const measured = shape.lengths;
    if (measured.some((length) => length === null)) {
      usage.unmeasuredLength += 1;
    } else if (measured.every((length) => length === measured[0])) {
      usage.sameLength += 1;
    } else {
      usage.differentLength += 1;
    }

    if (shape.modes.includes("INPUT")) {
      usage.openedInput += 1;
      const digest = contentDigest(text);
      if (!usage.inputVariantContents.includes(digest)) {
        usage.inputVariantContents.push(digest);
      }
    }
    if (shape.modes.includes("OUTPUT") || shape.modes.includes("EXTEND")) {
      usage.openedOutput += 1;
    }
    if (shape.modes.includes("I-O")) {
      usage.openedIo += 1;
    }

    const written = shape.records.filter((record) => targets.includes(record));
    usage.writeOfVariant += written.length;
    if (written.length === shape.records.length) {
      usage.everyVariantWritten += 1;
    }

    // A structured variant file, as opposed to the print-file idiom.
    if (!shape.elementaryOnly && provenance) {
      if (!usage.variantRepositories.includes(provenance)) {
        usage.variantRepositories.push(provenance);
      }
      if (
        shape.modes.includes("INPUT") &&
        !usage.inputVariantRepositories.includes(provenance)
      ) {
        usage.inputVariantRepositories.push(provenance);
      }
    }

    if (usage.examples.length < EXAMPLE_LIMIT) {
      usage.examples.push(shape);
    }
  }
}
