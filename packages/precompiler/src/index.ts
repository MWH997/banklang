/**
 * A precompiler for the statements the local compiler cannot execute.
 *
 * IBM's Db2 precompiler and CICS translator replace `EXEC SQL` and `EXEC CICS`
 * blocks with calls into their runtimes before the COBOL compiler ever sees
 * them. This module does the same thing structurally, so the generated program
 * can be compiled and checked locally.
 *
 * `JSON PARSE` and `XML PARSE` are here for the opposite reason. Enterprise
 * COBOL needs no preprocessing for either; GnuCOBOL 3.2.0 compiles both, warns
 * that it has not implemented them, and then does nothing at run time — the
 * record is left untouched and no exception is raised, so a program reading a
 * payload runs clean and processes an empty record. Rewriting them into calls
 * on `BANKJSON` and `BANKXML` is what makes the local run mean anything.
 *
 * What this proves and what it does not:
 *
 * - It proves the surrounding COBOL is valid, that every host variable and
 *   data name referenced by an embedded block resolves, and that SQLCA fields
 *   such as SQLCODE are declared and usable.
 * - For a parse it proves more, because the runtime does something: the record
 *   is populated from the document, the handler of an `XML PARSE` is entered
 *   once per event, and the status the compiler tests afterwards is one the
 *   runtime set.
 * - It does not validate SQL semantics, Db2 bind behaviour, CICS runtime
 *   behaviour, or how IBM's parsers read a document. It is not IBM's
 *   precompiler and produces no bind artifacts.
 *
 * The translated output exists for verification. It is never the shipped
 * artifact; the artifact keeps its `EXEC SQL`, `EXEC CICS`, `JSON PARSE` and
 * `XML PARSE` exactly as written.
 */

import { toReferenceFormat } from "../../cobol-backend/src/reference-format";

export interface PrecompileResult {
  cobol: string;
  /** Number of `EXEC SQL` blocks translated. */
  sqlBlocks: number;
  /** Number of `EXEC CICS` blocks translated. */
  cicsBlocks: number;
}

/**
 * Local stand-ins for the IBM MQ copybooks.
 *
 * On z/OS `COPY CMQV`, `COPY CMQODV`, `COPY CMQMDV`, `COPY CMQPMOV` and
 * `COPY CMQGMOV` resolve from the MQ installation, and the artifact that ships
 * keeps them. None of them exists locally, so the local build gets these
 * instead: not IBM's copybooks and not copies of them, but the smallest
 * declaration that makes the generated program compile and run — the fields the
 * compiler actually sets, each at the size and value IBM's reference documents,
 * and a filler standing for the rest of the structure.
 *
 * The constants carry the values from the reference's tables of constants, so
 * the branches the generated program takes locally are the ones it would take
 * on z/OS: 2033 really is an empty queue.
 */
const MQ_CONSTANT_LINES = [
  "           05  MQCC-OK              PIC S9(9) BINARY VALUE 0.",
  "           05  MQCC-WARNING         PIC S9(9) BINARY VALUE 1.",
  "           05  MQCC-FAILED          PIC S9(9) BINARY VALUE 2.",
  "           05  MQRC-NONE            PIC S9(9) BINARY VALUE 0.",
  "           05  MQRC-NO-MSG-AVAILABLE PIC S9(9) BINARY VALUE 2033.",
  "           05  MQOT-Q               PIC S9(9) BINARY VALUE 1.",
  "           05  MQOO-INPUT-AS-Q-DEF  PIC S9(9) BINARY VALUE 1.",
  "           05  MQOO-OUTPUT          PIC S9(9) BINARY VALUE 16.",
  "           05  MQCO-NONE            PIC S9(9) BINARY VALUE 0.",
  "           05  MQPMO-SYNCPOINT      PIC S9(9) BINARY VALUE 2.",
  "           05  MQGMO-SYNCPOINT      PIC S9(9) BINARY VALUE 2.",
  "           05  MQGMO-NO-WAIT        PIC S9(9) BINARY VALUE 0.",
  "           05  MQGMO-WAIT           PIC S9(9) BINARY VALUE 1.",
  // Both are 24 null bytes, which is what asks the queue manager to supply an
  // identifier on a put and to match any message on a get.
  "           05  MQMI-NONE            PIC X(24) VALUE LOW-VALUES.",
  "           05  MQCI-NONE            PIC X(24) VALUE LOW-VALUES.",
];

