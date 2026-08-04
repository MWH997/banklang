import {
  createDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import type {
  SourceMapDocument,
  SourceMapEntry,
} from "../../cobol-backend/src/index";
import {
  toCobolFieldName,
  toCobolName,
  toCobolParagraphName,
  toCobolProgramId,
} from "../../cobol-ir/src/index";
import type { IRProgram } from "../../ir/src/index";

const BACKEND_PROFILE = "ibm-enterprise-cobol-zos";

/**
 * A symbol the compiler is required to trace from BankTS source into generated
 * COBOL. Every expected symbol must have a matching source map entry.
 */
interface ExpectedSymbol {
  category: SourceMapEntry["category"];
  symbol: string;
  span: SourceSpan;
  cobolName: string;
  missingDiagnosticId: string;
  description: string;
}

export interface SourceMapCoverageResult {
  expectedSymbolCount: number;
  coveredSymbolCount: number;
  diagnostics: Diagnostic[];
}

/**
 * Checks that the emitted source map traces every module, record, field, and
 * function to a real line range inside the generated COBOL artifact.
 *
 * Coverage is verified in two directions:
 *
 * 1. every expected symbol has an entry (BANK-GEN-001..004)
 * 2. every entry points at a line range that exists in the artifact and
 *    actually contains the generated COBOL name (BANK-GEN-005..006)
 *
 * The second direction is what makes the source map usable as audit evidence:
 * an entry that exists but points at the wrong line is worse than no entry.
 */
export function checkSourceMapCoverage(
  program: IRProgram,
  sourceMap: SourceMapDocument,
  cobol: string,
): SourceMapCoverageResult {
  const expected = collectExpectedSymbols(program);
  const diagnostics: Diagnostic[] = [];
  let coveredSymbolCount = 0;

  for (const candidate of expected) {
    const entry = findEntry(sourceMap.entries, candidate);
    if (entry) {
      coveredSymbolCount += 1;
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        id: candidate.missingDiagnosticId,
        severity: "error",
        message: `Generated COBOL source map is missing entry for ${candidate.description} ${candidate.symbol}.`,
        span: candidate.span,
        hint: `Emit a "${candidate.category}" source map entry for ${candidate.symbol} in the COBOL backend.`,
        backendProfile: BACKEND_PROFILE,
      }),
    );
  }

  const cobolLines = cobol.split("\n");
  const artifactLineCount = trimTrailingBlankLine(cobolLines).length;

  for (const entry of sourceMap.entries) {
    diagnostics.push(
      ...checkEntryTarget(entry, cobolLines, artifactLineCount, program),
    );
  }

  return {
    expectedSymbolCount: expected.length,
    coveredSymbolCount,
    diagnostics,
  };
}

function checkEntryTarget(
  entry: SourceMapEntry,
  cobolLines: string[],
  artifactLineCount: number,
  program: IRProgram,
): Diagnostic[] {
  const span: SourceSpan = {
    sourceFile: entry.sourceFile,
    start: entry.sourceStart,
    end: entry.sourceEnd,
  };

  if (
    entry.targetStartLine < 1 ||
    entry.targetEndLine < entry.targetStartLine ||
    entry.targetEndLine > artifactLineCount
  ) {
    return [
      createDiagnostic({
        id: "BANK-GEN-005",
        severity: "error",
        message: `Source map entry for ${entry.symbol} targets lines ${entry.targetStartLine}-${entry.targetEndLine}, which is outside the generated artifact (${artifactLineCount} lines).`,
        span,
        hint: "Recompute target line ranges when the COBOL emitter changes its line layout.",
        backendProfile: BACKEND_PROFILE,
      }),
    ];
  }

  const expectedCobolName = cobolNameForEntry(entry, program);
  if (!expectedCobolName) {
    return [];
  }

  const targetText = cobolLines
    .slice(entry.targetStartLine - 1, entry.targetEndLine)
    .join("\n");

  if (containsCobolName(targetText, expectedCobolName)) {
    return [];
  }

  return [
    createDiagnostic({
      id: "BANK-GEN-006",
      severity: "error",
      message: `Source map entry for ${entry.symbol} targets lines ${entry.targetStartLine}-${entry.targetEndLine}, which do not contain the generated name ${expectedCobolName}.`,
      span,
      hint: `Align the ${entry.category} source map entry with the line that emits ${expectedCobolName}.`,
      backendProfile: BACKEND_PROFILE,
    }),
  ];
}

