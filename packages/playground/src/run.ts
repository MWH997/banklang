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

/**
 * A main program that hands the generated program a parameter area.
 *
 * A batch entered with `PARM=` has `PROCEDURE DIVISION USING`, and something
 * has to build the list. On z/OS that is the initiator; here it is this. The
 * length is zero and the data is blank, which is what a job step with no PARM
 * passes — and what the program's own validation is written to reject.
 */
function parmDriver(program: string): string {
  return [
    "       IDENTIFICATION DIVISION.",
    `       PROGRAM-ID. ${DRIVER}.`,
    "",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  BANK-PARM.",
    "           05  BANK-PARM-LENGTH     PIC S9(4) COMP VALUE 0.",
    "           05  BANK-PARM-DATA       PIC X(512).",
    "",
    "       PROCEDURE DIVISION.",
    "       DRIVE.",
    "           MOVE SPACES TO BANK-PARM-DATA",
    `           CALL "${program}" USING BANK-PARM`,
    "           GOBACK.",
    "",
  ].join("\n");
}

export interface RunOutcome {
  ok: boolean;
  /** Input datasets the program opens, none of which the browser can supply. */
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

export function run(cobol: string): RunOutcome {
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

  let result: RunResult;
  try {
    result = runCobol({
      sources:
        takesParm && program
          ? [parmDriver(program), translated, ...RUNTIME]
          : [translated, ...RUNTIME],
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
    missingInputs: inputDatasets(translated),
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
 * There is no dataset behind any of them here, so every `OPEN INPUT` returns
 * file status 35 and the program takes its failure path. That is a real path
 * and worth seeing — it is what `examples/failed-open` is about — but a reader
 * who does not know why is looking at a program that appears broken. The Run
 * tab says which datasets were missing rather than leaving them to work it out.
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
