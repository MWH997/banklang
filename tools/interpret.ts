/**
 * Running a BankTS program without a COBOL compiler.
 *
 * The same shape as `runConformance` in `tools/conformance.ts`, deliberately:
 * the two are handed identical options and their results are compared field for
 * field by `tests/cobol-runtime-differential.test.ts`. One compiles with `cobc`
 * and executes a native binary; the other reads the same generated COBOL and
 * interprets it. Where they disagree, one of them is wrong.
 *
 * This is what makes `packages/cobol-runtime` worth having. An interpreter with
 * no oracle is a plausible-looking guess, and a playground that runs a program
 * against a plausible-looking guess is worse than one that does not run it at
 * all: a wrong balance shown confidently is the failure this whole project is
 * organised against.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compile } from "../packages/compiler/src/index";
import {
  auditOf,
  balancesOf,
  journalOf,
  parseUnit,
  runCobol,
  type RunResult,
} from "../packages/cobol-runtime/src/index";
import type { Organization } from "../packages/cobol-runtime/src/program";
import { precompile } from "../packages/precompiler/src/index";
import { exampleProjects } from "./example-projects";
import {
  ConformanceError,
  RUNTIME_PROGRAMS,
  type ConformanceOptions,
  type ConformanceRun,
} from "./conformance";

/** The reference runtime, precompiled once, since it never changes within a run. */
let runtimeSources: string[] | null = null;

function runtime(): string[] {
  runtimeSources ??= RUNTIME_PROGRAMS.map(
    (program) =>
      precompile(
        readFileSync(join(process.cwd(), "runtime", `${program}.cbl`), "utf8"),
      ).cobol,
  );
  return runtimeSources;
}

function signedField(value: number, digits: number): string {
  return `${value < 0 ? "-" : "+"}${String(Math.abs(value)).padStart(digits, "0")}`;
}

function defaultSqlState(sqlcode: number): string {
  if (sqlcode === 0) {
    return "00000";
  }
  if (sqlcode === 100) {
    return "02000";
  }
  return "     ";
}

const encoder = new TextEncoder();

/** Turns a file's text into the line records a LINE SEQUENTIAL read returns. */
function lineRecords(text: string): Uint8Array[] {
  return text
    .split("\n")
    .filter((line, index, all) => line !== "" || index < all.length - 1)
    .map((line) => encoder.encode(line));
}

/**
 * Splits a fixed-length dataset into records.
 *
 * A sequential file with `RECORDING MODE IS F` has no record separator, so the
 * record length has to come from somewhere. It comes from the program: the run
 * below asks the interpreter, which knows every FD's length, and this is only
 * the fallback for a file no program declares.
 */
function fixedRecords(bytes: Uint8Array, length: number): Uint8Array[] {
  if (length <= 0) {
    return [bytes];
  }
  const records: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += length) {
    records.push(bytes.subarray(at, Math.min(at + length, bytes.length)));
  }
  return records;
}

export interface InterpretedRun extends ConformanceRun {
  /** Statements executed, which is a useful signal in a runaway loop. */
  steps: number;
}

