/**
 * A checker that reads generated artifacts as text and asserts target rules.
 *
 * It knows nothing about how they were produced. That is the point: every rule
 * the emitter breaks, it breaks because somebody believed something about the
 * target that is not true, and a check written from the same belief agrees with
 * it. The 2026-08-05 audit found a 31-character data name, a rounding phrase
 * that is not Enterprise COBOL, and a job whose dataset names could not be
 * catalogued — three defects in emitted text, none of which any test read the
 * emitted text to look for.
 *
 * Every rule cites the manual it comes from. A rule nobody can trace to IBM is
 * a rule someone invented, and this file is the place that would be hardest to
 * notice it in.
 *
 * Manuals, as extracted in `vendor-docs/`:
 *   LR   Enterprise COBOL for z/OS 6.4 Language Reference
 *   PG   Enterprise COBOL for z/OS 6.4 Programming Guide
 *   JCL  z/OS MVS JCL Reference
 */

import { isReservedCobolWord } from "../../cobol-ir/src/index";
import {
  FUNCTION_NAMES as IBM_FUNCTION_NAMES,
  RESERVED_WORDS as IBM_RESERVED_WORDS,
} from "./ibm-words";

export interface ConformanceFinding {
  /** Artifact the finding is in, as the caller named it. */
  file: string;
  /** 1-based line, so an editor and a compiler listing agree. */
  line: number;
  /** Stable identifier, for suppressing and for counting. */
  rule: string;
  message: string;
  /** Manual and section the rule comes from. */
  citation: string;
}

export interface ConformanceOptions {
  /**
   * Programs a `CALL` may name besides those defined in the artifact itself.
   *
   * On z/OS this is what the binder resolves from SYSLIB; here it is the
   * `runtime/` directory and whatever else the caller knows is linked in. A
   * `CALL` naming nothing is a load module short of a routine, which shows up
   * at bind time on z/OS and never shows up at all in a test that only reads
   * the source.
   */
  knownPrograms?: readonly string[];
}

/** The last column of a COBOL source line. LR, "Reference format". */
const COBOL_LAST_COLUMN = 72;

/** Area A is columns 8-11; Area B is 12-72. LR, "Reference format". */
const AREA_A_COLUMN = 8;
const AREA_B_COLUMN = 12;

/** Column 7, the indicator area, as an index into the line. */
const INDICATOR_INDEX = 6;

/** Column 8, where Area A begins, as an index into the line. */
const AREA_A_INDEX = 7;

/** LR, "COBOL word": "not more than 30 characters". */
const MAX_WORD = 30;

/** LR, "PROGRAM-ID paragraph": the name becomes an external member name. */
const MAX_PROGRAM_ID = 8;

/** LR, "Alphanumeric literals": maximum length 160 characters. */
const MAX_LITERAL = 160;

/** LR, "PICTURE clause": at most 50 characters in the character-string. */
const MAX_PICTURE = 50;

/** PG, "ARITH": under COMPAT an arithmetic operand has at most 18 digits. */
const MAX_DIGITS = 18;

/** JCL, "Format of statements": fields end at column 71. */
const JCL_LAST_COLUMN = 71;

/** JCL, "Name field": one to eight alphanumeric or national characters. */
const MAX_JCL_NAME = 8;

/** JCL, "DSNAME": each qualifier 8 or fewer, the whole name 44 or fewer. */
const MAX_DSN_QUALIFIER = 8;
const MAX_DSN = 44;

/**
 * Paragraph names COBOL itself defines, which are not user-defined words.
 *
 * `FILE-CONTROL.` is a paragraph header of the INPUT-OUTPUT SECTION and is a
 * reserved word by definition; a rule that reads every `NAME.` in Area A as a
 * user-defined paragraph reports it, which is a rule reporting the language.
 */
const DIVISION_PARAGRAPHS = new Set([
  "AUTHOR",
  "DATE-COMPILED",
  "DATE-WRITTEN",
  "FILE-CONTROL",
  "I-O-CONTROL",
  "INSTALLATION",
  "OBJECT-COMPUTER",
  "PROGRAM-ID",
  "REPOSITORY",
  "SECURITY",
  "SOURCE-COMPUTER",
  "SPECIAL-NAMES",
]);