/** The fields of each control block the emitter sets, by copybook name. */
const MQ_STRUCTURE_LINES: Record<string, string[]> = {
  CMQODV: [
    "           05  MQOD.",
    "               10  MQOD-OBJECTTYPE  PIC S9(9) BINARY VALUE 1.",
    "               10  MQOD-OBJECTNAME  PIC X(48) VALUE SPACES.",
    "               10  FILLER           PIC X(320) VALUE SPACES.",
  ],
  CMQMDV: [
    "           05  MQMD.",
    "               10  MQMD-MSGID       PIC X(24) VALUE LOW-VALUES.",
    "               10  MQMD-CORRELID    PIC X(24) VALUE LOW-VALUES.",
    "               10  FILLER           PIC X(316) VALUE SPACES.",
  ],
  CMQPMOV: [
    "           05  MQPMO.",
    "               10  MQPMO-OPTIONS    PIC S9(9) BINARY VALUE 0.",
    "               10  FILLER           PIC X(148) VALUE SPACES.",
  ],
  CMQGMOV: [
    "           05  MQGMO.",
    "               10  MQGMO-OPTIONS    PIC S9(9) BINARY VALUE 0.",
    "               10  FILLER           PIC X(108) VALUE SPACES.",
  ],
};

/** The Db2 runtime entry point that `EXEC SQL` calls after precompilation. */
const SQL_RUNTIME = "DSNHLI";

/** The CICS runtime entry point that `EXEC CICS` calls after translation. */
const CICS_RUNTIME = "DFHEI1";

/**
 * The SQLCA, as `EXEC SQL INCLUDE SQLCA` expands to.
 *
 * Declared here rather than assumed, so a program that reads SQLCODE is
 * checked against a real field of the right type.
 */
const SQLCA_LINES = [
  "       01  SQLCA.",
  "           05  SQLCAID       PIC X(8).",
  "           05  SQLCABC       PIC S9(9) COMP-5.",
  "           05  SQLCODE       PIC S9(9) COMP-5.",
  "           05  SQLERRM.",
  "               49  SQLERRML  PIC S9(4) COMP-5.",
  "               49  SQLERRMC  PIC X(70).",
  "           05  SQLERRP       PIC X(8).",
  "           05  SQLERRD       OCCURS 6 TIMES PIC S9(9) COMP-5.",
  "           05  SQLWARN.",
  "               10  SQLWARN0  PIC X.",
  "               10  SQLWARN1  PIC X.",
  "               10  SQLWARN2  PIC X.",
  "               10  SQLWARN3  PIC X.",
  "               10  SQLWARN4  PIC X.",
  "               10  SQLWARN5  PIC X.",
  "               10  SQLWARN6  PIC X.",
  "               10  SQLWARN7  PIC X.",
  "           05  SQLSTATE      PIC X(5).",
];

/**
 * The statement identifier passed with every translated `EXEC SQL`.
 *
 * Db2's precompiler numbers the statements in a program and passes a descriptor
 * for the one being executed, which is how DSNHLI knows what it was asked to
 * run. Numbering them here serves the same purpose: without it the runtime has
 * nothing to distinguish one call site from another, and cannot report anything
 * but success.
 */
const SQL_STATEMENT_FIELD = "SQL-STMT-NUMBER";

const SQL_STATEMENT_LINES = [`       01  ${SQL_STATEMENT_FIELD}     PIC 9(4).`];

/**
 * Where the translator records which command the runtime is being asked for.
 *
 * DFHEIV* is the translator's own namespace for the work fields it generates to
 * describe a command. Nothing in the operand list says which command it is, so
 * without this the runtime cannot tell a SYNCPOINT from a rollback.
 */
const CICS_COMMAND_FIELD = "DFHEIV-COMMAND";

/**
 * The EXEC interface block, as the CICS translator generates it.
 *
 * A command's response code is not returned in an operand; it arrives in
 * EIBRESP, and the translator emits the `MOVE` that copies it into whatever the
 * command's `RESP` option named. Declaring the block here is what lets a
 * generated program's error branch be reached at all.
 */
/**
 * The part of the EXEC interface block a generated program actually reads.
 *
 * Not the whole EIB — the real one carries around thirty fields — but the ones
 * this compiler emits references to. `EIBCALEN` is here because a program must
 * test it before touching `DFHCOMMAREA`: a commarea that was not passed is not
 * an empty record but storage belonging to something else, and reading it is a
 * storage violation.
 *
 * `EIBTRNID` and `EIBTASKN` come with it because they cost nothing and are what
 * anyone reading a dump asks for first.
 */
/** Storage the translator supplies to stand in for the caller's commarea. */
const CICS_COMMAREA_SIM = "DFHCOMMAREA-SIM";

/** The runtime `JSON PARSE` is rewritten to call. */
const JSON_RUNTIME = "BANKJSON";

/** The runtime `XML PARSE` is rewritten to call. */
const XML_RUNTIME = "BANKXML";

