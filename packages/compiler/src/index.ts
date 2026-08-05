import type { Diagnostic } from "../../ast/src/index";
import {
  emitCobol,
  emitJcl,
  type SourceMapDocument,
} from "../../cobol-backend/src/index";
import { toCobolName } from "../../cobol-ir/src/index";
import {
  buildCopybookLayoutDocument,
  renderCopybook,
  type CopybookLayoutDocument,
} from "../../copybook/src/index";
import {
  lowerProgramToIR,
  type BackendRequirement,
  type IRProgram,
} from "../../ir/src/index";
import { parseBankTs } from "../../parser/src/index";
import {
  analyzeProgramSemantics,
  type SemanticAnalysisSummary,
} from "../../semantic-analyzer/src/index";
import { typecheckProgram } from "../../typechecker/src/index";
import {
  checkSourceMapCoverage,
  type SourceMapCoverageResult,
} from "../../verifier/src/index";

export type { Diagnostic } from "../../ast/src/index";
export type { BackendRequirement } from "../../ir/src/index";
export type {
  SourceMapDocument,
  SourceMapEntry,
} from "../../cobol-backend/src/index";

export interface GeneratedCopybook {
  /** Record name as written in BankTS. */
  record: string;
  /** Generated copybook file name, such as `TRANSFER-REQUEST.cpy`. */
  fileName: string;
  content: string;
}

export interface CompileOptions {
  /** Path recorded in diagnostics and source map entries. */
  sourceFile?: string;
  /**
   * Emit JCL alongside the COBOL program. Off by default because the
   * playground and most API consumers do not need it.
   */
  emitJcl?: boolean;
}

export interface CompileResult {
  /** True when no error-severity diagnostic was produced. */
  ok: boolean;
  /** Syntax, type, and banking safety diagnostics, in pipeline order. */
  diagnostics: Diagnostic[];
  program: IRProgram | null;
  cobol: string | null;
  copybooks: GeneratedCopybook[];
  sourceMap: SourceMapDocument | null;
  jcl: string | null;
  layout: CopybookLayoutDocument | null;
  analysis: SemanticAnalysisSummary | null;
  coverage: SourceMapCoverageResult | null;
  /**
   * Preprocessing the generated COBOL needs before a compiler will accept it.
   *
   * Embedded SQL requires the Db2 precompiler and CICS commands require the
   * CICS translator. Plain COBOL compilation of such a program is not a
   * meaningful check, and callers must not report it as one.
   */
  backendRequirements: BackendRequirement[];
}

/**
 * True when any diagnostic would stop the compiler.
 *
 * A warning reports a hazard the compiler cannot rule out — an uninstantiated
 * generic, a posting loop with no checkpoint — and a program carrying one is
 * still a program. Treating every diagnostic as fatal meant a warning silently
 * produced no COBOL, which is a worse outcome than the thing being warned about.
 */
function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

const EMPTY: Omit<CompileResult, "ok" | "diagnostics"> = {
  program: null,
  cobol: null,
  copybooks: [],
  sourceMap: null,
  jcl: null,
  layout: null,
  analysis: null,
  coverage: null,
  backendRequirements: [],
};

/**
 * Compiles BankTS source to COBOL artifacts in a single call.
 *
 * This is the programmatic entry point for the compiler. It performs no file
 * system or network access, so it runs unchanged in Node and in a browser,
 * which is what lets the web playground use the real compiler rather than a
 * reimplementation of it.
 *
 * Compilation stops at the first stage that produces diagnostics, so a caller
 * never receives partially-valid artifacts alongside errors.
 */
export function compile(
  source: string,
  options: CompileOptions = {},
): CompileResult {
  const sourceFile = options.sourceFile ?? "main.bank.ts";

  const parsed = parseBankTs(source, sourceFile);
  if (hasErrors(parsed.diagnostics) || !parsed.program) {
    return { ok: false, diagnostics: parsed.diagnostics, ...EMPTY };
  }

  const typechecked = typecheckProgram(parsed.program);
  if (hasErrors(typechecked.diagnostics)) {
    return { ok: false, diagnostics: typechecked.diagnostics, ...EMPTY };
  }

  const lowered = lowerProgramToIR(typechecked);
  if (hasErrors(lowered.diagnostics) || !lowered.program) {
    return { ok: false, diagnostics: lowered.diagnostics, ...EMPTY };
  }

  const program = lowered.program;
  const semantics = analyzeProgramSemantics(program);
  if (hasErrors(semantics.diagnostics)) {
    return {
      ok: false,
      diagnostics: semantics.diagnostics,
      ...EMPTY,
      program,
      analysis: semantics.summary,
      backendRequirements: program.backendRequirements,
    };
  }

  const emitted = emitCobol(program);
  const coverage = checkSourceMapCoverage(
    program,
    emitted.sourceMap,
    emitted.cobol,
  );

  // Warnings from the earlier phases travel with the result. Dropping them on
  // the way to a successful compile would make a hazard the compiler found
  // invisible to everyone downstream of it.
  const diagnostics = [
    ...parsed.diagnostics,
    ...typechecked.diagnostics,
    ...lowered.diagnostics,
    ...semantics.diagnostics,
    ...coverage.diagnostics,
  ];

  return {
    ok: !hasErrors(diagnostics),
    diagnostics,
    program,
    cobol: emitted.cobol,
    copybooks: program.records.map((record) => ({
      record: record.name,
      fileName: `${toCobolName(record.name)}.cpy`,
      content: renderCopybook(record),
    })),
    sourceMap: emitted.sourceMap,
    jcl: options.emitJcl ? emitJcl(program).jcl : null,
    layout: buildCopybookLayoutDocument(program, "dist/copybooks"),
    analysis: semantics.summary,
    coverage,
    backendRequirements: program.backendRequirements,
  };
}