/**
 * Words that stand in program text without being a reserved word or a name.
 *
 * A DD name in an `ASSIGN` clause, an SQL host-variable prefix a precompiler
 * generates, a mnemonic named in SPECIAL-NAMES. Each is a place the target
 * takes a word it does not itself define, and every entry here is one of them
 * rather than a convenience.
 */
const PROGRAM_TEXT_WORDS = new Set([
  // Level numbers and picture characters survive tokenising as words.
  "V",
  "S",
  "P",
  "X",
  "Z",
  "COMP",
  "COMP-1",
  "COMP-2",
  "COMP-3",
  "COMP-4",
  "COMP-5",
  // SQLCA and SQLCODE are declared by the precompiler's own INCLUDE.
  "SQLCA",
  "SQLCODE",
  "SQLSTATE",
  "SQLERRD",
  "SQLWARN0",
  // The CICS translator declares these; the program only names them.
  "DFHEIBLK",
  "DFHCOMMAREA",
  "EIBCALEN",
  "EIBRESP",
  "EIBRESP2",
  "EIBTRNID",
  "EIBAID",
  "DFHRESP",
  "DFHVALUE",
  // Environment names in SPECIAL-NAMES and the ASSIGN clause.
  "SYSOUT",
  "SYSIN",
  "SYSIPT",
  "SYSLIST",
  "SYSPUNCH",
  "CONSOLE",
]);

/**
 * Statement verbs and the phrase words that can open a line of a statement.
 *
 * Not a grammar. It is the list of words that may stand at the head of a line
 * in generated code, so that a verb this compiler invented — or one that
 * belongs to a different COBOL — is caught rather than emitted. Anything at the
 * head of a line that is neither one of these nor a name the artifact itself
 * declares is a word the target has never heard of.
 */
const STATEMENT_HEADS = new Set([
  // Verbs, LR "Procedure division statements".
  "ACCEPT",
  "ADD",
  "ALLOCATE",
  "CALL",
  "CANCEL",
  "CLOSE",
  "COMPUTE",
  "CONTINUE",
  "DELETE",
  "DISPLAY",
  "DIVIDE",
  "EVALUATE",
  "EXIT",
  "FREE",
  "GENERATE",
  "GO",
  "GOBACK",
  "IF",
  "INITIALIZE",
  "INITIATE",
  "INSPECT",
  "INVOKE",
  "JSON",
  "MERGE",
  "MOVE",
  "MULTIPLY",
  "OPEN",
  "PERFORM",
  "READ",
  "RELEASE",
  "RETURN",
  "REWRITE",
  "SEARCH",
  "SET",
  "SORT",
  "START",
  "STOP",
  "STRING",
  "SUBTRACT",
  "TERMINATE",
  "UNSTRING",
  "WRITE",
  "XML",
  // Phrase and scope words that open a line.
  "AT",
  "ELSE",
  "END-ACCEPT",
  "END-ADD",
  "END-CALL",
  "END-COMPUTE",
  "END-DELETE",
  "END-DIVIDE",
  "END-EVALUATE",
  "END-EXEC",
  "END-IF",
  "END-INVOKE",
  "END-JSON",
  "END-MULTIPLY",
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
  "END-XML",
  "EXEC",
  "INTO",
  "INVALID",
  "KEY",
  "NOT",
  "ON",
  "OR",
  "SIZE",
  "THEN",
  "USE",
  "WHEN",
  "WITH",
  // Division, section and clause words, for the data and environment divisions.
  "BLOCK",
  "CONFIGURATION",
  "DATA",
  "DECIMAL-POINT",
  "DECLARATIVES",
  "END",
  "ENVIRONMENT",
  "FD",
  "FILE",
  "FILE-CONTROL",
  "GLOBAL",
  "I-O-CONTROL",
  "IDENTIFICATION",
  "INPUT-OUTPUT",
  "LINKAGE",
  "LOCAL-STORAGE",
  "OBJECT-COMPUTER",
  "PROCEDURE",
  "PROGRAM-ID",
  "RECORD",
  "RECORDING",
  "REPORT",
  "SD",
  "SELECT",
  "SOURCE-COMPUTER",
  "SPECIAL-NAMES",
  "WORKING-STORAGE",
  "CURRENCY",
  "COPY",
]);

