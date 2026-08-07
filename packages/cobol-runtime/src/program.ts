/**
 * A compilation unit: one or more programs in one source file.
 *
 * The emitter puts a nested program after `END PROGRAM` when a BankTS function
 * has to be `RECURSIVE` — Enterprise COBOL gives a recursive program its own
 * `LOCAL-STORAGE`, and `WORKING-STORAGE` shared across invocations is exactly
 * the defect that made `5!` return `5` before this project ever ran a program.
 * So the unit is a list, not a single program, and each one keeps its own
 * storage sections.
 */

import { Cursor } from "./cursor";
import { parseDataEntries, type Field } from "./data";
import {
  StatementParser,
  type Paragraph,
  type UseProcedure,
} from "./statements";
import {
  CobolSyntaxError,
  CobolUnsupportedError,
  readFixedFormat,
  tokenize,
} from "./source";

export type Organization =
  "sequential" | "line-sequential" | "indexed" | "relative";

export interface FileControlEntry {
  /** The name the PROCEDURE DIVISION uses. */
  name: string;
  /** `ASSIGN TO` — a DD name on z/OS, a filename to GnuCOBOL. */
  assign: string;
  organization: Organization;
  access: "sequential" | "random" | "dynamic";
  recordKey: string | null;
  alternateKeys: { name: string; duplicates: boolean }[];
  /** The `FILE STATUS` item, which the generated code always declares. */
  status: string | null;
  /**
   * `SELECT OPTIONAL`, which changes what a missing dataset means.
   *
   * An OPTIONAL file that is not there opens successfully with file status 05
   * and behaves as an empty file, so the first READ hits AT END. Without it the
   * same OPEN is a 35. That is the difference between a restart file whose
   * absence means "start from the top" and one whose absence is a failure, and
   * `examples/end-of-day-settlement/post` turns on exactly that.
   */
  optional: boolean;
}

export interface FileDescription {
  name: string;
  records: Field[];
  /** The longest record, which is the size of the shared record area. */
  recordLength: number;
}

export interface Program {
  name: string;
  recursive: boolean;
  files: FileControlEntry[];
  descriptions: FileDescription[];
  working: Field[];
  local: Field[];
  linkage: Field[];
  /** Names in `PROCEDURE DIVISION USING`, in order. */
  using: string[];
  paragraphs: Paragraph[];
  /** `USE AFTER STANDARD ERROR PROCEDURE` sections, by the file they guard. */
  declaratives: UseProcedure[];
}

export interface Unit {
  programs: Program[];
  /** `CBL ARITH(COMPAT),...` as written. */
  directives: string[];
}

export function parseUnit(source: string): Unit {
  const { lines, directives } = readFixedFormat(source);
  const cursor = new Cursor(tokenize(lines));
  const programs: Program[] = [];

  while (!cursor.done) {
    programs.push(parseProgram(cursor));
    // `END PROGRAM NAME.` closes one; a file may hold several.
    if (cursor.accept("END", "PROGRAM")) {
      cursor.word();
      cursor.acceptPeriod();
    }
  }

  if (programs.length === 0) {
    throw new CobolSyntaxError("The source holds no program.");
  }
  return { programs, directives };
}

