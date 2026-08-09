/**
 * Running the generated COBOL in the browser.
 *
 * The playground compiled a program and then had nothing to run it with, so a
 * reader could see the COBOL and never find out what it did. This closes that:
 * the COBOL in the output pane is precompiled exactly as it is on the way to
 * `cobc`, loaded alongside the reference runtime from `runtime/`, and executed
 * by `packages/cobol-runtime`.
 *
 * The runtime programs are the same files CI compiles and links — not a
 * JavaScript imitation of a ledger. `BANKLEDG` holds the balances, `BANKAUDT`
 * appends the audit log, `DSNHLI` and `DFHEI1` answer the SQL and CICS calls.
 * A JavaScript stand-in would have been far less work and would have meant that
 * what runs here and what runs in CI were two different things.
 */

import {
  auditOf,
  balancesOf,
  CobolRuntimeError,
  CobolSyntaxError,
  CobolUnsupportedError,
  journalOf,
  runCobol,
  type RunResult,
} from "../../cobol-runtime/src/index";
import { precompile } from "../../precompiler/src/index";
import type { CursorRows } from "./inputs";

import BANKLEDG from "../../../runtime/BANKLEDG.cbl?raw";
import BANKAUDT from "../../../runtime/BANKAUDT.cbl?raw";
import DSNHLI from "../../../runtime/DSNHLI.cbl?raw";
import DFHEI1 from "../../../runtime/DFHEI1.cbl?raw";
import CBLTDLI from "../../../runtime/CBLTDLI.cbl?raw";
import BANKMQ from "../../../runtime/BANKMQ.cbl?raw";
import BANKJSON from "../../../runtime/BANKJSON.cbl?raw";
import BANKXML from "../../../runtime/BANKXML.cbl?raw";

/** The reference runtime, precompiled once per page load. */
const RUNTIME = [
  BANKLEDG,
  BANKAUDT,
  DSNHLI,
  DFHEI1,
  CBLTDLI,
  BANKMQ,
  BANKJSON,
  BANKXML,
].map((source) => precompile(source).cobol);

/** The name of the driver that supplies a PARM, when the program takes one. */
const DRIVER = "BANKDRIV";

/** The widest PARM a job step can pass, which is what the driver declares. */
const PARM_LENGTH = 512;

/**
 * A main program that hands the generated program a parameter area.
 *
 * A batch entered with `PARM=` has `PROCEDURE DIVISION USING`, and something
 * has to build the list. On z/OS that is the initiator; here it is this.
 *
 * An empty `parm` is a job step started with no `PARM=`: length zero and blank
 * data, which is what the program's own validation is written to reject. The
 * Input panel is what fills it, so a reader can see both — the refusal, and the
 * run it was refusing on behalf of.
 */
function parmDriver(program: string, parm: string): string {
  const text = parm.slice(0, PARM_LENGTH);
  return [
    "       IDENTIFICATION DIVISION.",
    `       PROGRAM-ID. ${DRIVER}.`,
    "",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  BANK-PARM.",
    `           05  BANK-PARM-LENGTH     PIC S9(4) COMP VALUE ${String(text.length)}.`,
    `           05  BANK-PARM-DATA       PIC X(${String(PARM_LENGTH)}).`,
    "",
    "       PROCEDURE DIVISION.",
    "       DRIVE.",
    ...parmMoves(text),
    `           CALL "${program}" USING BANK-PARM`,
    "           GOBACK.",
    "",
  ].join("\n");
}

/** The widest literal these MOVEs put on one line, well inside Area B. */
const LITERAL_CHUNK = 20;

/**
 * The PARM text, moved into the parameter area in pieces.
 *
 * One `MOVE "…" TO BANK-PARM-DATA` would be the obvious way to write this, and
 * it was, back when the Input panel seeded every PARM blank and the literal was
 * therefore never longer than `SPACES`. A real PARM is up to 512 characters and
 * COBOL is still a fixed-format language: the statement ran past column 72, the
 * reader saw a literal with no closing quote, and the program the reader was
 * trying to run would not parse. Reference modification names the positions
 * instead, which keeps this equivalent to the single MOVE it replaces.
 */
