import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  formatDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import {
  emitCobol,
  emitJcl,
  type CobolEmitResult,
  type JclEmitResult,
} from "../../cobol-backend/src/index";
import {
  buildCopybookLayoutDocument,
  diffGeneratedCopybooks,
  inspectGeneratedCopybook,
  renderCopybook,
  renderCopybookLayoutDocument,
  renderCopybookDiff,
  renderCopybookInspection,
  renderCopybookTypes,
} from "../../copybook/src/index";
import { analyzeProgramSemantics } from "../../semantic-analyzer/src/index";
import {
  lowerProgramToIR,
  type IRProgram,
  type IRType,
  type IRExpression,
  type IRRecord,
  type IRStatement,
} from "../../ir/src/index";
import { parseBankTs } from "../../parser/src/index";
import { typecheckProgram } from "../../typechecker/src/index";
import { decimalPicture, toCobolName } from "../../cobol-ir/src/index";
import {
  checkSourceMapCoverage,
  type SourceMapCoverageResult,
} from "../../verifier/src/index";
import {
  runGnucobolValidation,
  type GnucobolValidationSummary,
} from "../../../tools/gnucobol-validation";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CompiledProject {
  sourceFile: string;
  sourceText: string;
  parsed: ReturnType<typeof parseBankTs>;
  typechecked: ReturnType<typeof typecheckProgram>;
  ir: ReturnType<typeof lowerProgramToIR>;
  semantics: ReturnType<typeof analyzeProgramSemantics>;
}

const PLANNED_COMMAND_ERROR = "planned but not implemented yet";
const AUDIT_SCHEMA_VERSION = 1;
const BACKEND_PROFILE = "ibm-enterprise-cobol-zos";

type AuditCheckStatus = "passed" | "emitted" | "skipped" | "failed";

interface AuditCheck {
  name: string;
  status: AuditCheckStatus;
  details: string;
}

interface VerificationReportDocument {
  version: number;
  backendProfile: string;
  phase: "audit" | "verify";
  project: string;
  checks: AuditCheck[];
  artifacts: string[];
  deterministicRegeneration: AuditCheck;
  sourceMapCoverage: SourceMapCoverageResult;
  gnucobolValidation: GnucobolValidationSummary | null;
  notes: string[];
}

interface TestReportDocument {
  version: number;
  backendProfile: string;
  project: string;
  steps: AuditCheck[];
  artifacts: string[];
  notes: string[];
}

interface AuditManifestDocument {
  version: number;
  backendProfile: string;
  artifacts: string[];
}

interface DiagnosticsDocument {
  version: number;
  backendProfile: string;
  diagnostics: Diagnostic[];
}

interface DecimalAnalysisDocument {
  version: number;
  backendProfile: string;
  entries: unknown[];
}

interface TransactionAnalysisDocument {
  version: number;
  backendProfile: string;
  status: string;
  transactions: unknown[];
}

export function runBankc(argv: string[], cwd = process.cwd()): CliResult {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return {
      exitCode: 0,
      stdout: renderHelp(),
      stderr: "",
    };
  }

  const [command, ...rest] = argv;

  switch (command) {
    case "doctor":
      return {
        exitCode: 0,
        stdout: renderDoctor(cwd),
        stderr: "",
      };
    case "check":
      return runCheck(rest, cwd);
    case "build":
      return runBuild(rest, cwd);
    case "emit":
      return runEmit(rest, cwd);
    case "audit-report":
      return runAuditReport(rest, cwd);
    case "verify":
      return runVerify(rest, cwd);
    case "test":
      return runTest(rest, cwd);
    case "layout":
      return runLayout(rest, cwd);
    case "copybook":
      return runCopybook(rest, cwd);
    default:
      return {
        exitCode: 1,
        stdout: renderHelp(),
        stderr: `Unknown command: ${command}\n`,
      };
  }
}

function runCheck(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "check");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const compiled = compileProject(projectPath, cwd);
  if (collectCompileDiagnostics(compiled).length > 0) {
    const diagnostics = collectCompileDiagnostics(compiled);
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(diagnostics),
    };
  }

  return {
    exitCode: 0,
    stdout: `OK: ${projectPath}\n`,
    stderr: "",
  };
}