/**
 * Storage the JSON expansion works through.
 *
 * One name asked for, one value handed back, and whether it was there. The
 * document's length travels with it because a called program cannot see how
 * wide its caller's field is.
 */
const JSON_SHIM_LINES = [
  "       01  BANK-JSON-DOC-LEN    PIC S9(9) COMP-5 VALUE 0.",
  "       01  BANK-JSON-NAME       PIC X(30).",
  "       01  BANK-JSON-VALUE      PIC X(256).",
  "       01  BANK-JSON-FOUND      PIC X.",
];

/**
 * Storage the XML expansion works through, standing in for the registers.
 *
 * GnuCOBOL 3.2 reserves `XML-EVENT`, `XML-TEXT` and `XML-INFORMATION` as
 * special registers, but only a real `XML PARSE` sets them: `XML-TEXT` is a
 * zero-length register and a `MOVE` to it ends the run with a segmentation
 * fault. The generated handler is therefore pointed at these instead, which is
 * the same substitution the SQL and CICS translations make. What ships to z/OS
 * keeps the registers, because there they are the ones IBM fills in.
 *
 * `BANK-XML-TEXT-LEN` exists because the register it stands for is variable
 * length and this one cannot be. Every reference to `XML-TEXT` becomes a
 * reference modification by that length, so a `STRING ... DELIMITED BY SIZE`
 * still appends the characters of the event rather than a padded field.
 */
const XML_SHIM_LINES = [
  "       01  BANK-XML-DOC-LEN     PIC S9(9) COMP-5 VALUE 0.",
  "       01  BANK-XML-POS         PIC S9(9) COMP-5 VALUE 1.",
  "       01  BANK-XML-EVENT       PIC X(30).",
  "       01  BANK-XML-TEXT        PIC X(1024).",
  "       01  BANK-XML-TEXT-LEN    PIC S9(9) COMP-5 VALUE 1.",
  "       01  BANK-XML-INFO        PIC S9(9) COMP-5 VALUE 0.",
  "       01  BANK-XML-END         PIC X.",
];

/**
 * The registers a generated `XML PARSE` handler reads, and what they become.
 *
 * Matched as whole COBOL words: `BANK-XML-TEXT-LEN` holds `XML-TEXT` as a
 * substring, and rewriting that would leave the expansion referring to a field
 * that does not exist.
 */
const XML_REGISTERS: [RegExp, string][] = [
  [/(?<![A-Z0-9-])XML-EVENT(?![A-Z0-9-])/g, "BANK-XML-EVENT"],
  [/(?<![A-Z0-9-])XML-INFORMATION(?![A-Z0-9-])/g, "BANK-XML-INFO"],
  [
    /(?<![A-Z0-9-])XML-TEXT(?![A-Z0-9-])/g,
    "BANK-XML-TEXT(1:BANK-XML-TEXT-LEN)",
  ],
];

const CICS_EIB_LINES = [
  "       01  DFHEIBLK.",
  "           05  EIBTIME       PIC S9(7) COMP-3.",
  "           05  EIBDATE       PIC S9(7) COMP-3.",
  "           05  EIBTRNID      PIC X(4).",
  "           05  EIBTASKN      PIC S9(7) COMP-3.",
  "           05  EIBTRMID      PIC X(4).",
  "           05  FILLER        PIC S9(4) COMP.",
  "           05  EIBCPOSN      PIC S9(4) COMP.",
  // Preset, because this EIB is simulated: nothing local passes a commarea, so
  // a zero here would make every generated CICS program abend on its own
  // guard and no branch beyond it would ever be reached. The guard itself is
  // asserted against the generated source instead. On z/OS, CICS sets this.
  "           05  EIBCALEN      PIC S9(4) COMP VALUE 9999.",
  "           05  EIBAID        PIC X(1).",
  "           05  EIBFN         PIC X(2).",
  "           05  EIBRCODE      PIC X(6).",
  "           05  EIBDS         PIC X(8).",
  "           05  EIBREQID      PIC X(8).",
  "           05  EIBRSRCE      PIC X(8).",
  "           05  EIBSYNC       PIC X(1).",
  "           05  EIBFREE       PIC X(1).",
  "           05  EIBRECV       PIC X(1).",
  "           05  FILLER        PIC X(1).",
  "           05  EIBATT        PIC X(1).",
  "           05  EIBEOC        PIC X(1).",
  "           05  EIBFMH        PIC X(1).",
  "           05  EIBCOMPL      PIC X(1).",
  "           05  EIBSIG        PIC X(1).",
  "           05  EIBCONF       PIC X(1).",
  "           05  EIBERR        PIC X(1).",
  "           05  EIBERRCD      PIC X(4).",
  "           05  EIBSYNRB      PIC X(1).",
  "           05  EIBNODAT      PIC X(1).",
  "           05  EIBRESP       PIC S9(8) COMP.",
  "           05  EIBRESP2      PIC S9(8) COMP.",
  "           05  EIBRLDBK      PIC X(1).",
  `       01  ${CICS_COMMAND_FIELD}   PIC X(20).`,
];