function parmMoves(text: string): string[] {
  const lines = ["           MOVE SPACES TO BANK-PARM-DATA"];

  for (let at = 0; at < text.length;) {
    // Measured after doubling any quote, because that is what lands on the
    // line — a reader may well type one into the panel.
    let taken = 0;
    let literal = "";
    while (at + taken < text.length) {
      const next = text[at + taken] === '"' ? '""' : text[at + taken]!;
      if (literal.length + next.length > LITERAL_CHUNK) {
        break;
      }
      literal += next;
      taken += 1;
    }
    lines.push(
      `           MOVE "${literal}" TO BANK-PARM-DATA(${String(at + 1)}:${String(taken)})`,
    );
    at += taken;
  }

  return lines;
}

/** What the Input panel supplies, as bytes the runtime understands. */
export interface RunInputs {
  /** Records to place in the entry program's storage, by 01-level name. */
  storage?: Map<string, Uint8Array>;
  /** Datasets present before the run, by the DD name the SELECT assigns to. */
  files?: Map<string, Uint8Array[]>;
  /** The PARM the step is started with. Empty means no `PARM=` at all. */
  parm?: string;
  /** Rows each named cursor answers with, as bytes per host variable. */
  cursorRows?: CursorRows[];
}

/** SQLSTATE for end of data, which is what a cursor runs out with. */
const END_OF_DATA = "02000";

/**
 * The script `runtime/DSNHLI.cbl` reads, built from the panel's row counts.
 *
 * Statement numbers are read back out of the precompiled text rather than
 * counted: the precompiler assigns them, writes `MOVE nnnn TO SQL-STMT-NUMBER`
 * before each call, and leaves the statement it translated in a comment above
 * it. Matching on that pair is reading the number it chose.
 *
 * Without this every FETCH succeeded, because DSNHLI succeeds anything it has
 * no script for. A cursor loop then ended only by reaching its own bound —
 * `branch-accrual-cursor` read 5000 empty rows and ended the step with return
 * code 12, which reads as a broken program rather than as an unscripted stub.
 */
export interface SqlOutcomeLine {
  statement: number;
  sqlcode: number;
  sqlstate?: string;
  /** Calls this line answers; omitted means every remaining one. */
  times?: number;
}

/**
 * What the panel's row counts mean as a script, before it is written anywhere.
 *
 * Returned structured rather than as bytes so
 * `tests/cobol-runtime-differential.test.ts` can hand the same script to
 * `cobc`. The browser and GnuCOBOL running one cursor to different lengths
 * would be two answers to the same question with nothing comparing them.
 */
export function sqlOutcomesFor(
  translated: string,
  cursors: readonly CursorRows[],
): SqlOutcomeLine[] {
  const outcomes: SqlOutcomeLine[] = [];

  for (const cursor of cursors) {
    const statement = fetchStatementNumber(translated, cursor.cursor);
    if (statement === null) {
      continue;
    }
    const calls = callsOf(cursor).length;
    if (calls > 0) {
      outcomes.push({ statement, sqlcode: 0, times: calls });
    }
    // Then end of data, for every remaining fetch: no count means "all the
    // rest", which is how the cursor stops.
    outcomes.push({ statement, sqlcode: 100, sqlstate: END_OF_DATA });
  }

  return outcomes;
}

/**
 * The rows a cursor delivers, grouped into the calls that deliver them.
 *
 * A single-row `FETCH` takes one row per call. A rowset `FETCH ... FOR n ROWS`
 * takes up to n at a time into host-variable arrays, so the same rows are one
 * call per set — and `SQLERRD(3)` tells the loop how many arrived, which is
 * what makes the last, partial set the one it must still process.
 */
function callsOf(cursor: CursorRows): Uint8Array[][][] {
  const perCall = cursor.rowset ?? 1;
  const calls: Uint8Array[][][] = [];
  for (let at = 0; at < cursor.rows.length; at += perCall) {
    calls.push(cursor.rows.slice(at, at + perCall));
  }
  return calls;
}