function runEmit(args: string[], cwd: string): CliResult {
  const [profile, ...rest] = args;
  if (profile === "cobol") {
    const projectPath = requireProjectPath(rest, "emit cobol");
    if (!projectPath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    const outputRoot = resolveOutputRoot(cwd, rest);
    const compiled = compileProject(projectPath, cwd);
    if (collectCompileDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
      };
    }

    const emitResult = emitCobol(compiled.ir.program as IRProgram, {
      cobolArtifactPath: getCobolArtifactPath(
        compiled.ir.program as IRProgram,
        outputRoot,
      ),
      sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
    });
    writeCobolOutputs(emitResult);
    return {
      exitCode: 0,
      stdout: `Wrote ${emitResult.cobolArtifactPath}\nWrote ${emitResult.sourceMapArtifactPath}\n`,
      stderr: "",
    };
  }

  if (profile === "copybooks") {
    const projectPath = requireProjectPath(rest, "emit copybooks");
    if (!projectPath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    const outputRoot = resolveOutputRoot(cwd, rest);
    const compiled = compileProject(projectPath, cwd);
    if (collectCompileDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
      };
    }

    const written = writeCopybookOutputs(
      compiled.ir.program as IRProgram,
      outputRoot,
    );

    return {
      exitCode: 0,
      stdout: `${written.map((path) => `Wrote ${path}`).join("\n")}\n`,
      stderr: "",
    };
  }

  if (profile === "jcl") {
    const projectPath = requireProjectPath(rest, "emit jcl");
    if (!projectPath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    const outputRoot = resolveOutputRoot(cwd, rest);
    const compiled = compileProject(projectPath, cwd);
    if (collectCompileDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
      };
    }

    const jclResult = emitJcl(compiled.ir.program as IRProgram, {
      jclArtifactPath: getJclArtifactPath(
        compiled.ir.program as IRProgram,
        outputRoot,
      ),
    });
    writeJclOutputs(jclResult);
    return {
      exitCode: 0,
      stdout: `Wrote ${jclResult.jclArtifactPath}\n`,
      stderr: "",
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `Unknown emit target: ${profile}\n`,
  };
}

function runBuild(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "build");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const compiled = compileProject(projectPath, cwd);
  if (collectCompileDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
  });
  writeCobolOutputs(emitResult);
  const writtenCopybooks = writeCopybookOutputs(
    compiled.ir.program as IRProgram,
    outputRoot,
  );
  const jclResult = emitJcl(compiled.ir.program as IRProgram, {
    jclArtifactPath: getJclArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
  });
  writeJclOutputs(jclResult);
  const auditRoot = writeAuditOutputs(
    compiled,
    emitResult,
    jclResult,
    outputRoot,
  );

  return {
    exitCode: 0,
    stdout:
      [
        `Wrote ${emitResult.cobolArtifactPath}`,
        `Wrote ${emitResult.sourceMapArtifactPath}`,
        ...writtenCopybooks.map((path) => `Wrote ${path}`),
        `Wrote ${jclResult.jclArtifactPath}`,
        `Wrote ${auditRoot}`,
      ].join("\n") + "\n",
    stderr: "",
  };
}

function runAuditReport(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "audit-report");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const compiled = compileProject(projectPath, cwd);
  if (collectCompileDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
  });
  writeCobolOutputs(emitResult);
  const writtenCopybooks = writeCopybookOutputs(
    compiled.ir.program as IRProgram,
    outputRoot,
  );
  const jclResult = emitJcl(compiled.ir.program as IRProgram, {
    jclArtifactPath: getJclArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
  });
  writeJclOutputs(jclResult);
  const auditRoot = writeAuditOutputs(
    compiled,
    emitResult,
    jclResult,
    outputRoot,
  );

  return {
    exitCode: 0,
    stdout:
      [
        ...writtenCopybooks.map((path) => `Wrote ${path}`),
        `Wrote audit artifacts under ${auditRoot}`,
      ].join("\n") + "\n",
    stderr: "",
  };
}