/** IBM programs a step may `EXEC` without the job supplying a STEPLIB. */
const LINKLIST_PROGRAMS = new Set([
  "IEFBR14",
  "IEBGENER",
  "IEBCOPY",
  "IDCAMS",
  "SORT",
  "ICEMAN",
  "IEWBLINK",
  "IEWL",
]);

/**
 * Lint one artifact, chosen by its extension.
 *
 * `.cbl` and `.cpy` are read as COBOL — a copybook is a fragment rather than a
 * program, so the rules that need a whole program are skipped for one.
 */
export function lintArtifact(
  file: string,
  text: string,
  options: ConformanceOptions = {},
): ConformanceFinding[] {
  if (file.endsWith(".jcl")) {
    return lintJcl(file, text);
  }
  return lintCobol(file, text, {
    ...options,
    fragment: file.endsWith(".cpy"),
  });
}

export function lintCobol(
  file: string,
  text: string,
  options: ConformanceOptions & { fragment?: boolean } = {},
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const lines = text.split("\n");
  const declared = declaredNames(lines);
  /** True while inside an `EXEC ... END-EXEC` block, whose text is not COBOL. */
  let inExec = false;

  lines.forEach((line, index) => {
    const at = index + 1;
    const report = (rule: string, message: string, citation: string): void => {
      findings.push({ file, line: at, rule, message, citation });
    };

    if (line.length > COBOL_LAST_COLUMN) {
      report(
        "line-length",
        `Line is ${line.length} characters; the compiler reads only ${COBOL_LAST_COLUMN}, and discards the rest without a diagnostic.`,
        'LR, "Reference format"',
      );
    }

    const indicator = line[INDICATOR_INDEX] ?? " ";
    if (line.trim() !== "" && !" -*/D".includes(indicator)) {
      report(
        "indicator-area",
        `Column 7 holds ${JSON.stringify(indicator)}; the indicator area takes a blank, a hyphen, an asterisk, a slash, or D.`,
        'LR, "Reference format"',
      );
    }

    if (isCommentLine(line) || line.trim() === "") {
      return;
    }

    const content = line.slice(AREA_A_INDEX);
    // Counted from Area A, so the hyphen a continued literal carries in the
    // indicator area is not read as text in the sequence number area.
    const startColumn =
      content.trim() === ""
        ? 0
        : content.length - content.trimStart().length + AREA_A_COLUMN;
    const continued = indicator === "-";

    // Area A holds division, section and paragraph headers, FD and SD entries,
    // and level 01 and 77 indicators; everything else belongs in Area B.
    if (
      !continued &&
      startColumn < AREA_B_COLUMN &&
      startColumn >= AREA_A_COLUMN &&
      !inExec &&
      !areaAEntry(content)
    ) {
      report(
        "area-a",
        `${content.trim().split(/\s+/)[0]} starts in Area A; only a division, section or paragraph header, an FD or SD entry, or a level 01 or 77 indicator belongs there.`,
        'LR, "Area A"',
      );
    }
    if (startColumn > 0 && startColumn < AREA_A_COLUMN) {
      report(
        "sequence-area",
        `Text starts in column ${startColumn}; columns 1 to 6 are the sequence number area.`,
        'LR, "Reference format"',
      );
    }

    // The text between EXEC and END-EXEC is SQL, CICS or DL/I. A precompiler
    // reads it, COBOL's rules do not describe it, and a Db2 column name may be
    // 128 characters where a COBOL word may be 30 — so the rules below stop at
    // the delimiters rather than reporting on a language they do not know.
    const wasInExec = inExec;
    if (/\bEXEC\s+(?:SQL|CICS|DLI)\b/.test(content)) {
      inExec = true;
    }
    if (/\bEND-EXEC\b/.test(content)) {
      inExec = false;
    }
    if (wasInExec) {
      return;
    }

    for (const word of userDefinedWords(content)) {
      if (word.length > MAX_WORD) {
        report(
          "word-length",
          `${word} is ${word.length} characters; a COBOL word is at most ${MAX_WORD}.`,
          'LR, "COBOL words"',
        );
      }
    }

    const programId = /^\s*PROGRAM-ID\.\s+([A-Z0-9-]+)/.exec(content);
    if (programId && programId[1].length > MAX_PROGRAM_ID) {
      report(
        "program-id-length",
        `PROGRAM-ID ${programId[1]} is ${programId[1].length} characters; it becomes a load module member name, which is at most ${MAX_PROGRAM_ID}.`,
        'LR, "PROGRAM-ID paragraph"',
      );
    }

    for (const literal of literals(content)) {
      if (literal.length > MAX_LITERAL) {
        report(
          "literal-length",
          `An alphanumeric literal is ${literal.length} characters; the maximum is ${MAX_LITERAL}.`,
          'LR, "Alphanumeric literals"',
        );
      }
    }

    const picture = /\bPIC(?:TURE)?\s+(?:IS\s+)?([A-Z0-9()VSP$,./+\-*Z]+)/.exec(
      content,
    );
    if (picture) {
      const shape = picture[1].replace(/\.$/, "");
      if (shape.length > MAX_PICTURE) {
        report(
          "picture-length",
          `The PICTURE character-string ${shape} is ${shape.length} characters; the maximum is ${MAX_PICTURE}.`,
          'LR, "PICTURE clause"',
        );
      }
      const digits = pictureDigits(shape);
      if (digits > MAX_DIGITS) {
        report(
          "digit-count",
          `${shape} describes ${digits} digits; under ARITH(COMPAT) an arithmetic operand has at most ${MAX_DIGITS}.`,
          'PG, "ARITH"',
        );
      }
    }

    const declaration = /^\s*(\d\d)\s+([A-Z][A-Z0-9-]*)/.exec(content);
    if (declaration && isReservedCobolWord(declaration[2])) {
      report(
        "reserved-word",
        `${declaration[2]} is a reserved word and cannot be a data name.`,
        'LR, "Reserved words"',
      );
    }

    const paragraph = /^ {0,3}([A-Z][A-Z0-9-]*)\.\s*$/.exec(content);
    if (
      paragraph &&
      !DIVISION_PARAGRAPHS.has(paragraph[1]) &&
      isReservedCobolWord(paragraph[1])
    ) {
      report(
        "reserved-word",
        `${paragraph[1]} is a reserved word and cannot be a paragraph name.`,
        'LR, "Reserved words"',
      );
    }

    // The vocabulary rule, and the one that would have found F1.
    //
    // Every word in a generated program is either a name it declares or a word
    // Enterprise COBOL has a meaning for. `ROUNDED MODE IS NEAREST-EVEN`
    // compiled under GnuCOBOL's default dialect and read like COBOL, and
    // `NEAREST-EVEN` is in no column of Appendix E at all — not reserved, not
    // an unimplemented Standard word, not a word that might be reserved later.
    // A checker that only asks whether the compiler in front of it accepted the
    // text cannot tell that; one that asks whether the target has ever heard of
    // the word can.
    for (const word of vocabulary(content)) {
      if (
        !IBM_RESERVED_WORDS.has(word) &&
        !IBM_FUNCTION_NAMES.has(word) &&
        !declared.has(word) &&
        !PROGRAM_TEXT_WORDS.has(word)
      ) {
        report(
          "vocabulary",
          `${word} is neither a name this artifact declares nor a word Enterprise COBOL 6.4 reserves.`,
          'LR, Appendix E, "Reserved words"',
        );
      }
    }
  });

  if (!options.fragment) {
    findings.push(...unresolvedCalls(file, text, options.knownPrograms ?? []));
  }

  return findings;
}

