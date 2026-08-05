import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { compile, type CompileResult } from "../packages/compiler/src/index";
import type { CopybookLayoutReport } from "../packages/copybook/src/index";
import { precompile } from "../packages/precompiler/src/index";

/**
 * Runs a generated COBOL program against the reference runtime in `runtime/`.
 *
 * This is the part of the toolchain that executes rather than inspects. A
 * compiler that only ever compiles can be confidently wrong: `emitBoundsChecks`
 * once clamped a subscript instead of refusing it, and every static check
 * passed. Running the program is what turns "the COBOL looks right" into "the
 * balances are right".
 *
 * The runtime it runs against is a reference implementation shipped with this
 * repository, not IBM software. See `runtime/README.md` for what that does and
 * does not establish.
 */

export const RUNTIME_PROGRAMS = [
  "BANKLEDG",
  "BANKAUDT",
  "DSNHLI",
  "DFHEI1",
] as const;

export interface ConformanceRun {
  /** Exit status of the generated program. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** One entry per ledger call, in the order the program made them. */
  journal: string[];
  /** Closing balance per account, as the reference ledger holds it. */
  balances: Map<string, string>;
  /** `event correlationKey` per audit call, in order. */
  auditLog: string[];
  /** `SQL nnnn SQLCODE n` per SQL call, in the order the program made them. */
  sqlCalls: string[];
  /** `CICS nnnn RESP n` per CICS command, in order. */
  cicsCalls: string[];
  /** Raw bytes of each declared output file, keyed by its DD name. */
  outputs: Map<string, Buffer>;
}

/** An outcome the reference Db2 runtime should report for one statement. */
export interface SqlOutcome {
  /**
   * Statement number, as the precompiler assigns it: 1 for the first executable
   * block. A cursor's DECLARE is not executable and takes no number.
   */
  statement: number;
  sqlcode: number;
  /** Defaults to the state that matches the code for 0 and 100. */
  sqlstate?: string;
  /**
   * Calls this outcome applies to, or every remaining call when omitted.
   *
   * A FETCH is one statement run many times, so scripting a cursor means
   * `{ statement: 2, sqlcode: 0, times: 3 }` followed by an unbounded
   * `{ statement: 2, sqlcode: 100 }` for the end of the rows.
   */
  times?: number;
}

/** A response the reference CICS runtime should report for one command. */
export interface CicsOutcome {
  /** Command number, counted in the order the program issues them. */
  call: number;
  resp: number;
  resp2?: number;
}

export interface ConformanceOptions {
  /** BankTS source to compile, execute, and observe. */
  source: string;
  sourceFile?: string;
  /** Working directory for the run. Created if missing, cleared if present. */
  workDir: string;
  /** Input files to seed, keyed by the DD name in the generated SELECT. */
  inputs?: Record<string, Buffer>;
  /** DD names of output files to read back after the run. */
  outputs?: string[];
  /**
   * SQL outcomes to script.
   *
   * The reference runtime evaluates no SQL, so a statement succeeds unless a
   * test says otherwise. Scripting a 100 is what makes a generated program's
   * "row not found" branch executable rather than merely inspectable.
   */
  sqlOutcomes?: SqlOutcome[];
  /** CICS responses to script. A command returns NORMAL unless listed. */
  cicsOutcomes?: CicsOutcome[];
}

/** SQLSTATE for the codes with one obvious answer, so tests need not repeat it. */
function defaultSqlState(sqlcode: number): string {
  if (sqlcode === 0) {
    return "00000";
  }
  if (sqlcode === 100) {
    return "02000";
  }
  // Anything else is a real Db2 error whose state a test has to state itself,
  // because there is no mapping this repository could honestly claim to know.
  return "     ";
}

function signedField(value: number, digits: number): string {
  return `${value < 0 ? "-" : "+"}${String(Math.abs(value)).padStart(digits, "0")}`;
}

/** Thrown when the run could not be set up, as opposed to failing an assertion. */
export class ConformanceError extends Error {}