function runVerify(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "verify");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const compiled = compileProject(projectPath, cwd);
  if (collectCompileDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
  });
  writeCobolOutputs(emitResult);
  const writtenCopybooks = writeCopybookOutputs(
    compiled.ir.program as IRProgram,
    outputRoot,
  );
  const jclResult = emitJcl(compiled.ir.program as IRProgram, {
    jclArtifactPath: getJclArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
  });
  writeJclOutputs(jclResult);
  const auditRoot = writeAuditOutputs(
    compiled,
    emitResult,
    jclResult,
    outputRoot,
  );
  const gnucobolValidation = runGnucobolValidation(
    cwd,
    projectPath,
    outputRoot,
  );
  const generatedArtifactPaths = [
    emitResult.cobolArtifactPath,
    emitResult.sourceMapArtifactPath,
    ...writtenCopybooks,
    jclResult.jclArtifactPath,
    join(auditRoot, "diagnostics.json"),
    join(auditRoot, "source-map.json"),
    join(auditRoot, "decimal-analysis.json"),
    join(auditRoot, "transaction-analysis.json"),
    join(auditRoot, "copybook-layout.json"),
    join(auditRoot, "generated-artifacts.json"),
    join(auditRoot, "verification-report.md"),
    join(auditRoot, "verification-report.json"),
    join(auditRoot, "validation-matrix.md"),
    join(auditRoot, "gnucobol-validation.md"),
  ];
  writeFileSync(
    join(auditRoot, "generated-artifacts.json"),
    `${JSON.stringify(
      {
        version: AUDIT_SCHEMA_VERSION,
        backendProfile: BACKEND_PROFILE,
        artifacts: generatedArtifactPaths,
      } satisfies AuditManifestDocument,
      null,
      2,
    )}\n`,
  );
  const verificationReport = buildVerificationReportDocument(
    "verify",
    compiled,
    emitResult,
    jclResult,
    outputRoot,
    gnucobolValidation,
  );
  writeVerificationReportArtifacts(verificationReport, auditRoot);
  const verificationFailed = verificationReport.checks.some(
    (check) => check.status === "failed",
  );

  if (verificationFailed) {
    return {
      exitCode: 1,
      stdout:
        [
          `Verified ${projectPath}`,
          `Wrote ${emitResult.cobolArtifactPath}`,
          `Wrote ${emitResult.sourceMapArtifactPath}`,
          ...writtenCopybooks.map((path) => `Wrote ${path}`),
          `Wrote ${jclResult.jclArtifactPath}`,
          `Wrote ${join(auditRoot, "verification-report.md")}`,
          `Wrote ${join(auditRoot, "verification-report.json")}`,
          `Wrote ${join(auditRoot, "gnucobol-validation.md")}`,
        ].join("\n") + "\n",
      stderr: `${gnucobolValidation.compilerOutput ?? "Verification failed."}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout:
      [
        `Verified ${projectPath}`,
        `Wrote ${emitResult.cobolArtifactPath}`,
        `Wrote ${emitResult.sourceMapArtifactPath}`,
        ...writtenCopybooks.map((path) => `Wrote ${path}`),
        `Wrote ${jclResult.jclArtifactPath}`,
        `Wrote ${join(auditRoot, "verification-report.md")}`,
        `Wrote ${join(auditRoot, "verification-report.json")}`,
        `Wrote ${join(auditRoot, "gnucobol-validation.md")}`,
      ].join("\n") + "\n",
    stderr: "",
  };
}

function runTest(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "test");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const checkResult = runCheck(args, cwd);
  if (checkResult.exitCode !== 0) {
    return checkResult;
  }

  const buildResult = runBuild(args, cwd);
  if (buildResult.exitCode !== 0) {
    return buildResult;
  }

  const verifyResult = runVerify(args, cwd);
  const testReportPath = writeTestReport(
    projectPath,
    outputRoot,
    checkResult,
    buildResult,
    verifyResult,
  );

  if (verifyResult.exitCode !== 0) {
    return {
      ...verifyResult,
      stdout: `${verifyResult.stdout.trimEnd()}\nWrote ${testReportPath}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout:
      [
        checkResult.stdout.trimEnd(),
        buildResult.stdout.trimEnd(),
        verifyResult.stdout.trimEnd(),
        `Wrote ${testReportPath}`,
      ]
        .filter((line) => line.length > 0)
        .join("\n") + "\n",
    stderr: "",
  };
}

function runLayout(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "layout");
  if (!projectPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderHelp(),
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const compiled = compileProject(projectPath, cwd);
  if (collectCompileDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(collectCompileDiagnostics(compiled)),
    };
  }

  const layoutRoot = join(outputRoot, "layout");
  const layoutOutputs = writeLayoutOutputs(
    compiled.ir.program as IRProgram,
    layoutRoot,
    join(layoutRoot, "copybook-layout.md"),
  );

  return {
    exitCode: 0,
    stdout: `Wrote ${layoutOutputs.markdownPath}\nWrote ${layoutOutputs.jsonPath}\n`,
    stderr: "",
  };
}

function runCopybook(args: string[], cwd: string): CliResult {
  const [subcommand, ...rest] = args;
  const jsonMode = rest.includes("--json");

  if (subcommand === "inspect") {
    const filePath = requireCopybookPath(rest, "copybook inspect");
    if (!filePath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    try {
      const sourceText = readFileSync(resolve(cwd, filePath), "utf8");
      const inspection = inspectGeneratedCopybook(sourceText);
      return {
        exitCode: 0,
        stdout: jsonMode
          ? `${JSON.stringify(inspection, null, 2)}\n`
          : `${renderCopybookInspection(inspection)}`,
        stderr: "",
      };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
  }

  if (subcommand === "diff") {
    const copybookPair = requireCopybookPair(rest, "copybook diff");
    if (!copybookPair) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    try {
      const leftText = readFileSync(resolve(cwd, copybookPair.left), "utf8");
      const rightText = readFileSync(resolve(cwd, copybookPair.right), "utf8");
      const diff = diffGeneratedCopybooks(leftText, rightText);
      return {
        exitCode: diff.identical ? 0 : 1,
        stdout: jsonMode
          ? `${JSON.stringify(diff, null, 2)}\n`
          : `${renderCopybookDiff(diff)}`,
        stderr: "",
      };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
  }

  if (subcommand === "types") {
    const filePath = requireCopybookPath(rest, "copybook types");
    if (!filePath) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderHelp(),
      };
    }

    try {
      const sourceText = readFileSync(resolve(cwd, filePath), "utf8");
      const inspection = inspectGeneratedCopybook(sourceText);
      return {
        exitCode: 0,
        stdout: jsonMode
          ? `${JSON.stringify(inspection, null, 2)}\n`
          : `${renderCopybookTypes(inspection)}`,
        stderr: "",
      };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      };
    }
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `Unknown copybook subcommand: ${subcommand ?? ""}\n`,
  };
}

