import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  batchParmFields,
  emitCobol,
  type BatchParmField,
} from "../packages/cobol-backend/src/index";
import { toCobolName } from "../packages/cobol-ir/src/index";
import { lowerProgramToIR, type IRProgram } from "../packages/ir/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { exampleProjects } from "../tools/example-projects";

/**
 * A generated artifact with its line breaks flattened to single spaces.
 *
 * COBOL's reference format ends a source line at column 72, so a statement
 * wider than that is written across several lines. Where the break falls is a
 * property of the page rather than of the program, and a test asserting what
 * the emitter produced should not have to know it — `tests/reference-format`
 * checks the margin itself, over every artifact, once.
 *
 * Use this when the statement being asserted is long enough to wrap. Assert on
 * the text directly when the shape of the line is the point, as it is for the
 * column alignment of a data description entry.
 */
export function flowed(cobol: string | null | undefined): string {
  return (cobol ?? "").replace(/\s+/g, " ");
}

/**
 * The generated program as the local compiler can read it.
 *
 * The artifact opens with a `CBL` statement naming the compiler options its
 * behaviour depends on. IBM's compiler reads it; GnuCOBOL sees `CBL` in column
 * 1 and reports an invalid indicator in column 7, because to it those columns
 * are the sequence number area. The precompiler takes it out, along with the
 * `EXEC SQL`, `EXEC CICS`, `JSON PARSE` and `XML PARSE` the local compiler
 * cannot execute — so this is the same path `tools/gnucobol-validation.ts`
 * takes, and a test that skipped it would be compiling something the compiler
 * does not emit.
 */
export function localCobol(cobol: string | null | undefined): string {
  return precompile(cobol ?? "").cobol;
}

export function exampleSourceFile(
  examplePath = "examples/account-transfer",
): string {
  return resolve(process.cwd(), examplePath, "src/main.bank.ts");
}

export function loadExampleSource(
  examplePath = "examples/account-transfer",
): string {
  return readFileSync(exampleSourceFile(examplePath), "utf8");
}

/**
 * Compiles BankTS source text through parse, typecheck, and IR lowering without
 * touching the filesystem. Used by analysis tests that need many small
 * programs.
 */
export function compileSource(
  sourceText: string,
  sourceFile = "tests/inline.bank.ts",
) {
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(typechecked);
  return { parsed, typechecked, ir };
}

/**
 * A main program that builds a job's PARM and calls the generated one.
 *
 * A generated batch program takes its scalar entry parameters from the PARM,
 * which is what `PROCEDURE DIVISION USING` is there for — and an executable
 * cannot have one: `cobc -x` says so ("executable program requested but
 * PROCEDURE/ENTRY has USING clause") and z/OS says the same thing by having the
 * initiator build the parameter list before the program is entered. On z/OS the
 * initiator does it; here this does, which is also the only way a test can
 * choose what the PARM says.
 *
 * Compile it first and the generated program second, and `cobc -x` makes the
 * driver the entry point:
 *
 *     cobc -x -fixed driver.cbl program.cbl runtime/BANKAUDT.cbl -o program
 *
 * The driver returns whatever the called program left in `RETURN-CODE`, so the
 * step's condition code is still the generated program's answer.
 */
export function parmDriver(
  program: IRProgram,
  values: Record<string, string | number> = {},
): string {
  const fields = batchParmFields(program);
  if (fields.length === 0) {
    throw new Error(
      "The program takes no PARM. Call it directly rather than through a driver.",
    );
  }

  const width = fields.reduce((total, field) => total + field.width, 0);

  // Built in the procedure division rather than by a VALUE clause: a parameter
  // can be wider than the 160 characters a literal may hold, and every line
  // here still has to end by column 72 for `-fixed`.
  const moves: string[] = [];
  let position = 1;
  for (const field of fields) {
    const text = parmText(field, values[field.source]);
    for (let offset = 0; offset < text.length; offset += 40) {
      const chunk = text.slice(offset, offset + 40);
      if (chunk.trim() !== "") {
        moves.push(
          `           MOVE "${chunk}" TO`,
          `               BANK-PARM-TEXT(${position + offset}:${chunk.length})`,
        );
      }
    }
    position += field.width;
  }

  return [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. BANKDRV.",
    "",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01  BANK-PARM.",
    "           05  BANK-PARM-LENGTH     PIC S9(4) COMP.",
    `           05  BANK-PARM-TEXT       PIC X(${width}).`,
    "",
    "       PROCEDURE DIVISION.",
    "       BANK-DRIVE.",
    `           MOVE ${width} TO BANK-PARM-LENGTH`,
    "           MOVE SPACES TO BANK-PARM-TEXT",
    ...moves,
    `           CALL "${toCobolName(program.moduleName)}" USING BANK-PARM`,
    "           GOBACK.",
    "       END PROGRAM BANKDRV.",
    "",
  ].join("\n");
}