export function runConformance(options: ConformanceOptions): ConformanceRun {
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

  const workDir = options.workDir;
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // Embedded SQL and CICS have to be translated before any compiler will read
  // them, exactly as on z/OS.
  const cobol =
    result.backendRequirements.length > 0
      ? precompile(result.cobol).cobol
      : result.cobol;

  const programPath = join(workDir, "program.cbl");
  writeFileSync(programPath, cobol, "utf8");

  for (const [ddName, bytes] of Object.entries(options.inputs ?? {})) {
    writeFileSync(join(workDir, ddName), bytes);
  }

  // The runtimes read their scripts from fixed names beside the program, so
  // there is no DD to declare and nothing for the generated program to know.
  if (options.sqlOutcomes?.length) {
    writeFileSync(
      join(workDir, "sql-outcomes.txt"),
      `${options.sqlOutcomes
        .map(
          (outcome) =>
            `${String(outcome.statement).padStart(4, "0")} ${signedField(outcome.sqlcode, 3)} ${outcome.sqlstate ?? defaultSqlState(outcome.sqlcode)} ${String(outcome.times ?? 0).padStart(4, "0")}`,
        )
        .join("\n")}\n`,
      "utf8",
    );
  }
  if (options.cicsOutcomes?.length) {
    writeFileSync(
      join(workDir, "cics-outcomes.txt"),
      `${options.cicsOutcomes
        .map(
          (outcome) =>
            `${String(outcome.call).padStart(4, "0")} ${signedField(outcome.resp, 3)} ${signedField(outcome.resp2 ?? 0, 3)}`,
        )
        .join("\n")}\n`,
      "utf8",
    );
  }

  compileRuntime(workDir);

  const compileResult = spawnSync(
    "cobc",
    ["-x", "-fixed", "program.cbl", "-o", "program"],
    { cwd: workDir, encoding: "utf8" },
  );
  if (compileResult.status !== 0) {
    throw new ConformanceError(
      `cobc failed on the generated program:\n${compileResult.stdout ?? ""}${compileResult.stderr ?? ""}`,
    );
  }

  // GnuCOBOL resolves `ASSIGN TO NAME` through DD_NAME, which is the closest
  // local equivalent of a JCL DD statement.
  const env: NodeJS.ProcessEnv = { ...process.env, COB_LIBRARY_PATH: workDir };
  for (const ddName of Object.keys(options.inputs ?? {})) {
    env[`DD_${ddName}`] = join(workDir, ddName);
  }
  for (const ddName of options.outputs ?? []) {
    env[`DD_${ddName}`] = join(workDir, ddName);
  }

  const run = spawnSync("./program", [], {
    cwd: workDir,
    encoding: "utf8",
    env,
  });

  const outputs = new Map<string, Buffer>();
  for (const ddName of options.outputs ?? []) {
    const path = join(workDir, ddName);
    outputs.set(
      ddName,
      existsSync(path) ? readFileSync(path) : Buffer.alloc(0),
    );
  }

  return {
    exitCode: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    journal: readLines(join(workDir, "ledger-journal.txt")),
    balances: readBalances(join(workDir, "ledger-balances.txt")),
    auditLog: readLines(join(workDir, "audit-log.txt")),
    sqlCalls: readLines(join(workDir, "sql-calls.txt")),
    cicsCalls: readLines(join(workDir, "cics-calls.txt")),
    outputs,
  };
}

/**
 * Extension GnuCOBOL looks for when resolving a `CALL` to a dynamic module.
 *
 * It follows the platform's own convention, so a module built as `.so` on macOS
 * is never found and the program dies with "module not found" at the first
 * ledger call.
 */
const MODULE_EXTENSION = process.platform === "darwin" ? "dylib" : "so";

/** Compiles the reference runtime into callable modules beside the program. */
function compileRuntime(workDir: string): void {
  for (const program of RUNTIME_PROGRAMS) {
    const source = join(process.cwd(), "runtime", `${program}.cbl`);
    const compiled = spawnSync(
      "cobc",
      ["-m", "-fixed", source, "-o", `${program}.${MODULE_EXTENSION}`],
      { cwd: workDir, encoding: "utf8" },
    );
    if (compiled.status !== 0) {
      throw new ConformanceError(
        `cobc failed on runtime/${program}.cbl:\n${compiled.stdout ?? ""}${compiled.stderr ?? ""}`,
      );
    }
  }
}