/**
 * Every blocking diagnostic for a compiled project, in pipeline order: syntax,
 * then types, then banking safety analysis.
 */
function collectCompileDiagnostics(compiled: CompiledProject): Diagnostic[] {
  return [
    ...compiled.parsed.diagnostics,
    ...compiled.typechecked.diagnostics,
    ...compiled.semantics.diagnostics,
  ];
}

/**
 * Per-transaction audit record: the postings and audit events the analyzer
 * found, so a reviewer can see what each transaction boundary does.
 */
function describeTransactions(compiled: CompiledProject): unknown[] {
  const program = compiled.ir.program;
  if (!program) {
    return [];
  }

  return program.transactions.map((transaction) => {
    const statements = flattenTransactionStatements(
      transaction.body.statements,
    );
    return {
      name: transaction.name,
      parameters: transaction.parameters.map((parameter) => parameter.name),
      ledgerPostings: statements
        .filter((statement) => statement.kind === "LedgerStatement")
        .map((statement) => ({
          operation: statement.operation,
          account: describeExpression(statement.account),
          amount: describeExpression(statement.amount),
        })),
      auditEvents: statements
        .filter((statement) => statement.kind === "AuditStatement")
        .map((statement) => ({
          event: describeExpression(statement.eventName),
          correlation: describeExpression(statement.correlation),
        })),
    };
  });
}

function flattenTransactionStatements(
  statements: IRStatement[],
): IRStatement[] {
  const flattened: IRStatement[] = [];
  for (const statement of statements) {
    flattened.push(statement);
    if (statement.kind === "IfStatement") {
      flattened.push(
        ...flattenTransactionStatements(statement.thenBranch.statements),
      );
      if (statement.elseBranch) {
        flattened.push(
          ...flattenTransactionStatements(statement.elseBranch.statements),
        );
      }
    }
  }

  return flattened;
}

function describeExpression(expression: IRExpression): string {
  switch (expression.kind) {
    case "Identifier":
      return expression.name;
    case "DecimalLiteral":
      return expression.text;
    case "BooleanLiteral":
      return String(expression.value);
    case "StringLiteral":
      return expression.value;
    case "MemberAccess":
      return `${expression.targetName}.${expression.member}`;
    case "BinaryComparison":
    case "BinaryArithmetic":
      return `${describeExpression(expression.left)} ${expression.operator} ${describeExpression(expression.right)}`;
  }
}

function compileProject(projectPath: string, cwd: string): CompiledProject {
  const sourceFile = resolveSourceFile(projectPath, cwd);
  const sourceText = readFileSync(sourceFile, "utf8");
  const parsed = parseBankTs(sourceText, sourceFile);
  const typechecked = parsed.program
    ? typecheckProgram(parsed.program)
    : {
        program: null,
        diagnostics: [],
        aliases: {},
        records: [],
        functions: [],
        transactions: [],
        files: [],
      };
  const ir = parsed.program
    ? lowerProgramToIR(typechecked)
    : { program: null, diagnostics: [] };

  const semantics = ir.program
    ? analyzeProgramSemantics(ir.program)
    : {
        diagnostics: [],
        summary: {
          recordCount: 0,
          functionCount: 0,
          transactionCount: 0,
          auditEventCount: 0,
          ledgerPostingCount: 0,
          fileCount: 0,
        },
      };

  return {
    sourceFile,
    sourceText,
    parsed,
    typechecked,
    ir,
    semantics,
  };
}

function resolveSourceFile(projectPath: string, cwd: string): string {
  const absolute = resolve(cwd, projectPath);
  if (absolute.endsWith(".bank.ts")) {
    return absolute;
  }

  return join(absolute, "src", "main.bank.ts");
}

function resolveOutputRoot(cwd: string, args: string[]): string {
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && args[outIndex + 1]) {
    return resolve(cwd, args[outIndex + 1]);
  }

  return join(cwd, "dist");
}

function requireProjectPath(
  args: string[],
  commandName: string,
): string | null {
  const project = args.find((arg) => !arg.startsWith("--"));
  if (!project) {
    return null;
  }
  if (project === "--help" || project === "-h") {
    return null;
  }
  return project;
}

function requireCopybookPath(
  args: string[],
  commandName: string,
): string | null {
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    return null;
  }
  if (file === "--help" || file === "-h") {
    return null;
  }
  return file;
}

function requireCopybookPair(
  args: string[],
  commandName: string,
): { left: string; right: string } | null {
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length < 2) {
    return null;
  }
  if (
    files[0] === "--help" ||
    files[0] === "-h" ||
    files[1] === "--help" ||
    files[1] === "-h"
  ) {
    return null;
  }
  return { left: files[0], right: files[1] };
}

function planned(commandName: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: `Command "${commandName}" is ${PLANNED_COMMAND_ERROR}.\n`,
  };
}