/**
 * The rows themselves, as the lines `runtime/DSNHLI.cbl` reads.
 *
 * `stmt call row var len hex` — which statement, which call of it, which row
 * that call delivers, which host variable of that row by its position in the
 * generated CALL, how many bytes, and the bytes. Hex because a row carries
 * packed decimal as often as text and a byte of packed decimal is not something
 * a `lineSequential` file can hold.
 */
export function sqlRowRecords(
  translated: string,
  cursors: readonly CursorRows[],
): Uint8Array[] {
  const encoder = new TextEncoder();
  const lines: string[] = [];

  for (const cursor of cursors) {
    const statement = fetchStatementNumber(translated, cursor.cursor);
    if (statement === null) {
      continue;
    }
    callsOf(cursor).forEach((call, sequence) => {
      call.forEach((row, within) => {
        row.forEach((value, variable) => {
          if (value.length === 0) {
            return;
          }
          lines.push(
            [
              String(statement).padStart(4, "0"),
              String(sequence + 1).padStart(4, "0"),
              String(within + 1).padStart(4, "0"),
              String(variable + 1).padStart(2, "0"),
              String(value.length).padStart(4, "0"),
              [...value]
                .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
                .join(""),
            ].join(" "),
          );
        });
      });
    });
  }

  return lines.map((line) => encoder.encode(line));
}