export function runInterpreted(options: ConformanceOptions): InterpretedRun {
  const result = compile(options.source, {
    sourceFile: options.sourceFile ?? "conformance.bank.ts",
  });

  if (!result.ok || !result.cobol) {
    throw new ConformanceError(
      `Compilation failed:\n${result.diagnostics
        .map((diagnostic) => `${diagnostic.id} ${diagnostic.message}`)
        .join("\n")}`,
    );
  }

  const cobol = precompile(result.cobol).cobol;

  // Input files, keyed by DD name exactly as `runConformance` writes them into
  // the working directory.
  //
  // How the bytes are split into records depends on the organization, and
  // getting it wrong is not a small error. A LINE SEQUENTIAL file's records end
  // at a newline; splitting one at a fixed width puts the newline inside record
  // two and shifts every record after it by a byte. That is exactly what
  // happened the first time a line-sequential program was run through here,
  // `cobc` produced the right file and the interpreter produced a shifted one,
  // and the difference was reported as a semantic divergence in the compiler
  // rather than in this harness.
  const files = new Map<string, Uint8Array[]>();
  for (const [ddName, bytes] of Object.entries(options.inputs ?? {})) {
    files.set(
      ddName,
      isLineSequential(cobol, ddName)
        ? lineRecords(Buffer.from(bytes).toString("latin1"))
        : fixedRecords(new Uint8Array(bytes), recordLength(cobol, ddName)),
    );
  }

  if (options.sqlOutcomes?.length) {
    files.set(
      "sql-outcomes.txt",
      lineRecords(
        `${options.sqlOutcomes
          .map(
            (outcome) =>
              `${String(outcome.statement).padStart(4, "0")} ${signedField(outcome.sqlcode, 3)} ${outcome.sqlstate ?? defaultSqlState(outcome.sqlcode)} ${String(outcome.times ?? 0).padStart(4, "0")}`,
          )
          .join("\n")}\n`,
      ),
    );
  }
  // The same rows `runConformance` writes beside the compiled program. Both
  // sides being answered from one script is the only thing that makes their
  // agreement mean anything, because two stubs told different stories would disagree
  // about the program rather than about themselves.
  if (options.sqlRows?.length) {
    files.set("sql-rows.txt", lineRecords(`${options.sqlRows.join("\n")}\n`));
  }
  if (options.cicsOutcomes?.length) {
    files.set(
      "cics-outcomes.txt",
      lineRecords(
        `${options.cicsOutcomes
          .map(
            (outcome) =>
              `${String(outcome.call).padStart(4, "0")} ${signedField(outcome.resp, 3)} ${signedField(outcome.resp2 ?? 0, 3)}`,
          )
          .join("\n")}\n`,
      ),
    );
  }

  const run: RunResult = runCobol({
    sources: options.driver
      ? [options.driver, cobol, ...runtime()]
      : [cobol, ...runtime()],
    files,
  });

  const outputs = new Map<string, Buffer>();
  for (const ddName of options.outputs ?? []) {
    const records = run.files.get(ddName) ?? [];
    const parts = records.map((record) => Buffer.from(record));
    /*
     * A line-sequential file is records *and* the delimiters between them.
     *
     * The interpreter holds a file as a list of records, which is right, and
     * this used to flatten them by concatenation, correct for a fixed-length
     * dataset, where the record length is the boundary, and wrong for a text
     * file, where the newline is. Every record ran into the next one, and the
     * comparison against `cobc` reported it as a semantic divergence in the
     * compiler.
     *
     * Enterprise COBOL writes the delimiter after each record, including the
     * last, so the file ends with one.
     */
    outputs.set(
      ddName,
      isLineSequential(cobol, ddName)
        ? Buffer.concat(parts.flatMap((part) => [part, Buffer.from("\n")]))
        : Buffer.concat(parts),
    );
  }

  return {
    // A COBOL program's exit status is its RETURN-CODE.
    exitCode: run.returnCode,
    stdout: run.sysout.map((line) => `${line}\n`).join(""),
    stderr: "",
    journal: journalOf(run),
    balances: balancesOf(run),
    auditLog: auditOf(run),
    sqlCalls: linesOf(run, "sql-calls.txt"),
    cicsCalls: linesOf(run, "cics-calls.txt"),
    outputs,
    steps: run.steps,
  };
}

function linesOf(run: RunResult, file: string): string[] {
  return (run.files.get(file) ?? []).map((record) =>
    new TextDecoder().decode(record).trimEnd(),
  );
}

/**
 * The `SELECT` and `FD` a DD name resolves to, as the interpreter reads them.
 *
 * Through the interpreter's own parser rather than a regex over the generated
 * text. The regex version summed the elementary `PICTURE`s under the FD and
 * matched none whose clauses came between the picture and the period, so a
 * record holding a `zoned` field, whose entry is `PIC S9(5) SIGN IS TRAILING
 * SEPARATE.`, was measured six bytes short. A fixed dataset split at the wrong
 * boundary produces records that are individually plausible and collectively
 * wrong, which is the hardest kind of difference to find in a comparison
 * against another implementation: the sort in `tests/sort-differential` read
 * its input one field out of step and still produced three orderly records and
 * a fourth of spaces.
 *
 * The parser is the same one that will execute the program, so the harness and
 * the run can no longer disagree about what the file is.
 */
function fileFor(
  cobol: string,
  ddName: string,
): { organization: Organization; recordLength: number } | null {
  for (const program of parseUnit(cobol).programs) {
    const entry = program.files.find((file) => file.assign === ddName);
    if (!entry) {
      continue;
    }
    const description = program.descriptions.find(
      (item) => item.name === entry.name,
    );
    return {
      organization: entry.organization,
      recordLength: description?.recordLength ?? 0,
    };
  }
  return null;
}

/**
 * True when the DD names a file the program declared LINE SEQUENTIAL.
 *
 * Read out of the program rather than passed in: the program is what decides,
 * and a caller that had to repeat the organization could disagree with it.
 */
export function isLineSequential(cobol: string, ddName: string): boolean {
  return fileFor(cobol, ddName)?.organization === "line-sequential";
}