function renderHelp(): string {
  return [
    "BankLang compiler CLI",
    "",
    "Usage:",
    "  bankc <command> [args]",
    "",
    "Commands:",
    "  check <project>",
    "  build <project>",
    "  emit cobol <project>",
    "  emit copybooks <project>",
    "  emit jcl <project>",
    "  audit-report <project>",
    "  verify <project>",
    "  test <project>",
    "  layout <project>",
    "  doctor",
    "  copybook inspect <file>",
    "  copybook types <file>",
    "  copybook diff <left> <right>",
    "",
  ].join("\n");
}

function renderDoctor(cwd: string): string {
  return [
    "BankLang doctor",
    `cwd: ${cwd}`,
    `node: ${process.version}`,
    `platform: ${process.platform}`,
    `arch: ${process.arch}`,
    "compiler target: ibm-enterprise-cobol-zos",
    "local validation target: gnucobol-local",
    "",
  ].join("\n");
}

function renderDiagnostics(diagnostics: Diagnostic[]): string {
  return `${diagnostics.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n")}\n`;
}

function serializeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    span: diagnostic.span ? { ...diagnostic.span } : null,
  }));
}

function writeCopybookOutputs(
  program: IRProgram,
  outputRoot: string,
): string[] {
  const copybookDir = join(outputRoot, "copybooks");
  mkdirSync(copybookDir, { recursive: true });
  const written: string[] = [];

  for (const record of program.records) {
    const outputPath = join(copybookDir, `${toCobolName(record.name)}.cpy`);
    writeFileSync(outputPath, renderCopybook(record), "utf8");
    written.push(outputPath);
  }

  return written;
}