export function lintJcl(file: string, text: string): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const lines = text.split("\n").filter(
    (line, index, all) =>
      // A trailing empty line is the file's newline, not a card.
      index < all.length - 1 || line !== "",
  );
  const report = (
    line: number,
    rule: string,
    message: string,
    citation: string,
  ): void => {
    findings.push({ file, line, rule, message, citation });
  };

  let inStreamData = false;
  let step: {
    line: number;
    name: string;
    program: string;
    dds: Set<string>;
  } | null = null;
  const steps: {
    line: number;
    name: string;
    program: string;
    dds: Set<string>;
  }[] = [];

  lines.forEach((line, index) => {
    const at = index + 1;

    if (line.length > JCL_LAST_COLUMN && !line.startsWith("//*")) {
      report(
        at,
        "card-length",
        `Card is ${line.length} characters; fields end at column ${JCL_LAST_COLUMN} and the rest is not read.`,
        'JCL, "Format of statements"',
      );
    }

    // In-stream data runs to its delimiter and is not JCL at all.
    if (inStreamData) {
      if (line.startsWith("/*") || line.startsWith("//")) {
        inStreamData = false;
      } else {
        return;
      }
    }
    if (/\bDD\s+\*/.test(line) || /\bDD\s+DATA\b/.test(line)) {
      inStreamData = true;
    }

    if (!line.startsWith("//") || line.startsWith("//*")) {
      return;
    }

    const card = /^\/\/(\S*)\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (card) {
      const [, name, operation, operands = ""] = card;

      if (name !== "") {
        for (const part of name.split(".")) {
          if (part.length > MAX_JCL_NAME) {
            report(
              at,
              "name-field",
              `${part} is ${part.length} characters; a name field is one to ${MAX_JCL_NAME}.`,
              'JCL, "Name field"',
            );
          }
        }
      }

      if (operation === "EXEC") {
        const program = /\bPGM=([^,\s]+)/.exec(operands)?.[1] ?? "";
        step = { line: at, name, program, dds: new Set() };
        steps.push(step);
      } else if (operation === "DD" && step) {
        step.dds.add(name.replace(/^.*\./, ""));
      }
    } else if (step && /^\/\/\s+DD\b/.test(line)) {
      // A concatenated DD, which continues the one before it.
    }

    for (const [, dsn] of line.matchAll(/DSN(?:AME)?=([^,\s()]+)/g)) {
      if (dsn.startsWith("&")) {
        continue;
      }
      if (dsn.length > MAX_DSN) {
        report(
          at,
          "dsn-length",
          `${dsn} is ${dsn.length} characters; a qualified dataset name is at most ${MAX_DSN}.`,
          'JCL, "DSNAME parameter"',
        );
      }
      for (const qualifier of dsn.split(".")) {
        if (qualifier.length > MAX_DSN_QUALIFIER || qualifier.length === 0) {
          report(
            at,
            "dsn-qualifier",
            `${qualifier || "(empty)"} in ${dsn} is ${qualifier.length} characters; each qualifier is one to ${MAX_DSN_QUALIFIER}.`,
            'JCL, "DSNAME parameter"',
          );
        } else if (/^[0-9]/.test(qualifier)) {
          report(
            at,
            "dsn-qualifier",
            `${qualifier} in ${dsn} begins with a digit; the first character of a qualifier must be alphabetic or national.`,
            'JCL, "DSNAME parameter"',
          );
        }
      }
    }

    // A card ending in a comma continues, and the next one has to be a
    // continuation: `//` in columns 1-2, a blank in column 3, and the operand
    // resuming in columns 4 through 16. Anything else and the system reads a
    // new statement and fails the job for a continuation it never found.
    if (line.trimEnd().endsWith(",")) {
      const next = lines[index + 1] ?? "";
      // Where the operand picks up, counted in columns of the card rather than
      // from the start of the text: `//` occupies 1 and 2, and the blank in 3
      // is what says the card is a continuation at all.
      const body = next.slice(2);
      const resume = body.length - body.trimStart().length + 3;
      if (!next.startsWith("//") || next[2] !== " ") {
        report(
          at + 1,
          "continuation",
          "The card before this one ends in a comma, so this one has to begin with // and a blank in column 3.",
          'JCL, "Continuing statements"',
        );
      } else if (resume < 4 || resume > 16) {
        report(
          at + 1,
          "continuation",
          `A continued field resumes in column ${resume}; it has to resume in columns 4 through 16.`,
          'JCL, "Continuing statements"',
        );
      }
    }
  });

  for (const entry of steps) {
    findings.push(...requiredDds(file, entry));
  }

  return findings;
}