/** An elementary item of a record, as the JSON expansion needs to name it. */
interface RecordItem {
  /** `AMOUNT OF ROW`, or `AMOUNT OF INNER OF ROW` inside a group. */
  reference: string;
  /** The name a JSON document would carry for it. */
  name: string;
  /** Whether the value has to be read as a number rather than moved. */
  numeric: boolean;
}

/**
 * The elementary items of every `01` record in working storage.
 *
 * `JSON PARSE` matches a document's names against the receiving record's own
 * data names — the record is the schema — so the expansion has to know what
 * that record contains. Read from the generated source rather than from the IR,
 * because a precompiler reads COBOL: that is the whole point of it running
 * where IBM's would.
 */
function collectRecordItems(lines: string[]): Map<string, RecordItem[]> {
  const records = new Map<string, RecordItem[]>();
  let stack: { level: number; name: string }[] = [];
  let current: RecordItem[] | null = null;
  let inFile = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^PROCEDURE\s+DIVISION\b/i.test(trimmed)) {
      break;
    }
    // A record inside an FD is the same names over again, and a program never
    // parses into one: the target is always the working-storage copy.
    if (/^FILE\s+SECTION\.$/i.test(trimmed)) {
      inFile = true;
      continue;
    }
    if (
      /^(WORKING-STORAGE|LOCAL-STORAGE|LINKAGE)\s+SECTION\.$/i.test(trimmed)
    ) {
      inFile = false;
      continue;
    }

    const entry = /^(\d{2})\s+([A-Z0-9-]+)\b(.*)$/i.exec(trimmed);
    if (!entry) {
      continue;
    }
    const level = Number(entry[1]);
    const name = entry[2];
    const rest = entry[3];
    // A condition name is not storage, and a renames names a run already there.
    if (level === 88 || level === 66) {
      continue;
    }

    if (level === 1) {
      stack = [{ level, name }];
      current = inFile ? null : [];
      if (current) {
        records.set(name, current);
      }
      continue;
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack.push({ level, name });

    if (current && /\bPIC\b/i.test(rest)) {
      // Qualified innermost-first, which is how COBOL reads a reference.
      const reference = [...stack]
        .reverse()
        .map((item) => item.name)
        .join(" OF ");
      current.push({
        reference,
        name,
        // A picture with a 9 in it holds a number, and the characters of a JSON
        // value have to be converted rather than moved into one.
        numeric: /\b(?:PIC|PICTURE)\s+[^.]*9/i.test(rest),
      });
    }
  }

  return records;
}