/** The same script, as the lines `runtime/DSNHLI.cbl` reads. */
function sqlOutcomeRecords(outcomes: SqlOutcomeLine[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return outcomes.map((outcome) =>
    encoder.encode(
      [
        String(outcome.statement).padStart(4, "0"),
        `${outcome.sqlcode < 0 ? "-" : "+"}${String(Math.abs(outcome.sqlcode)).padStart(3, "0")}`,
        outcome.sqlstate ?? "00000",
        String(outcome.times ?? 0).padStart(4, "0"),
      ].join(" "),
    ),
  );
}

/** The statement number the precompiler gave `FETCH <cursor>`. */
function fetchStatementNumber(
  translated: string,
  cursor: string,
): number | null {
  const name = cursor.replace(/[^A-Za-z0-9]/g, "");
  // The COBOL name of the cursor, as the precompiler writes it in the comment.
  // `FETCH <name>` for a single row, `FETCH NEXT ROWSET FROM <name>` for a
  // rowset. The comment wraps, so the name may sit on a continuation line.
  const pattern = new RegExp(
    `\\*>\\s*FETCH\\s+(?:NEXT\\s+ROWSET\\s+FROM\\s+)?([A-Z0-9-]+)[\\s\\S]{0,400}?MOVE\\s+(\\d{4})\\s+TO\\s+SQL-STMT-NUMBER`,
    "gi",
  );
  for (const match of translated.matchAll(pattern)) {
    if (
      (match[1] ?? "").replace(/-/g, "").toUpperCase() === name.toUpperCase()
    ) {
      return match[2] === undefined ? null : Number(match[2]);
    }
  }
  return null;
}

export interface RunOutcome {
  ok: boolean;
  /** Input datasets the program opens that nothing supplied. */
  missingInputs: string[];
  /** Set when the program could not be run at all, with the reason. */
  refusal: string | null;
  returnCode: number;
  sysout: string[];
  journal: string[];
  balances: [string, string][];
  audit: string[];
  /** Datasets the program wrote, keyed by DD name. */
  datasets: { name: string; records: string[] }[];
  steps: number;
  milliseconds: number;
}

/** DD names the reference runtime uses for its own bookkeeping. */
const RUNTIME_FILES = new Set([
  "ledger-journal.txt",
  "ledger-balances.txt",
  "audit-log.txt",
  "sql-calls.txt",
  "cics-calls.txt",
  "sql-outcomes.txt",
  "cics-outcomes.txt",
  "ims-calls.txt",
  "mq-calls.txt",
]);

const decoder = new TextDecoder();

export function run(cobol: string, inputs: RunInputs = {}): RunOutcome {
  const started = performance.now();
  const empty: Omit<RunOutcome, "ok" | "refusal" | "milliseconds"> = {
    missingInputs: [],
    returnCode: 0,
    sysout: [],
    journal: [],
    balances: [],
    audit: [],
    datasets: [],
    steps: 0,
  };

  let translated: string;
  try {
    translated = precompile(cobol).cobol;
  } catch (error) {
    return {
      ...empty,
      ok: false,
      refusal: `The embedded SQL or CICS could not be translated: ${message(error)}`,
      milliseconds: performance.now() - started,
    };
  }

  const program = /^\s*PROGRAM-ID\.\s+([A-Z0-9-]+)/im.exec(translated)?.[1];
  const takesParm = /^\s{7}PROCEDURE\s+DIVISION\s+USING\b/m.test(translated);

  // The Db2 script sits beside the program under a fixed name, exactly as the
  // conformance harness writes it, so nothing in the generated program has to
  // know about it.
  const cursors = inputs.cursorRows ?? [];
  const outcomes = sqlOutcomesFor(translated, cursors);
  const files =
    outcomes.length > 0
      ? new Map([
          ...(inputs.files ?? []),
          ["sql-outcomes.txt", sqlOutcomeRecords(outcomes)],
          ["sql-rows.txt", sqlRowRecords(translated, cursors)],
        ])
      : inputs.files;

  let result: RunResult;
  try {
    result = runCobol({
      sources:
        takesParm && program
          ? [parmDriver(program, inputs.parm ?? ""), translated, ...RUNTIME]
          : [translated, ...RUNTIME],
      files,
      storage: inputs.storage,
      // A browser tab cannot be interrupted, so a program that never ends has
      // to stop itself. Low enough to keep the page responsive, high enough
      // that no example in the repository reaches it.
      stepLimit: 2_000_000,
    });
  } catch (error) {
    return {
      ...empty,
      ok: false,
      refusal: message(error),
      milliseconds: performance.now() - started,
    };
  }

  const datasets = [...result.files]
    .filter(([name]) => !RUNTIME_FILES.has(name))
    .map(([name, records]) => ({
      name,
      records: records.map((record) => decoder.decode(record)),
    }));

  return {
    ok: true,
    refusal: null,
    missingInputs: inputDatasets(translated).filter(
      (name) => !inputs.files?.has(name),
    ),
    returnCode: result.returnCode,
    sysout: result.sysout,
    journal: journalOf(result),
    balances: [...balancesOf(result)],
    audit: auditOf(result),
    datasets,
    steps: result.steps,
    milliseconds: performance.now() - started,
  };
}

/**
 * A refusal a reader can act on.
 *
 * The three error classes mean different things and the message says which:
 * a construct that is not implemented is a limit of this interpreter, a syntax
 * error is a program it could not read at all, and a runtime error is the
 * program going wrong while it ran.
 */
function message(error: unknown): string {
  if (error instanceof CobolUnsupportedError) {
    return `${error.message} This is a limit of the in-browser interpreter, not of the compiler: the program still compiles, and CI runs it under GnuCOBOL.`;
  }
  if (error instanceof CobolSyntaxError) {
    return `The generated COBOL could not be read: ${error.message}`;
  }
  if (error instanceof CobolRuntimeError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The DD names the program opens for input.
 *
 * A dataset nothing supplied is not there, so the `OPEN INPUT` returns file
 * status 35 and the program takes its failure path. That is a real path and
 * worth seeing — it is what `examples/failed-open` is about — but a reader who
 * does not know why is looking at a program that appears broken. The Run tab
 * says which datasets were missing rather than leaving them to work it out.
 *
 * Every one of them used to be missing, which is what the Input panel changed.
 * The list is now what a reader emptied out of the panel, or a DD the panel
 * could not build a record for.
 */
function inputDatasets(cobol: string): string[] {
  const names = new Set<string>();
  const flat = cobol.replace(/\s+/g, " ");
  for (const open of flat.matchAll(
    /OPEN INPUT ([A-Z0-9- ]+?)(?= [A-Z]+-[A-Z]|$| IF | MOVE | READ )/g,
  )) {
    for (const file of (open[1] ?? "").trim().split(/\s+/)) {
      const select = new RegExp(
        `SELECT (?:OPTIONAL )?${file} ASSIGN TO ([A-Z0-9-]+)`,
      ).exec(flat);
      if (select?.[1]) {
        names.add(select[1]);
      }
    }
  }
  return [...names].sort();
}