/** DDs a step cannot run without, by what it executes. */
function requiredDds(
  file: string,
  step: { line: number; name: string; program: string; dds: Set<string> },
): ConformanceFinding[] {
  const missing = (names: string[], citation: string): ConformanceFinding[] =>
    names
      .filter((name) => !step.dds.has(name))
      .map((name) => ({
        file,
        line: step.line,
        rule: "required-dd",
        message: `Step ${step.name} runs ${step.program} without a ${name} DD.`,
        citation,
      }));

  if (step.program === "IGYCRCTL") {
    return missing(
      ["STEPLIB", "SYSIN", "SYSPRINT", "SYSLIN", "SYSUT1"],
      'PG, "Compile and link-edit procedure (IGYWCL)"',
    );
  }
  if (step.program === "IEWBLINK" || step.program === "IEWL") {
    return missing(
      ["SYSLIN", "SYSLMOD", "SYSPRINT", "SYSLIB"],
      'PG, "Compile and link-edit procedure (IGYWCL)"',
    );
  }
  if (step.program !== "" && !LINKLIST_PROGRAMS.has(step.program)) {
    // A program the job has just built is not on any search the step makes
    // unless the job says where it is. Without it the step ends S806 — module
    // not found — having compiled and linked perfectly.
    return missing(["STEPLIB"], 'JCL, "STEPLIB DD statement"');
  }
  return [];
}

