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
  runCobol,
  type RunResult,
} from "../packages/cobol-runtime/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { exampleProjects } from "./example-projects";
import {
  ConformanceError,
  RUNTIME_PROGRAMS,
  type ConformanceOptions,
  type ConformanceRun,
} from "./conformance";

/** The reference runtime, precompiled once — it never changes within a run. */
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
  const files = new Map<string, Uint8Array[]>();
  for (const [ddName, bytes] of Object.entries(options.inputs ?? {})) {
    files.set(
      ddName,
      fixedRecords(new Uint8Array(bytes), recordLength(cobol, ddName)),
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
    outputs.set(
      ddName,
      Buffer.concat(records.map((record) => Buffer.from(record))),
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
 * The record length of the FD a DD name is assigned to.
 *
 * Read from the generated `FD` rather than assumed, because splitting a fixed
 * dataset at the wrong boundary produces records that are individually
 * plausible and collectively wrong — the hardest kind of difference to find in
 * a comparison against another implementation.
 */
function recordLength(cobol: string, ddName: string): number {
  const select = new RegExp(
    `SELECT\\s+([A-Z0-9-]+)\\s+ASSIGN\\s+TO\\s+${ddName}\\b`,
    "i",
  ).exec(cobol.replace(/\s+/g, " "));
  if (!select) {
    return 0;
  }
  const fileName = select[1] ?? "";
  const flat = cobol.replace(/\s+/g, " ");
  const fd = new RegExp(
    `FD ${fileName}\\b(.*?)(?= FD | WORKING-STORAGE| PROCEDURE)`,
    "i",
  ).exec(flat);
  if (!fd) {
    return 0;
  }
  // Sum the elementary PICTUREs of the first 01 under the FD.
  return picturesLength(fd[1] ?? "");
}

function picturesLength(text: string): number {
  let total = 0;
  for (const match of text.matchAll(
    /PIC\s+(\S+?)(?:\s+(COMP-3|COMP|COMP-4|BINARY|PACKED-DECIMAL))?\s*\./gi,
  )) {
    total += lengthOfPicture(match[1] ?? "", match[2]);
  }
  return total;
}

function lengthOfPicture(picture: string, usage: string | undefined): number {
  const expanded = picture
    .toUpperCase()
    .replace(/([A-Z9])\((\d+)\)/g, (_, symbol: string, count: string) =>
      symbol.repeat(Number(count)),
    );
  const digits = (expanded.match(/9/g) ?? []).length;
  if (usage && /COMP-3|PACKED/i.test(usage)) {
    return Math.floor(digits / 2) + 1;
  }
  if (usage && /COMP|BINARY/i.test(usage)) {
    return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  }
  return expanded.replace(/[SV]/g, "").length;
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

/** A literal short enough for one reference-format line. */
function chunkMove(text: string): string[] {
  if (text.length > 40) {
    throw new Error(
      "A driver PARM longer than 40 characters would need literal continuation, which this helper does not write.",
    );
  }
  return [
    "           MOVE SPACES TO BANK-PARM-DATA",
    `           MOVE "${text}" TO BANK-PARM-DATA`,
  ];
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