export function precompile(cobol: string): PrecompileResult {
  const lines = cobol.split("\n");
  const output: string[] = [];
  let sqlBlocks = 0;
  let cicsBlocks = 0;
  // Numbered separately from the block count, because a DECLARE CURSOR is read
  // at precompile time and never executed. Giving it a number would shift every
  // statement after it and make a scripted outcome name the wrong one.
  let sqlStatements = 0;

  const usesSql = /^\s*EXEC\s+SQL\b/im.test(cobol);
  const usesCics = /^\s*EXEC\s+CICS\b/im.test(cobol);
  // A commarea is storage the caller owns and CICS makes addressable before the
  // program starts. Nothing does that locally, so an unaddressed LINKAGE item
  // would be read as whatever the process happens to have there. The translator
  // supplies an area and points the commarea at it, which is what CICS does.
  const usesCommarea = usesCics && /^\s*01\s+DFHCOMMAREA\./im.test(cobol);
  // GnuCOBOL compiles JSON PARSE and XML PARSE, warns that it implements
  // neither, and then does nothing at run time — the record is left untouched
  // and no exception is raised, so a program reading a payload runs clean and
  // processes an empty record. Both are expanded here for the same reason
  // EXEC SQL and EXEC CICS are: what ships to z/OS keeps the statement, and
  // the local build gets something it can execute.
  const usesJsonParse = /^\s*JSON\s+PARSE\b/im.test(cobol);
  const usesXmlParse = /^\s*XML\s+PARSE\b/im.test(cobol);
  const recordItems = usesJsonParse
    ? collectRecordItems(lines)
    : new Map<string, RecordItem[]>();
  let awaitingParagraph = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    // Translator-owned storage goes in immediately, the way IBM's translators
    // inject their own control blocks rather than asking for them.
    if (/^WORKING-STORAGE\s+SECTION\.$/i.test(trimmed)) {
      output.push(line);
      if (usesSql) {
        output.push("      *> Statement descriptor added by the precompiler.");
        output.push(...SQL_STATEMENT_LINES);
      }
      if (usesCics) {
        output.push("      *> EXEC interface block added by the translator.");
        output.push(...CICS_EIB_LINES);
      }
      if (usesCommarea) {
        output.push(
          "      *> Commarea storage, which CICS itself would own.",
          `       01  ${CICS_COMMAREA_SIM}  PIC X(9999).`,
        );
      }
      if (usesJsonParse) {
        output.push("      *> JSON parse storage added by the precompiler.");
        output.push(...JSON_SHIM_LINES);
      }
      if (usesXmlParse) {
        output.push("      *> XML parse storage added by the precompiler.");
        output.push(...XML_SHIM_LINES);
      }
      continue;
    }

    // The MQ copybooks resolve from the MQ installation on z/OS and from
    // nowhere at all here. The artifact keeps the COPY; the local build gets a
    // stand-in of the fields the compiler sets.
    const mqCopy = /^COPY\s+(CMQ[A-Z]+)\b[^.]*\.$/i.exec(trimmed);
    if (mqCopy) {
      const name = mqCopy[1].toUpperCase();
      if (name === "CMQV") {
        output.push("      *> MQ constants supplied by the precompiler.");
        output.push(...MQ_CONSTANT_LINES);
        continue;
      }
      const structure = MQ_STRUCTURE_LINES[name];
      if (structure) {
        output.push("      *> MQ control block supplied by the precompiler.");
        output.push(...structure);
        continue;
      }
    }

    if (usesJsonParse && /^JSON\s+PARSE\b/i.test(trimmed)) {
      const block = readBlock(lines, index, /^END-JSON\b/i);
      index = block.last;
      output.push(...translateJsonParse(block, recordItems));
      continue;
    }

    if (usesXmlParse && /^XML\s+PARSE\b/i.test(trimmed)) {
      const block = readBlock(lines, index, /^END-XML\b/i);
      index = block.last;
      output.push(...translateXmlParse(block));
      continue;
    }

    // `EXEC SQL INCLUDE SQLCA END-EXEC.` expands to the structure itself.
    if (/^EXEC\s+SQL\s+INCLUDE\s+SQLCA\s+END-EXEC\.?$/i.test(trimmed)) {
      output.push("      *> SQLCA expanded by the BankLang precompiler.");
      output.push(...SQLCA_LINES);
      continue;
    }

    // Addressability, established where CICS would have established it. It has
    // to go inside the first paragraph rather than straight after the division
    // header: a statement before the first label is not COBOL.
    if (usesCommarea && /^PROCEDURE\s+DIVISION\b.*\.$/i.test(trimmed)) {
      awaitingParagraph = true;
      output.push(line);
      continue;
    }
    if (awaitingParagraph && /^[A-Z0-9][A-Z0-9-]*\.$/i.test(trimmed)) {
      awaitingParagraph = false;
      output.push(line);
      output.push(
        "      *> Commarea addressability, which CICS establishes on entry.",
        `           SET ADDRESS OF DFHCOMMAREA TO ADDRESS OF ${CICS_COMMAREA_SIM}`,
      );
      continue;
    }

    const execMatch = /^EXEC\s+(SQL|CICS)\b(.*)$/i.exec(trimmed);
    if (!execMatch) {
      output.push(line);
      continue;
    }

    const kind = execMatch[1].toUpperCase() as "SQL" | "CICS";
    const indent = line.slice(0, line.length - line.trimStart().length);

    // Collect the block, which may be on one line or span several.
    let body = execMatch[2];
    let closed = /END-EXEC/i.test(body);
    while (!closed && index + 1 < lines.length) {
      index += 1;
      body += `\n${lines[index]}`;
      closed = /END-EXEC/i.test(lines[index]);
    }
    // A block written `END-EXEC.` terminates the COBOL sentence, so the
    // period has to survive translation or the paragraph loses its terminator.
    const terminated = /END-EXEC\s*\./i.test(body);
    body = body.replace(/END-EXEC\s*\.?/i, "");

    if (kind === "SQL") {
      sqlBlocks += 1;
      // A declare-section marker is removed rather than translated, and it is
      // not a statement, so it does not take a statement number — the numbers
      // are what a test scripts an outcome against.
      if (isDeclareSectionMarker(body)) {
        output.push(
          `${indent}*> Declare section marker read by the BankLang precompiler.`,
        );
      } else if (isCursorDeclaration(body)) {
        output.push(...translateCursorDeclaration(body, indent));
      } else {
        sqlStatements += 1;
        output.push(...translateSql(body, indent, terminated, sqlStatements));
      }
    } else {
      cicsBlocks += 1;
      output.push(...translateCics(body, indent, terminated));
    }
  }

  // The handler section reads the XML registers, and it is emitted a long way
  // from the statement that drives it, so the substitution is made over the
  // whole program rather than inside the block.
  const rewritten = usesXmlParse
    ? output.map((line) =>
        XML_REGISTERS.reduce(
          (text, [pattern, replacement]) => text.replace(pattern, replacement),
          line,
        ),
      )
    : output;

  // A translated block is longer than the `EXEC` it replaces — a call with its
  // whole host-variable list on one line — so the output has to be laid out
  // again. IBM's own precompiler writes reference format for the same reason.
  return {
    cobol: rewritten.flatMap((line) => toReferenceFormat(line)).join("\n"),
    sqlBlocks,
    cicsBlocks,
  };
}

