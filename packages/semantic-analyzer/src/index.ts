import type { IRProgram } from "../../ir/src/index";

export interface SemanticAnalysisSummary {
  recordCount: number;
  functionCount: number;
}

export interface SemanticAnalysisResult {
  diagnostics: [];
  summary: SemanticAnalysisSummary;
}

export function analyzeProgramSemantics(
  program: IRProgram,
): SemanticAnalysisResult {
  return {
    diagnostics: [],
    summary: {
      recordCount: program.records.length,
      functionCount: program.functions.length,
    },
  };
}