function readLines(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readBalances(path: string): Map<string, string> {
  const balances = new Map<string, string>();
  for (const line of readLines(path)) {
    const separator = line.lastIndexOf(" ");
    if (separator > 0) {
      balances.set(line.slice(0, separator).trim(), line.slice(separator + 1));
    }
  }
  return balances;
}

/**
 * Builds a fixed-length record from field values, using the layout the
 * compiler itself reported.
 *
 * Reading offsets from the compiler's own layout document rather than
 * hand-counting bytes is what makes this a test of the generated program: if
 * the emitter's layout changed, the seeded record changes with it, and a real
 * behavioural difference is what shows up rather than a byte-offset mismatch.
 */
export function buildRecord(
  layout: CopybookLayoutReport,
  values: Record<string, string | number>,
): Buffer {
  const record = Buffer.alloc(layout.totalLength, 0x20);

  for (const field of layout.entries) {
    const value = values[fieldKey(field.path)];
    if (value === undefined) {
      continue;
    }

    if (field.usage === "COMP-3") {
      const scale = scaleOf(field.picture);
      encodePacked(Number(value), scale, field.bytes).copy(
        record,
        field.offset,
      );
      continue;
    }

    const text = String(value).slice(0, field.bytes).padEnd(field.bytes, " ");
    record.write(text, field.offset, "ascii");
  }

  return record;
}

/** Reads one field out of a fixed-length record produced by the program. */
export function readField(
  layout: CopybookLayoutReport,
  record: Buffer,
  fieldName: string,
): string {
  const field = layout.entries.find(
    (entry) => fieldKey(entry.path) === fieldName,
  );
  if (!field) {
    throw new ConformanceError(
      `No field ${fieldName} in ${layout.recordName}.`,
    );
  }

  const bytes = record.subarray(field.offset, field.offset + field.bytes);
  if (field.usage === "COMP-3") {
    return decodePacked(bytes, scaleOf(field.picture));
  }
  return bytes.toString("ascii").trimEnd();
}

/** The trailing field name of a layout path such as `SAVINGS-ACCOUNT.BALANCE`. */
function fieldKey(path: string): string {
  return path.slice(path.indexOf(".") + 1);
}

/** Digits after the implied decimal point in a picture such as S9(16)V99. */
function scaleOf(picture: string): number {
  const repeated = /V9\((\d+)\)/.exec(picture);
  if (repeated) {
    return Number(repeated[1]);
  }
  const literal = /V(9+)/.exec(picture);
  return literal ? literal[1].length : 0;
}

/**
 * Encodes a number as packed decimal.
 *
 * Two digits per byte, with the sign in the low nibble of the last byte: 0x0C
 * for positive and 0x0D for negative, which is what COMP-3 means.
 */
export function encodePacked(
  value: number,
  scale: number,
  byteLength: number,
): Buffer {
  const negative = value < 0;
  const scaled = Math.round(Math.abs(value) * 10 ** scale);
  const digits = String(scaled).padStart(byteLength * 2 - 1, "0");

  // Digit i sits in byte floor(i / 2): the high nibble for an even i, the low
  // nibble for an odd one. The final low nibble is the sign, which is why the
  // digit string is one short of two per byte.
  const buffer = Buffer.alloc(byteLength);
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const byteIndex = Math.floor(index / 2);
    if (index % 2 === 0) {
      buffer[byteIndex] |= digit << 4;
    } else {
      buffer[byteIndex] |= digit;
    }
  }
  buffer[byteLength - 1] =
    (buffer[byteLength - 1] & 0xf0) | (negative ? 0x0d : 0x0c);
  return buffer;
}

/** Decodes packed decimal back to a fixed-point decimal string. */
export function decodePacked(bytes: Buffer, scale: number): string {
  let digits = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const high = (bytes[index] & 0xf0) >> 4;
    const low = bytes[index] & 0x0f;
    digits += String(high);
    if (index < bytes.length - 1) {
      digits += String(low);
    }
  }

  const signNibble = bytes[bytes.length - 1] & 0x0f;
  const negative = signNibble === 0x0d || signNibble === 0x0b;
  const whole = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(digits.length - scale);
  const text = scale > 0 ? `${whole || "0"}.${fraction}` : whole || "0";
  return negative ? `-${text}` : text;
}

/** Compiles a source and returns the layout of one of its records. */
export function layoutOf(
  result: CompileResult,
  recordName: string,
): CopybookLayoutReport {
  const report = result.layout?.reports.find(
    (entry) => entry.recordName === recordName,
  );
  if (!report) {
    throw new ConformanceError(`No layout reported for record ${recordName}.`);
  }
  return report;
}

/** True when GnuCOBOL is available, so a suite can skip rather than fail. */
export function hasCobc(): boolean {
  return spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;
}