function parseProgram(cursor: Cursor): Program {
  cursor.expect("IDENTIFICATION");
  cursor.expect("DIVISION");
  cursor.acceptPeriod();
  cursor.expect("PROGRAM-ID");
  cursor.acceptPeriod();
  const name = cursor.word();
  const recursive = cursor.accept("RECURSIVE");
  cursor.accept("IS", "INITIAL", "PROGRAM");
  cursor.acceptPeriod();

  // Everything else in the IDENTIFICATION DIVISION is documentation.
  while (
    cursor.peek().kind === "word" &&
    [
      "AUTHOR",
      "INSTALLATION",
      "DATE-WRITTEN",
      "DATE-COMPILED",
      "SECURITY",
      "REMARKS",
    ].includes(cursor.peek().text)
  ) {
    while (!cursor.acceptPeriod() && !cursor.done) {
      cursor.next();
    }
  }

  const program: Program = {
    name,
    recursive,
    files: [],
    descriptions: [],
    working: [],
    local: [],
    linkage: [],
    using: [],
    paragraphs: [],
    declaratives: [],
  };

  if (cursor.accept("ENVIRONMENT", "DIVISION")) {
    cursor.acceptPeriod();
    parseEnvironment(cursor, program);
  }

  if (cursor.accept("DATA", "DIVISION")) {
    cursor.acceptPeriod();
    parseData(cursor, program);
  }

  cursor.expect("PROCEDURE");
  cursor.expect("DIVISION");
  if (cursor.accept("USING")) {
    while (cursor.peek().kind === "word" && cursor.peek().kind !== "end") {
      if (cursor.accept("BY", "REFERENCE") || cursor.accept("BY", "VALUE")) {
        continue;
      }
      program.using.push(cursor.word());
      if (cursor.peek().kind === "period") {
        break;
      }
    }
  }
  cursor.acceptPeriod();

  const division = new StatementParser(cursor).paragraphs();
  program.paragraphs = division.paragraphs;
  program.declaratives = division.declaratives;
  return program;
}

function parseEnvironment(cursor: Cursor, program: Program): void {
  // CONFIGURATION SECTION carries SPECIAL-NAMES, which the emitter uses for
  // `UPON SYSOUT` when it declares one. Read past it; the mnemonic is resolved
  // by name at DISPLAY time.
  if (cursor.accept("CONFIGURATION", "SECTION")) {
    cursor.acceptPeriod();
    while (
      !cursor.looksLike("INPUT-OUTPUT") &&
      !cursor.looksLike("DATA") &&
      !cursor.done
    ) {
      cursor.next();
    }
  }

  if (!cursor.accept("INPUT-OUTPUT", "SECTION")) {
    return;
  }
  cursor.acceptPeriod();
  cursor.expect("FILE-CONTROL");
  cursor.acceptPeriod();

  while (cursor.accept("SELECT")) {
    const optional = cursor.accept("OPTIONAL");
    const entry: FileControlEntry = {
      name: cursor.word(),
      assign: "",
      organization: "sequential",
      access: "sequential",
      recordKey: null,
      alternateKeys: [],
      status: null,
      optional,
    };

    while (!cursor.acceptPeriod() && !cursor.done) {
      if (cursor.accept("ASSIGN")) {
        cursor.skipNoise("TO", "USING");
        const token = cursor.next();
        entry.assign =
          token.kind === "string" ? (token.value ?? "") : token.text;
        continue;
      }
      if (cursor.accept("ORGANIZATION")) {
        cursor.skipNoise("IS");
        if (cursor.accept("LINE", "SEQUENTIAL")) {
          entry.organization = "line-sequential";
        } else if (cursor.accept("SEQUENTIAL")) {
          entry.organization = "sequential";
        } else if (cursor.accept("INDEXED")) {
          entry.organization = "indexed";
        } else if (cursor.accept("RELATIVE")) {
          entry.organization = "relative";
        } else {
          throw new CobolUnsupportedError(
            `Line ${String(cursor.line)}: unknown ORGANIZATION.`,
          );
        }
        continue;
      }
      if (cursor.accept("ACCESS")) {
        cursor.skipNoise("MODE", "IS");
        if (cursor.accept("RANDOM")) {
          entry.access = "random";
        } else if (cursor.accept("DYNAMIC")) {
          entry.access = "dynamic";
        } else {
          cursor.accept("SEQUENTIAL");
          entry.access = "sequential";
        }
        continue;
      }
      if (cursor.accept("RECORD", "KEY") || cursor.accept("RECORD")) {
        cursor.skipNoise("KEY", "IS");
        entry.recordKey = cursor.word();
        // `RECORD KEY IS ACCOUNT-ID OF ACCOUNT-MASTER-RECORD`. The qualifier
        // says which record the key belongs to; the name alone is what the
        // READ resolves, so the qualifiers are read and discarded.
        while (cursor.accept("OF") || cursor.accept("IN")) {
          cursor.word();
        }
        continue;
      }
      if (
        cursor.accept("ALTERNATE", "RECORD", "KEY") ||
        cursor.accept("ALTERNATE")
      ) {
        cursor.skipNoise("RECORD", "KEY", "IS");
        const name = cursor.word();
        while (cursor.accept("OF") || cursor.accept("IN")) {
          cursor.word();
        }
        const duplicates =
          cursor.accept("WITH", "DUPLICATES") || cursor.accept("DUPLICATES");
        entry.alternateKeys.push({ name, duplicates });
        continue;
      }
      if (cursor.accept("FILE", "STATUS") || cursor.accept("STATUS")) {
        cursor.skipNoise("IS");
        entry.status = cursor.word();
        continue;
      }
      throw new CobolUnsupportedError(
        `Line ${String(cursor.line)}: ${cursor.peek().text} is not a SELECT clause this interpreter implements.`,
      );
    }

    program.files.push(entry);
  }
}