/** Every `CALL "X"` that names nothing the run unit will hold. */
function unresolvedCalls(
  file: string,
  text: string,
  known: readonly string[],
): ConformanceFinding[] {
  const defined = new Set(
    [...text.matchAll(/PROGRAM-ID\.\s+([A-Z0-9-]+)/g)].map((match) => match[1]),
  );
  for (const name of known) {
    defined.add(name.toUpperCase());
  }

  const findings: ConformanceFinding[] = [];
  text.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) {
      return;
    }
    const call = /\bCALL\s+"([^"]+)"/.exec(line);
    if (call && !defined.has(call[1].toUpperCase())) {
      findings.push({
        file,
        line: index + 1,
        rule: "call-resolvable",
        message: `CALL "${call[1]}" names a program that is neither in this artifact nor supplied to the binder.`,
        citation: 'PG, "Resolving external references"',
      });
    }
  });

  return findings;
}

/**
 * Every name the artifact introduces.
 *
 * The vocabulary rule asks whether a word is a name or a word of the language,
 * so a name this misses is reported as a word Enterprise COBOL has never heard
 * of — which is a false alarm, and a linter that cries wolf is one whose output
 * gets skimmed. Every place a program can name something is here.
 */
function declaredNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  const add = (name: string | undefined): void => {
    if (name) {
      names.add(name);
    }
  };

  for (const line of lines) {
    if (isCommentLine(line)) {
      continue;
    }
    const content = line.slice(AREA_A_INDEX);
    // A data description entry, which is also how 88-level condition names and
    // FILLER arrive.
    add(/^\s*(?:\d\d)\s+([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    add(/^ {0,3}([A-Z][A-Z0-9-]*)\.\s*$/.exec(content)?.[1]);
    add(/^ {0,3}([A-Z][A-Z0-9-]*)\s+SECTION[\s.]/.exec(content)?.[1]);
    // The file's COBOL name, and the DD name it is assigned to.
    add(/\bSELECT\s+(?:OPTIONAL\s+)?([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    add(/\bASSIGN\s+TO\s+([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    add(/^\s*(?:FD|SD|RD)\s+([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    add(/\bINDEXED\s+BY\s+([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    add(/\bPROGRAM-ID\.\s+([A-Z][A-Z0-9-]*)/.exec(content)?.[1]);
    // A mnemonic, and the environment name it is for.
    const mnemonic = /^\s*([A-Z][A-Z0-9-]*)\s+IS\s+([A-Z][A-Z0-9-]*)/.exec(
      content,
    );
    if (mnemonic) {
      add(mnemonic[1]);
      add(mnemonic[2]);
    }
  }

  return names;
}

function isCommentLine(line: string): boolean {
  return (
    line[INDICATOR_INDEX] === "*" ||
    line[INDICATOR_INDEX] === "/" ||
    line.trimStart().startsWith("*>")
  );
}

/** True when what the line holds belongs in Area A. */
function areaAEntry(content: string): boolean {
  const trimmed = content.trim();
  return (
    /^(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/.test(trimmed) ||
    /^[A-Z][A-Z0-9-]*\s+SECTION\s*\./.test(trimmed) ||
    /^(FD|SD)\s/.test(trimmed) ||
    /^(01|77)\s/.test(trimmed) ||
    /^[A-Z][A-Z0-9-]*\.\s*$/.test(trimmed) ||
    /^(DECLARATIVES|END\s+DECLARATIVES)\s*\.$/.test(trimmed) ||
    /^END\s+PROGRAM\b/.test(trimmed) ||
    /^(PROGRAM-ID|AUTHOR|DATE-WRITTEN|INSTALLATION|SECURITY|SOURCE-COMPUTER|OBJECT-COMPUTER|SPECIAL-NAMES|FILE-CONTROL|I-O-CONTROL|REPOSITORY)\b/.test(
      trimmed,
    ) ||
    /^(CONFIGURATION|INPUT-OUTPUT|FILE|WORKING-STORAGE|LOCAL-STORAGE|LINKAGE|REPORT)\s+SECTION\s*\./.test(
      trimmed,
    )
  );
}

/**
 * Every user-defined-word-shaped token outside a literal.
 *
 * Loose on purpose. Anything at all made of letters, digits and hyphens is
 * checked against the 30-character limit, because nothing in COBOL — not a
 * word, not a picture string, not a figurative constant — is allowed to be
 * longer than that in the positions a generated program puts them.
 */
function userDefinedWords(content: string): string[] {
  return stripLiterals(content).match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? [];
}

/**
 * The words on a line that have to mean something to the target.
 *
 * Numbers are not words — a level number, a subscript, a picture repeat count
 * and an OCCURS bound are all values. A word that is entirely digits is
 * dropped, and so is one that names a qualified reference's subscript, because
 * neither is a word the reserved-word table has anything to say about.
 */
function vocabulary(content: string): string[] {
  const text = content
    // The command inside an EXEC block is the precompiler's language, not
    // COBOL's. A block that opens and closes on one line goes first; one that
    // opens and runs on takes the rest of the line with it, and the caller
    // skips the lines between.
    .replace(/\bEXEC\s+(?:SQL|CICS|DLI)\b[\s\S]*?\bEND-EXEC\b/g, " ")
    .replace(/\bEXEC\s+(?:SQL|CICS|DLI)\b.*$/, " ")
    .replace(/^.*\bEND-EXEC\b/, " ")
    // A PICTURE character-string is a description rather than a sequence of
    // words: `PIC S9(16)V99` holds no COBOL word at all, and its own rules are
    // checked by `picture-length` and `digit-count`.
    .replace(/\bPIC(?:TURE)?\s+(?:IS\s+)?\S+/g, " ")
    // `COPY MEMBER.` names a library member, which is a text-name rather than
    // a word the compiler defines.
    .replace(/\bCOPY\s+\S+/g, " COPY ")
    // `DFHRESP(NORMAL)` names a CICS condition, which the translator resolves.
    // The name is CICS's vocabulary rather than COBOL's, and the API Reference
    // is where it comes from.
    .replace(/\bDFHRESP\s*\([^)]*\)/g, " DFHRESP ");

  return userDefinedWords(text)
    .map((word) => word.toUpperCase())
    .filter((word) => /[A-Z]/.test(word));
}

/** The text of each alphanumeric literal on the line, without its delimiters. */
function literals(content: string): string[] {
  return [...content.matchAll(/"((?:[^"]|"")*)"|'((?:[^']|'')*)'/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

/**
 * The line with every literal replaced by a blank.
 *
 * A literal wider than the margin is written across lines, so the last quote on
 * a line may open a literal that the next one closes — leaving this line with
 * an odd number of quotes and text after the last one that is not code. What
 * follows an unmatched quote is dropped rather than tokenised, which is why
 * `DISPLAY "ARITHMETIC OVERFLOW ...` does not report `ARITHMETIC` as a word
 * Enterprise COBOL has never heard of.
 */
function stripLiterals(content: string): string {
  const closed = content.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, " ");
  const opening = closed.search(/["']/);
  return opening === -1 ? closed : closed.slice(0, opening);
}

/** How many digit positions a PICTURE character-string describes. */
function pictureDigits(shape: string): number {
  let digits = 0;
  let index = 0;
  while (index < shape.length) {
    const character = shape[index];
    if (character !== "9" && character !== "Z" && character !== "P") {
      index += 1;
      continue;
    }
    const repeat = /^\((\d+)\)/.exec(shape.slice(index + 1));
    digits += repeat ? Number(repeat[1]) : 1;
    index += repeat ? repeat[0].length + 1 : 1;
  }
  return digits;
}

/** A report a person reads, grouped by artifact and in line order. */
export function formatFindings(
  findings: readonly ConformanceFinding[],
): string {
  if (findings.length === 0) {
    return "No conformance findings.\n";
  }
  return `${findings
    .map(
      (finding) =>
        `${finding.file}:${finding.line}: ${finding.rule}: ${finding.message} [${finding.citation}]`,
    )
    .join("\n")}\n`;
}