/**
 * One parameter as the characters someone would type on an EXEC statement.
 *
 * A number arrives as zoned decimal with a separate leading sign, which is what
 * `parmPicture` in the backend describes and what a person can read; everything
 * else is text in its declared width.
 */
function parmText(
  field: BatchParmField,
  value: string | number | undefined,
): string {
  if (!field.numeric) {
    return String(value ?? "")
      .padEnd(field.width, " ")
      .slice(0, field.width);
  }
  const shape = /PIC S9\((\d+)\)(?:V9\((\d+)\))?/.exec(field.picture);
  const integer = Number(shape?.[1] ?? 0);
  const scale = Number(shape?.[2] ?? 0);
  const numeric = Number(value ?? 0);
  const digits = Math.round(Math.abs(numeric) * 10 ** scale)
    .toString()
    .padStart(integer + scale, "0");
  return `${numeric < 0 ? "-" : "+"}${digits}`;
}

export function compileExample(examplePath = "examples/account-transfer") {
  const sourceFile = exampleSourceFile(examplePath);
  const sourceText = loadExampleSource(examplePath);
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = typecheckProgram(parsed.program);
  const ir = lowerProgramToIR(typechecked);

  if (!ir.program) {
    throw new Error(`Expected ${examplePath} to compile.`);
  }

  const emit = emitCobol(ir.program);
  return {
    sourceFile,
    sourceText,
    parsed,
    typechecked,
    ir,
    emit,
  };
}

/**
 * Every example, compiled, as one list.
 *
 * A style assertion made against a program written inside the test proves that
 * program. The 2026-08-05 audit's F13 is what that costs: a test asserting one
 * literal delimiter compiled a program reaching one of the two branches that
 * emit a boolean, passed, and left `MOVE 'Y'` in a shipped example, its
 * evidence bundle and a golden fixture for as long as the test had existed.
 *
 * So a rule about generated code is asserted here, over everything the compiler
 * is asked to produce, and `tests/feature-coverage.test.ts` requires any test
 * named as the check for a generated-code standard to reach for this.
 *
 * Compiled once per process and memoised: nineteen examples through the whole
 * front end is a second or so, and every caller wants the same answer.
 */
let compiledCorpus: { example: string; cobol: string }[] | undefined;

export function corpus(): { example: string; cobol: string }[] {
  if (!compiledCorpus) {
    compiledCorpus = exampleProjects().map((example) => ({
      example,
      cobol: compileExample(example).emit.cobol,
    }));
  }
  return compiledCorpus;
}

/**
 * How many things an assertion over the corpus actually looked at.
 *
 * A loop over a derived collection asserts nothing when the collection is
 * empty, and passes while doing it. That is the defect this repository keeps
 * producing — the 2026-08-05 audit's F13 was a test whose fixture reached one
 * of two branches, and the corpus assertions written to answer it introduced
 * another: `SET <condition> TO TRUE` never matched, because the emitter
 * qualifies the condition (`SET OUTCOME-FOUND OF BALANCE-REPLY TO TRUE`) and
 * the pattern did not allow for it. Zero matches, zero assertions, green.
 *
 * So every corpus assertion states its floor. If a change to the compiler or to
 * the examples means the loop stops finding anything, the floor fails and says
 * so, rather than the suite quietly checking less than it did yesterday.
 */
export function checked(count: number, atLeast: number, what: string): void {
  if (count < atLeast) {
    throw new Error(
      `Only ${count} ${what} were checked across the corpus, and at least ${atLeast} were expected. An assertion that finds nothing passes without asserting anything.`,
    );
  }
}