/** A statement read whole, from its first line to its scope terminator. */
interface ParseBlock {
  /** The lines of the statement, trimmed, without the terminator. */
  body: string[];
  /** The statements of an `ON EXCEPTION` phrase, at their own indent. */
  onException: string[];
  /** Column the statement started in, so the expansion sits where it did. */
  indent: string;
  /** Index of the terminator line, so the caller can resume past it. */
  last: number;
  /** True when the terminator ended the COBOL sentence with a period. */
  terminated: boolean;
}

/**
 * Read a statement from its first line to `END-JSON` or `END-XML`.
 *
 * The `ON EXCEPTION` phrase is separated out, because the expansion has to run
 * it from somewhere else: there is no statement left for it to hang off.
 */
function readBlock(
  lines: string[],
  start: number,
  terminator: RegExp,
): ParseBlock {
  const indent = lines[start].slice(
    0,
    lines[start].length - lines[start].trimStart().length,
  );
  const body: string[] = [];
  const onException: string[] = [];
  let inException = false;
  let index = start;

  for (; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (terminator.test(trimmed)) {
      break;
    }
    if (/^ON\s+EXCEPTION\b/i.test(trimmed)) {
      inException = true;
      continue;
    }
    if (inException) {
      onException.push(lines[index]);
    } else {
      body.push(trimmed);
    }
  }

  return {
    body,
    onException,
    indent,
    last: index,
    terminated: /\.\s*$/.test(lines[Math.min(index, lines.length - 1)]),
  };
}

/**
 * `JSON PARSE <text> INTO <record>` becomes one call per item of the record.
 *
 * COBOL matches a document's names against the receiving record's own data
 * names, so asking the runtime for each item by name is the same question the
 * statement asks — and the record ends up populated rather than untouched,
 * which is the whole difference between this and what GnuCOBOL does with the
 * statement it will not implement.
 *
 * `JSON-STATUS` and `JSON-CODE` are real registers under GnuCOBOL and are set
 * here with the values IBM documents: status 1 for "one or more data items had
 * no matching JSON name/value pair, and thus were not changed", and code 101
 * for text that "was zero-length, or consisted only of whitespace". The test
 * the compiler emits after the statement then reads a value it did not invent.
 */
function translateJsonParse(
  block: ParseBlock,
  records: Map<string, RecordItem[]>,
): string[] {
  const { indent } = block;
  const statement = block.body.join(" ").replace(/\s+/g, " ");
  const match = /^JSON\s+PARSE\s+(\S+)\s+INTO\s+(\S+?)\.?$/i.exec(statement);
  if (!match) {
    // Not a shape this understands. Leaving it alone is better than rewriting
    // it into something that compiles and means something else.
    return [
      ...block.body.map((line) => `${indent}${line}`),
      `${indent}END-JSON`,
    ];
  }

  const [, document, record] = match;
  const items = records.get(record.toUpperCase()) ?? [];
  const inner = `${indent}    `;
  const out = [
    `${indent}*> JSON PARSE expanded by the BankLang precompiler.`,
    `${indent}MOVE 0 TO JSON-STATUS`,
    `${indent}MOVE 0 TO JSON-CODE`,
    `${indent}MOVE LENGTH OF ${document} TO BANK-JSON-DOC-LEN`,
    `${indent}IF FUNCTION TRIM(${document}) = SPACES`,
    `${inner}MOVE 101 TO JSON-CODE`,
  ];
  // An empty document is the exception condition, so the handler the program
  // wrote is what runs. Without one there is nothing to do but record the code.
  out.push(
    ...(block.onException.length > 0
      ? block.onException
      : [`${inner}CONTINUE`]),
  );
  out.push(`${indent}ELSE`);

  for (const item of items) {
    out.push(
      `${inner}MOVE "${item.name}" TO BANK-JSON-NAME`,
      `${inner}CALL "${JSON_RUNTIME}" USING ${document}, BANK-JSON-DOC-LEN, BANK-JSON-NAME, BANK-JSON-VALUE, BANK-JSON-FOUND`,
      `${inner}IF BANK-JSON-FOUND = "Y"`,
      item.numeric
        ? `${inner}    COMPUTE ${item.reference} = FUNCTION NUMVAL(BANK-JSON-VALUE)`
        : `${inner}    MOVE BANK-JSON-VALUE TO ${item.reference}`,
      `${inner}ELSE`,
      `${inner}    MOVE 1 TO JSON-STATUS`,
      `${inner}END-IF`,
    );
  }
  if (items.length === 0) {
    out.push(`${inner}CONTINUE`);
  }

  out.push(`${indent}END-IF${block.terminated ? "." : ""}`);
  return out;
}

