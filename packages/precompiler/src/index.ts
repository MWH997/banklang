/**
 * A precompiler for embedded SQL and CICS.
 *
 * IBM's Db2 precompiler and CICS translator replace `EXEC SQL` and `EXEC CICS`
 * blocks with calls into their runtimes before the COBOL compiler ever sees
 * them. This module does the same thing structurally, so the generated program
 * can be compiled and checked locally.
 *
 * What this proves and what it does not:
 *
 * - It proves the surrounding COBOL is valid, that every host variable and
 *   data name referenced by an embedded block resolves, and that SQLCA fields
 *   such as SQLCODE are declared and usable.
 * - It does not validate SQL semantics, Db2 bind behaviour, or CICS runtime
 *   behaviour. It is not IBM's precompiler and produces no bind artifacts.
 *
 * The translated output exists for verification. It is never the shipped
 * artifact; the artifact keeps its `EXEC SQL` and `EXEC CICS` blocks.
 */

export interface PrecompileResult {
  cobol: string;
  /** Number of `EXEC SQL` blocks translated. */
  sqlBlocks: number;
  /** Number of `EXEC CICS` blocks translated. */
  cicsBlocks: number;
}

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

  return { cobol: output.join("\n"), sqlBlocks, cicsBlocks };
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