function writeAuditOutputs(
  compiled: CompiledProject,
  emitResult: CobolEmitResult,
  jclResult: JclEmitResult,
  outputRoot: string,
): string {
  const auditRoot = join(outputRoot, "audit");
  mkdirSync(auditRoot, { recursive: true });
  const copybookPaths = (compiled.ir.program as IRProgram).records.map(
    (record) =>
      join(outputRoot, "copybooks", `${toCobolName(record.name)}.cpy`),
  );
  const layoutOutputs = writeLayoutOutputs(
    compiled.ir.program as IRProgram,
    auditRoot,
    join(auditRoot, "copybook-layout.md"),
  );
  const verificationReport = buildVerificationReportDocument(
    "audit",
    compiled,
    emitResult,
    jclResult,
    outputRoot,
    null,
  );
  writeFileSync(
    join(auditRoot, "diagnostics.json"),
    `${JSON.stringify(
      {
        version: AUDIT_SCHEMA_VERSION,
        backendProfile: BACKEND_PROFILE,
        diagnostics: serializeDiagnostics(collectCompileDiagnostics(compiled)),
      } satisfies DiagnosticsDocument,
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(auditRoot, "source-map.json"),
    `${JSON.stringify(emitResult.sourceMap, null, 2)}\n`,
  );
  writeFileSync(
    join(auditRoot, "generated-artifacts.json"),
    `${JSON.stringify(
      {
        version: AUDIT_SCHEMA_VERSION,
        backendProfile: BACKEND_PROFILE,
        artifacts: [
          emitResult.cobolArtifactPath,
          emitResult.sourceMapArtifactPath,
          ...copybookPaths,
          jclResult.jclArtifactPath,
          join(auditRoot, "diagnostics.json"),
          join(auditRoot, "source-map.json"),
          join(auditRoot, "decimal-analysis.json"),
          join(auditRoot, "transaction-analysis.json"),
          join(auditRoot, "copybook-layout.json"),
          join(auditRoot, "verification-report.md"),
          join(auditRoot, "verification-report.json"),
          layoutOutputs.markdownPath,
        ],
      } satisfies AuditManifestDocument,
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(auditRoot, "decimal-analysis.json"),
    `${JSON.stringify(
      {
        version: AUDIT_SCHEMA_VERSION,
        backendProfile: BACKEND_PROFILE,
        entries: collectDecimalAnalysis(compiled.ir.program as IRProgram),
      } satisfies DecimalAnalysisDocument,
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(auditRoot, "transaction-analysis.json"),
    `${JSON.stringify(
      {
        version: AUDIT_SCHEMA_VERSION,
        backendProfile: BACKEND_PROFILE,
        transactions: describeTransactions(compiled),
        status:
          compiled.semantics.summary.transactionCount > 0
            ? "analyzed"
            : "no-transactions",
      } satisfies TransactionAnalysisDocument,
      null,
      2,
    )}\n`,
  );
  writeVerificationReportArtifacts(verificationReport, auditRoot);
  writeFileSync(
    layoutOutputs.jsonPath,
    `${JSON.stringify(layoutOutputs.document, null, 2)}\n`,
  );
  writeFileSync(
    join(auditRoot, "validation-matrix.md"),
    `# Validation Matrix\n\n| Artifact | Status | Backend profile |\n| --- | --- | --- |\n| COBOL source | emitted | ${BACKEND_PROFILE} |\n| Source map | emitted | ${BACKEND_PROFILE} |\n| Diagnostics | clean | ${BACKEND_PROFILE} |\n| Decimal analysis | emitted | ${BACKEND_PROFILE} |\n| Copybook layout | emitted | ${BACKEND_PROFILE} |\n| Copybook layout report | emitted | ${BACKEND_PROFILE} |\n| JCL | emitted | ${BACKEND_PROFILE} |\n`,
  );

  return auditRoot;
}

function writeVerificationReportArtifacts(
  report: VerificationReportDocument,
  auditRoot: string,
): string {
  const markdownPath = join(auditRoot, "verification-report.md");
  const jsonPath = join(auditRoot, "verification-report.json");
  writeFileSync(markdownPath, renderVerificationReportDocument(report), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return markdownPath;
}

function buildVerificationReportDocument(
  phase: "audit" | "verify",
  compiled: CompiledProject,
  emitResult: CobolEmitResult,
  jclResult: JclEmitResult,
  outputRoot: string,
  gnucobolValidation: GnucobolValidationSummary | null,
): VerificationReportDocument {
  const program = compiled.ir.program as IRProgram;
  const auditRoot = join(outputRoot, "audit");
  const copybookPaths = program.records.map((record) =>
    join(outputRoot, "copybooks", `${toCobolName(record.name)}.cpy`),
  );
  const copybookContents = copybookPaths.map((path) =>
    readFileSync(path, "utf8"),
  );
  const reEmittedCobol = emitCobol(program, {
    cobolArtifactPath: emitResult.cobolArtifactPath,
    sourceMapArtifactPath: emitResult.sourceMapArtifactPath,
  });
  const reEmittedJcl = emitJcl(program, {
    jclArtifactPath: jclResult.jclArtifactPath,
  });
  const deterministicMatches =
    readFileSync(emitResult.cobolArtifactPath, "utf8") ===
      reEmittedCobol.cobol &&
    readFileSync(emitResult.sourceMapArtifactPath, "utf8") ===
      `${JSON.stringify(reEmittedCobol.sourceMap, null, 2)}\n` &&
    readFileSync(jclResult.jclArtifactPath, "utf8") === reEmittedJcl.jcl &&
    copybookContents.every((content, index) => {
      const record = program.records[index];
      return content === renderCopybook(record);
    });
  const deterministicRegeneration: AuditCheck = {
    name: "Deterministic regeneration",
    status: deterministicMatches ? "passed" : "failed",
    details: deterministicMatches
      ? "Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts."
      : "One or more artifacts changed when regenerated from the same IR.",
  };
  const sourceMapCoverage = checkSourceMapCoverage(
    program,
    emitResult.sourceMap,
    emitResult.cobol,
  );
  const sourceMapCoverageCheck: AuditCheck = {
    name: "Source map coverage",
    status: sourceMapCoverage.diagnostics.length > 0 ? "failed" : "passed",
    details:
      sourceMapCoverage.diagnostics.length > 0
        ? sourceMapCoverage.diagnostics
            .map((diagnostic) => `${diagnostic.id} ${diagnostic.message}`)
            .join(" ")
        : `${sourceMapCoverage.coveredSymbolCount}/${sourceMapCoverage.expectedSymbolCount} traced symbols, all entries anchored in the generated COBOL.`,
  };
  const gnucobolCheck: AuditCheck = gnucobolValidation
    ? {
        name: "GnuCOBOL validation",
        status:
          gnucobolValidation.compilerStatus === "failed"
            ? "failed"
            : gnucobolValidation.validatedWithGnucobol
              ? "passed"
              : "skipped",
        details:
          gnucobolValidation.compilerStatus === "failed"
            ? `cobc exited with ${gnucobolValidation.compilerExitCode ?? "n/a"}`
            : gnucobolValidation.validatedWithGnucobol
              ? "Local cobc validation passed."
              : "No local cobc executable was available.",
      }
    : {
        name: "GnuCOBOL validation",
        status: "skipped",
        details: "Verification preview does not run the local cobc lane.",
      };
  const verificationReportPath = join(auditRoot, "verification-report.md");
  return {
    version: AUDIT_SCHEMA_VERSION,
    backendProfile: BACKEND_PROFILE,
    phase,
    project: compiled.sourceFile,
    checks: [
      {
        name: "Parse",
        status: "passed",
        details: `${compiled.parsed.diagnostics.length} diagnostics`,
      },
      {
        name: "Typecheck",
        status: "passed",
        details: `${compiled.typechecked.diagnostics.length} diagnostics`,
      },
      {
        name: "COBOL emit",
        status: "passed",
        details: emitResult.cobolArtifactPath,
      },
      {
        name: "Copybook emit",
        status: "passed",
        details: `${copybookPaths.length} copybook file(s)`,
      },
      {
        name: "Source map emit",
        status: "passed",
        details: emitResult.sourceMapArtifactPath,
      },
      {
        name: "JCL emit",
        status: "passed",
        details: jclResult.jclArtifactPath,
      },
      {
        name: "Audit artifacts",
        status: "passed",
        details: auditRoot,
      },
      deterministicRegeneration,
      sourceMapCoverageCheck,
      gnucobolCheck,
      {
        name: "Audit schema",
        status: "passed",
        details: `version ${AUDIT_SCHEMA_VERSION}, backend profile ${BACKEND_PROFILE}`,
      },
    ],
    artifacts: [
      emitResult.cobolArtifactPath,
      emitResult.sourceMapArtifactPath,
      ...copybookPaths,
      jclResult.jclArtifactPath,
      join(auditRoot, "diagnostics.json"),
      join(auditRoot, "source-map.json"),
      join(auditRoot, "decimal-analysis.json"),
      join(auditRoot, "transaction-analysis.json"),
      join(auditRoot, "copybook-layout.json"),
      join(auditRoot, "generated-artifacts.json"),
      verificationReportPath,
      join(auditRoot, "verification-report.json"),
      join(auditRoot, "validation-matrix.md"),
      ...(gnucobolValidation
        ? [join(auditRoot, "gnucobol-validation.md")]
        : []),
    ],
    deterministicRegeneration,
    sourceMapCoverage,
    gnucobolValidation,
    notes:
      phase === "verify"
        ? [
            "This report records the current deterministic compiler pipeline for the supported subset.",
            "IBM Enterprise COBOL validation is not claimed here.",
            "GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.",
          ]
        : [
            "This preview report is emitted during build/audit-report to prove the current deterministic artifact set.",
            "IBM Enterprise COBOL validation is not claimed here.",
            "Local GnuCOBOL validation is recorded by verify/test when available.",
          ],
  };
}

function renderVerificationReportDocument(
  report: VerificationReportDocument,
): string {
  const lines = [
    "# Verification Report",
    "",
    `Project: ${report.project}`,
    `Version: ${report.version}`,
    `Backend profile: ${report.backendProfile}`,
    `Phase: ${report.phase}`,
    "",
    "| Check | Status | Details |",
    "| --- | --- | --- |",
  ];

  for (const check of report.checks) {
    lines.push(`| ${check.name} | ${check.status} | ${check.details} |`);
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }

  lines.push(
    "",
    "## Source Map Coverage",
    "",
    `- expected-symbols: ${report.sourceMapCoverage.expectedSymbolCount}`,
    `- traced-symbols: ${report.sourceMapCoverage.coveredSymbolCount}`,
    `- coverage-gaps: ${report.sourceMapCoverage.diagnostics.length}`,
  );

  for (const diagnostic of report.sourceMapCoverage.diagnostics) {
    lines.push(`- ${diagnostic.id}: ${diagnostic.message}`);
  }

  if (report.gnucobolValidation) {
    lines.push(
      "",
      "## GnuCOBOL Validation",
      "",
      `- validated-with-gnucobol: ${
        report.gnucobolValidation.validatedWithGnucobol ? "yes" : "no"
      }`,
      `- compiler-status: ${report.gnucobolValidation.compilerStatus}`,
      `- compiler-command: ${report.gnucobolValidation.compilerCommand}`,
      `- compiler-exit-code: ${report.gnucobolValidation.compilerExitCode ?? "n/a"}`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

function writeTestReport(
  projectPath: string,
  outputRoot: string,
  checkResult: CliResult,
  buildResult: CliResult,
  verifyResult: CliResult,
): string {
  const auditRoot = join(outputRoot, "audit");
  mkdirSync(auditRoot, { recursive: true });
  const reportPath = join(auditRoot, "bankc-test-report.md");
  const gnucobolReportPath = join(auditRoot, "gnucobol-validation.md");
  const lines = [
    "# bankc Test Report",
    "",
    `Project: ${projectPath}`,
    `Version: ${AUDIT_SCHEMA_VERSION}`,
    `Backend profile: ${BACKEND_PROFILE}`,
    "",
    "| Step | Status | Details |",
    "| --- | --- | --- |",
    `| Check | ${checkResult.exitCode === 0 ? "passed" : "failed"} | ${summarizeCliResult(checkResult)} |`,
    `| Build | ${buildResult.exitCode === 0 ? "passed" : "failed"} | ${summarizeCliResult(buildResult)} |`,
    `| Verify | ${verifyResult.exitCode === 0 ? "passed" : "failed"} | ${summarizeCliResult(verifyResult)} |`,
    `| GnuCOBOL report | ${existsSync(gnucobolReportPath) ? "emitted" : "skipped"} | ${gnucobolReportPath} |`,
    "",
    "## Notes",
    "",
    "- This report records command orchestration only.",
    "- It does not claim business-semantics execution beyond the supported compiler subset.",
    "- Local GnuCOBOL validation remains separate from IBM validation claims.",
    "",
  ];

  writeFileSync(reportPath, `${lines.join("\n")}`, "utf8");
  return reportPath;
}

function summarizeCliResult(result: CliResult): string {
  const firstLine =
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? result.stderr.trim();
  return firstLine.length > 0 ? firstLine : "no additional output";
}

function writeLayoutOutputs(
  program: IRProgram,
  outputRoot: string,
  markdownPath: string,
): {
  document: ReturnType<typeof buildCopybookLayoutDocument>;
  markdownPath: string;
  jsonPath: string;
} {
  mkdirSync(outputRoot, { recursive: true });
  const document = buildCopybookLayoutDocument(program, markdownPath);
  const jsonPath = join(outputRoot, "copybook-layout.json");
  writeFileSync(markdownPath, renderCopybookLayoutDocument(document), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return {
    document,
    markdownPath,
    jsonPath,
  };
}

function writeJclOutputs(result: JclEmitResult): void {
  mkdirSync(dirname(result.jclArtifactPath), { recursive: true });
  writeFileSync(result.jclArtifactPath, result.jcl, "utf8");
}

function writeCobolOutputs(result: CobolEmitResult): void {
  mkdirSync(dirname(result.cobolArtifactPath), { recursive: true });
  mkdirSync(dirname(result.sourceMapArtifactPath), { recursive: true });
  writeFileSync(result.cobolArtifactPath, result.cobol, "utf8");
  writeFileSync(
    result.sourceMapArtifactPath,
    `${JSON.stringify(result.sourceMap, null, 2)}\n`,
    "utf8",
  );
}

function collectDecimalAnalysis(program: IRProgram): unknown[] {
  const rows: unknown[] = [];

  for (const record of program.records) {
    for (const field of record.fields) {
      if (field.type.kind !== "decimal") {
        continue;
      }

      rows.push(
        describeDecimal(
          field.name,
          field.type,
          field.span,
          "record-field",
          program.sourceFile,
          record.name,
        ),
      );
    }
  }

  for (const fn of program.functions) {
    for (const parameter of fn.parameters) {
      if (parameter.type.kind === "decimal") {
        rows.push(
          describeDecimal(
            parameter.name,
            parameter.type,
            parameter.span,
            "parameter",
            program.sourceFile,
            fn.name,
          ),
        );
      }
    }

    if (fn.returnType.kind === "decimal") {
      rows.push(
        describeDecimal(
          fn.name,
          fn.returnType,
          fn.span,
          "return-type",
          program.sourceFile,
          fn.name,
        ),
      );
    }

    for (const statement of fn.body.statements) {
      walkStatement(statement, rows, program.sourceFile, fn.name);
    }
  }

  return rows;
}

function walkStatement(
  statement: IRStatement,
  rows: unknown[],
  sourceFile: string,
  symbol: string,
): void {
  switch (statement.kind) {
    case "LetStatement":
      if (statement.declaredType.kind === "decimal") {
        rows.push(
          describeDecimal(
            statement.name,
            statement.declaredType,
            statement.span,
            "local-declaration",
            sourceFile,
            symbol,
          ),
        );
      }
      walkExpression(statement.initializer, rows, sourceFile, symbol);
      return;
    case "ReturnStatement":
      walkExpression(statement.expression, rows, sourceFile, symbol);
      return;
    case "IfStatement":
      walkExpression(statement.condition, rows, sourceFile, symbol);
      for (const nested of statement.thenBranch.statements) {
        walkStatement(nested, rows, sourceFile, symbol);
      }
      if (statement.elseBranch) {
        for (const nested of statement.elseBranch.statements) {
          walkStatement(nested, rows, sourceFile, symbol);
        }
      }
      return;
  }
}

function walkExpression(
  expression: IRExpression,
  rows: unknown[],
  sourceFile: string,
  symbol: string,
): void {
  switch (expression.kind) {
    case "DecimalLiteral":
      rows.push(
        describeDecimal(
          expression.text,
          expression.resolvedType,
          expression.span,
          "literal",
          sourceFile,
          symbol,
        ),
      );
      return;
    case "BinaryArithmetic":
      walkExpression(expression.left, rows, sourceFile, symbol);
      walkExpression(expression.right, rows, sourceFile, symbol);
      return;
    case "BinaryComparison":
      walkExpression(expression.left, rows, sourceFile, symbol);
      walkExpression(expression.right, rows, sourceFile, symbol);
      return;
    case "Identifier":
    case "BooleanLiteral":
      return;
  }
}

function describeDecimal(
  symbol: string,
  type: Extract<IRType, { kind: "decimal" }>,
  span: SourceSpan,
  category: string,
  sourceFile: string,
  owner: string,
): Record<string, unknown> {
  return {
    category,
    owner,
    symbol,
    sourceFile,
    sourceSpan: span,
    precision: type.precision,
    scale: type.scale,
    packedBytes: packedDecimalBytes(type.precision),
    picture: decimalPicture(type.precision, type.scale),
  };
}

function packedDecimalBytes(precision: number): number {
  return Math.ceil((precision + 1) / 2);
}

function getCobolArtifactPath(program: IRProgram, outputRoot: string): string {
  return join(outputRoot, "cobol", `${toCobolName(program.moduleName)}.cbl`);
}

function getJclArtifactPath(program: IRProgram, outputRoot: string): string {
  return join(outputRoot, "jcl", `${toCobolName(program.moduleName)}.jcl`);
}