/**
 * `XML PARSE <text> PROCESSING PROCEDURE <section>` becomes the loop the
 * statement is.
 *
 * `XML PARSE` calls the handler once per event. A subprogram cannot `PERFORM`
 * a section in its caller, so the loop stays here and the runtime is one step
 * of it: given a position it describes the next event and moves the position
 * past it. That is the same control flow the statement has, which is what makes
 * running it worth anything — the handler is entered, its `EVALUATE` picks a
 * branch, and the record is filled from the document.
 */
function translateXmlParse(block: ParseBlock): string[] {
  const { indent } = block;
  const statement = block.body.join(" ").replace(/\s+/g, " ");
  const match =
    /^XML\s+PARSE\s+(\S+)\s+PROCESSING\s+PROCEDURE\s+(\S+?)\.?$/i.exec(
      statement,
    );
  if (!match) {
    return [
      ...block.body.map((line) => `${indent}${line}`),
      `${indent}END-XML`,
    ];
  }

  const [, document, handler] = match;
  const inner = `${indent}    `;
  const loop = [
    `${inner}PERFORM UNTIL BANK-XML-END = "Y"`,
    `${inner}    CALL "${XML_RUNTIME}" USING ${document}, BANK-XML-DOC-LEN, BANK-XML-POS, BANK-XML-EVENT, BANK-XML-TEXT, BANK-XML-TEXT-LEN, BANK-XML-INFO, BANK-XML-END`,
    `${inner}    IF BANK-XML-END NOT = "Y"`,
    `${inner}        PERFORM ${handler}`,
    `${inner}    END-IF`,
    `${inner}END-PERFORM`,
  ];

  const out = [
    `${indent}*> XML PARSE expanded by the BankLang precompiler.`,
    `${indent}MOVE LENGTH OF ${document} TO BANK-XML-DOC-LEN`,
    `${indent}MOVE 1 TO BANK-XML-POS`,
    `${indent}MOVE "N" TO BANK-XML-END`,
  ];

  if (block.onException.length > 0) {
    // A document with nothing in it is the exception condition. Anything else
    // this scanner meets, it steps over rather than failing on, so the handler
    // runs on the events there were.
    out.push(
      `${indent}IF FUNCTION TRIM(${document}) = SPACES`,
      ...block.onException,
      `${indent}ELSE`,
      ...loop,
      `${indent}END-IF${block.terminated ? "." : ""}`,
    );
    return out;
  }

  out.push(...loop.map((line) => line.slice(4)));
  if (block.terminated) {
    out[out.length - 1] = `${out[out.length - 1]}.`;
  }
  return out;
}

/**
 * `EXEC SQL ... END-EXEC` becomes a call into the SQL runtime, passing SQLCA
 * and every host variable the statement referenced.
 *
 * Passing the host variables is the point: the compiler then verifies each one
 * exists and is a usable data item, which is most of what the real precompiler
 * checks structurally.
 */
function translateSql(
  body: string,
  indent: string,
  terminated: boolean,
  statementNumber: number,
): string[] {
  const hostVariables = extractHostVariables(body);
  const operands = ["SQLCA", SQL_STATEMENT_FIELD, ...hostVariables];

  return [
    `${indent}*> EXEC SQL translated by the BankLang precompiler.`,
    ...commentedSource(body, indent),
    `${indent}MOVE ${String(statementNumber).padStart(4, "0")} TO ${SQL_STATEMENT_FIELD}`,
    `${indent}CALL "${SQL_RUNTIME}" USING ${operands.join(", ")}${terminated ? "." : ""}`,
  ];
}

/** True for `DECLARE <name> CURSOR FOR ...`, which declares rather than runs. */
function isCursorDeclaration(body: string): boolean {
  return /^\s*DECLARE\b[\s\S]*\bCURSOR\b/i.test(body);
}