function collectExpectedSymbols(program: IRProgram): ExpectedSymbol[] {
  const expected: ExpectedSymbol[] = [
    {
      category: "module",
      symbol: program.moduleName,
      span: program.moduleSpan,
      cobolName: toCobolProgramId(program.moduleName),
      missingDiagnosticId: "BANK-GEN-001",
      description: "module",
    },
  ];

  for (const record of program.records) {
    expected.push({
      category: "record",
      symbol: record.name,
      span: record.span,
      cobolName: toCobolName(record.name),
      missingDiagnosticId: "BANK-GEN-002",
      description: "record",
    });

    for (const field of record.fields) {
      expected.push({
        category: "field",
        symbol: field.name,
        span: field.span,
        cobolName: toCobolFieldName(field.name),
        missingDiagnosticId: "BANK-GEN-003",
        description: "field",
      });
    }
  }

  for (const fn of program.functions) {
    expected.push({
      category: "function",
      symbol: fn.name,
      span: fn.span,
      cobolName: toCobolParagraphName(fn.name),
      missingDiagnosticId: "BANK-GEN-004",
      description: "function",
    });
  }

  for (const transaction of program.transactions) {
    expected.push({
      category: "transaction",
      symbol: transaction.name,
      span: transaction.span,
      cobolName: toCobolParagraphName(transaction.name),
      missingDiagnosticId: "BANK-GEN-007",
      description: "transaction",
    });
  }

  return expected;
}

/**
 * Matches on span as well as name because field names are only unique within a
 * record. Matching on name alone would report a nested or repeated field as
 * covered by an unrelated record's entry.
 */
function findEntry(
  entries: SourceMapEntry[],
  candidate: ExpectedSymbol,
): SourceMapEntry | undefined {
  return entries.find(
    (entry) =>
      entry.category === candidate.category &&
      entry.symbol === candidate.symbol &&
      entry.sourceStart.line === candidate.span.start.line &&
      entry.sourceStart.column === candidate.span.start.column,
  );
}

function cobolNameForEntry(
  entry: SourceMapEntry,
  program: IRProgram,
): string | null {
  switch (entry.category) {
    case "module":
      return toCobolProgramId(entry.symbol);
    case "record":
      return toCobolName(entry.symbol);
    case "field":
      return toCobolFieldName(entry.symbol);
    case "function": {
      const fn = program.functions.find(
        (candidate) => candidate.name === entry.symbol,
      );
      if (!fn) {
        return null;
      }
      // A recursive function is a separate program, so its anchor is the
      // PROGRAM-ID rather than a paragraph name.
      return fn.isRecursive
        ? toCobolName(entry.symbol).replace(/-/g, "").slice(0, 8).toUpperCase()
        : toCobolParagraphName(entry.symbol);
    }
    case "transaction":
      return program.transactions.some(
        (transaction) => transaction.name === entry.symbol,
      )
        ? toCobolParagraphName(entry.symbol)
        : null;
  }
}

/**
 * COBOL names are delimited by whitespace or a period in generated output, so a
 * substring match would let DEBIT-ACCOUNT satisfy an entry for ACCOUNT.
 */
function containsCobolName(text: string, cobolName: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Z0-9-])${escapeRegExp(cobolName)}([^A-Z0-9-]|$)`,
    "m",
  );
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimTrailingBlankLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }

  return lines;
}