/** Section headers that end the entries of the section before them. */
function atSectionBoundary(cursor: Cursor): boolean {
  return (
    cursor.looksLike("FILE", "SECTION") ||
    cursor.looksLike("WORKING-STORAGE", "SECTION") ||
    cursor.looksLike("LOCAL-STORAGE", "SECTION") ||
    cursor.looksLike("LINKAGE", "SECTION") ||
    cursor.looksLike("REPORT", "SECTION") ||
    cursor.looksLike("PROCEDURE", "DIVISION") ||
    cursor.looksLike("FD") ||
    cursor.looksLike("SD")
  );
}

function parseData(cursor: Cursor, program: Program): void {
  if (cursor.accept("FILE", "SECTION")) {
    cursor.acceptPeriod();
    while (cursor.accept("FD") || cursor.accept("SD")) {
      const name = cursor.word();
      // BLOCK CONTAINS, RECORDING MODE, LABEL RECORDS: describing the dataset,
      // not the data. The record layout below is what decides the bytes.
      //
      // LINAGE is the exception. It makes the file a printed page with a depth,
      // a footing and a LINAGE-COUNTER, and it is what makes `AT END-OF-PAGE`
      // fire. Implementing page fitting to the letter and then not being sure
      // it matches is worse than saying so: a report that breaks its pages in
      // the wrong place looks right until somebody counts.
      let linage = false;
      while (!cursor.acceptPeriod() && !cursor.done) {
        if (cursor.looksLike("LINAGE")) {
          linage = true;
        }
        cursor.next();
      }
      if (linage) {
        throw new CobolUnsupportedError(
          `${name} has a LINAGE clause, which this interpreter does not implement. Compile it with cobc to run it.`,
        );
      }
      const records = parseDataEntries(cursor, "file", atSectionBoundary);
      program.descriptions.push({
        name,
        records,
        recordLength: Math.max(0, ...records.map((record) => record.length)),
      });
    }
  }

  if (cursor.accept("WORKING-STORAGE", "SECTION")) {
    cursor.acceptPeriod();
    program.working = parseDataEntries(cursor, "working", atSectionBoundary);
  }

  if (cursor.accept("LOCAL-STORAGE", "SECTION")) {
    cursor.acceptPeriod();
    program.local = parseDataEntries(cursor, "local", atSectionBoundary);
  }

  reportWriterIsNotImplemented(cursor);

  if (cursor.accept("LINKAGE", "SECTION")) {
    cursor.acceptPeriod();
    program.linkage = parseDataEntries(cursor, "linkage", atSectionBoundary);
  }

  reportWriterIsNotImplemented(cursor);
}

/**
 * Report Writer, which this interpreter does not implement.
 *
 * The compiler emits a REPORT SECTION and GnuCOBOL compiles it. Running one
 * would mean implementing page fitting, control breaks and sum counters: a
 * second report generator, whose output nobody would have checked against the
 * first. Refusing by name is more useful than a run that quietly produces no
 * report, and `examples/report-with-controls` is compiled and executed under
 * cobc in `tests/conformance.test.ts` where a real one does the work.
 */
function reportWriterIsNotImplemented(cursor: Cursor): void {
  if (cursor.looksLike("REPORT", "SECTION")) {
    throw new CobolUnsupportedError(
      `Line ${String(cursor.line)}: this program uses Report Writer, which this interpreter does not implement. Compile it with cobc to run it.`,
    );
  }
}