/** The record length of the FD a DD name is assigned to. */
function recordLength(cobol: string, ddName: string): number {
  return fileFor(cobol, ddName)?.recordLength ?? 0;
}

/* ------------------------------------------------------------------ *
 * Entering a program that takes a PARM.
 * ------------------------------------------------------------------ */

/** The name of the generated driver, which is what both sides enter at. */
export const DRIVER_NAME = "BANKDRIV";

/**
 * A COBOL main program that supplies a PARM area and calls the program.
 *
 * This is what a z/OS initiator does: it builds the parameter list from the
 * `PARM=` on the EXEC statement and passes it. A halfword length followed by
 * the characters is the convention `docs/jcl-model.md` records, and the
 * generated program's LINKAGE is laid out to receive exactly that.
 *
 * The area is 512 bytes because the layout is the program's business, not the
 * driver's: passing by reference means the callee maps its own record onto
 * whatever is there, and a longer area than it declares is harmless.
 */
export function parmDriver(program: string, parm = ""): string {
  const text = parm.padEnd(512, " ").slice(0, 512);
  const lines = [
    "       IDENTIFICATION DIVISION.",
    `       PROGRAM-ID. ${DRIVER_NAME}.`,
    "",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  BANK-PARM.",
    `           05  BANK-PARM-LENGTH     PIC S9(4) COMP VALUE ${String(parm.length)}.`,
    "           05  BANK-PARM-DATA       PIC X(512).",
    "",
    "       PROCEDURE DIVISION.",
    "       DRIVE.",
    ...(parm === ""
      ? ["           MOVE SPACES TO BANK-PARM-DATA"]
      : chunkMove(text.trimEnd())),
    `           CALL "${program}" USING BANK-PARM`,
    "           GOBACK.",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The PARM text, moved into the area in pieces that fit a COBOL line.
 *
 * This used to refuse anything past 40 characters, which was safe only because
 * nothing ever asked: the differential lane supplied every PARM-driven example
 * an empty PARM, so both sides took the length check's refusal path and agreed
 * on return code 12. The parsing this compiler generates (the numeric class
 * test, the separate sign, the offsets inside the linkage group) was never
 * compared against a real compiler at all. Every real PARM in the corpus is
 * longer than 40 characters.
 */
function chunkMove(text: string): string[] {
  const lines = ["           MOVE SPACES TO BANK-PARM-DATA"];
  const CHUNK = 20;
  for (let at = 0; at < text.length; at += CHUNK) {
    const piece = text.slice(at, at + CHUNK);
    lines.push(
      `           MOVE "${piece.replace(/"/g, '""')}" TO BANK-PARM-DATA(${String(at + 1)}:${String(piece.length)})`,
    );
  }
  return lines;
}

/** True when the generated program is entered with a parameter list. */
export function takesParm(cobol: string): boolean {
  return /^\s{7}PROCEDURE\s+DIVISION\s+USING\b/m.test(cobol);
}

/** The PROGRAM-ID of the first program in a source file. */
export function programNameOf(cobol: string): string {
  const match = /^\s*PROGRAM-ID\.\s+([A-Z0-9-]+)/im.exec(cobol);
  if (!match?.[1]) {
    throw new Error("The generated source has no PROGRAM-ID.");
  }
  return match[1];
}

/** The generated COBOL for a BankTS source, precompiled and ready to run. */
export function generatedCobol(source: string, sourceFile: string): string {
  const result = compile(source, { sourceFile });
  if (!result.ok || !result.cobol) {
    throw new ConformanceError(
      `Compilation failed:\n${result.diagnostics
        .map((diagnostic) => `${diagnostic.id} ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
  return precompile(result.cobol).cobol;
}

/* ------------------------------------------------------------------ *
 * The corpus this interpreter is held to.
 * ------------------------------------------------------------------ */

/**
 * Examples the interpreter does not run, and why.
 *
 * Listed rather than detected, so that a program which stops running for some
 * other reason fails the differential test instead of being quietly excused.
 * Both are compiled and executed under `cobc` by `tests/conformance.test.ts`;
 * what is missing for these two is a second implementation, not a run.
 */
export const NOT_INTERPRETED: Record<string, string> = {
  "examples/report-with-controls":
    "Report Writer: page fitting, control breaks and sum counters",
  "examples/end-of-day-settlement/report":
    "a LINAGE print file, whose page depth decides when AT END-OF-PAGE fires",
};

/** Every example run both ways and compared. */
export function differentialProjects(cwd = process.cwd()): string[] {
  return exampleProjects(cwd).filter(
    (project) => !(project in NOT_INTERPRETED),
  );
}