/**
 * True for `BEGIN DECLARE SECTION` and `END DECLARE SECTION`.
 *
 * These mark the host variables for the precompiler and are not statements: Db2
 * removes them, leaving the declarations they surround. Translating one into a
 * call would put an executable statement in the DATA DIVISION, where none may
 * appear — which is exactly what happened when the section was first emitted.
 */
function isDeclareSectionMarker(body: string): boolean {
  return /^\s*(BEGIN|END)\s+DECLARE\s+SECTION\s*$/i.test(
    body.replace(/END-EXEC\.?/i, "").trim(),
  );
}

/**
 * A cursor declaration becomes a comment, which is what Db2's precompiler does
 * with it.
 *
 * `DECLARE CURSOR` is not executable: the precompiler reads it to build the
 * statement it will later run for `OPEN`, and emits nothing the COBOL compiler
 * has to understand. Translating it into a call would put an executable
 * statement in the DATA DIVISION, where no statement may appear at all.
 */
function translateCursorDeclaration(body: string, indent: string): string[] {
  return [
    `${indent}*> DECLARE CURSOR read by the BankLang precompiler.`,
    ...commentedSource(body, indent),
  ];
}

/**
 * `EXEC CICS ... END-EXEC` becomes a call into the CICS runtime, passing every
 * data item the command referenced so those names are still checked.
 *
 * A command's `RESP` option is not an operand the runtime writes to. CICS
 * returns the response in EIBRESP, and the translator copies it out afterwards,
 * so that is what happens here too.
 */
function translateCics(
  body: string,
  indent: string,
  terminated: boolean,
): string[] {
  const respTarget = extractCicsRespTarget(body);
  const operands = extractCicsOperands(body).filter(
    (operand) => operand !== respTarget,
  );
  const trailing = terminated ? "." : "";
  const callSuffix = respTarget ? "" : trailing;
  const call = `${indent}CALL "${CICS_RUNTIME}" USING DFHEIBLK, ${CICS_COMMAND_FIELD}${operands.length > 0 ? `, ${operands.join(", ")}` : ""}${callSuffix}`;

  return [
    `${indent}*> EXEC CICS translated by the BankLang precompiler.`,
    ...commentedSource(body, indent),
    `${indent}MOVE "${extractCicsCommand(body)}" TO ${CICS_COMMAND_FIELD}`,
    call,
    ...(respTarget
      ? [`${indent}MOVE EIBRESP TO ${respTarget}${trailing}`]
      : []),
  ];
}

/** Keeps the original statement visible as a comment for review. */
function commentedSource(body: string, indent: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${indent}*>   ${line}`);
}

/**
 * Host variables in a SQL statement, in order and without duplicates.
 *
 * A reference may be qualified (`:FIELD OF RECORD`), which is how BankLang
 * binds a result field, so the qualification is preserved.
 */
function extractHostVariables(body: string): string[] {
  const found: string[] = [];
  const pattern = /:([A-Za-z][A-Za-z0-9-]*)(\s+OF\s+([A-Za-z][A-Za-z0-9-]*))?/g;

  for (const match of body.matchAll(pattern)) {
    const reference = match[3] ? `${match[1]} OF ${match[3]}` : match[1];
    if (!found.includes(reference)) {
      found.push(reference);
    }
  }

  return found;
}

/**
 * The command itself, without its options.
 *
 * Everything from the first parenthesised option onwards is an argument, so
 * `SYNCPOINT ROLLBACK RESP(WS-RESP)` is the command `SYNCPOINT ROLLBACK` and
 * `LINK PROGRAM("X") COMMAREA(Y)` is the command `LINK`.
 */
function extractCicsCommand(body: string): string {
  const words = body.trim().split(/\s+/);
  const options = words.findIndex((word) => word.includes("("));
  return (options === -1 ? words : words.slice(0, options))
    .join(" ")
    .toUpperCase()
    .slice(0, 20);
}

/** The data item a command's `RESP` option names, if it has one. */
function extractCicsRespTarget(body: string): string | null {
  const match = /\bRESP\s*\(\s*([A-Za-z][A-Za-z0-9-]*)\s*\)/i.exec(body);
  return match ? match[1] : null;
}

/**
 * Data items referenced by a CICS command: the contents of COMMAREA(...),
 * RESP(...), and similar parenthesised options, excluding quoted literals.
 */
function extractCicsOperands(body: string): string[] {
  const found: string[] = [];

  for (const match of body.matchAll(/\(([^)]*)\)/g)) {
    const inner = match[1].trim();
    if (inner.length === 0 || inner.startsWith('"') || inner.startsWith("'")) {
      continue;
    }
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(inner)) {
      continue;
    }
    if (!found.includes(inner)) {
      found.push(inner);
    }
  }

  return found;
}
