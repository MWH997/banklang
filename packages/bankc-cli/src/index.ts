import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync as writeArtifactBytes,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  formatDiagnostic,
  type Diagnostic,
  type SourceSpan,
} from "../../ast/src/index";
import {
  emitCobol,
  emitJcl,
  emitJobJcl,
  type CobolEmitResult,
  type JclEmitResult,
  type JobSortStep,
  type JobStep,
  renderCopybook,
} from "../../cobol-backend/src/index";
import {
  buildCopybookLayoutDocument,
  diffGeneratedCopybooks,
  inspectGeneratedCopybook,
  renderCopybookLayoutDocument,
  renderCopybookDiff,
  renderCopybookInspection,
  renderCopybookTypes,
} from "../../copybook/src/index";
import { compareLayouts, importCopybook } from "../../copybook/src/import";
import { importDclgen } from "../../copybook/src/dclgen";
import { analyzeProgramSemantics } from "../../semantic-analyzer/src/index";
import {
  analyseCobol,
  renderInventory,
  renderParagraphGraph,
} from "../../migration-analysis/src/index";
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
import {
  copybookMemberName,
  decimalPicture,
  toCobolProgramId,
} from "../../cobol-ir/src/index";
import {
  DIAGNOSTICS,
  NAMESPACE_TITLES,
  explainDiagnostic,
  namespaceOf,
  renderDiagnosticDoc,
} from "../../diagnostics/src/index";
import {
  DIAGNOSTIC_FORMATS,
  isDiagnosticFormat,
  renderDiagnostics as renderDiagnosticsAs,
  type DiagnosticFormat,
} from "../../diagnostics/src/reporters";
import { formatBankTs } from "../../formatter/src/index";
import {
  CONFIG_FILE_NAME,
  loadConfig,
  renderDefaultConfig,
} from "../../config/src/index";
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
  /** How record layouts reach the program, from the project's configuration. */
  copybookMode: "inline" | "copy";
  decimalPoint: "point" | "comma";
  currencySign: string;
  /** Language Environment options the job's `CEEOPTS` DD states. */
  runtimeOptions: string[];
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

/**
 * Where the command was run, for writing paths down the way they were typed.
 *
 * Module state rather than a parameter because every artifact writer would
 * otherwise have to carry it, and there are twenty-three of them. Set once per
 * invocation, at the top of `runBankc`.
 */
let commandCwd = process.cwd();

/**
 * Writes an artifact, with this machine's absolute paths taken back out of it.
 *
 * `evidence/` is checked in and is what a reader is invited to check the
 * project's claims against, and every report in it named
 * `/Users/<somebody>/Code/banklang/...` — so nobody else could reproduce a byte
 * of it, in a project whose first claim is that the same input always produces
 * the same output. The paths are still there and still correct; they are
 * relative to where the command ran, which is what a reader can act on.
 */
function writeFileSync(
  path: string,
  content: string,
  encoding: "utf8" = "utf8",
): void {
  writeArtifactBytes(path, portablePaths(content), encoding);
}

/** Absolute paths under the working directory, rewritten as relative ones. */
export function portablePaths(text: string, cwd = commandCwd): string {
  const prefix = `${cwd.replace(/\/+$/, "")}/`;
  return text.split(prefix).join("");
}

export function runBankc(argv: string[], cwd = process.cwd()): CliResult {
  commandCwd = cwd;
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
    case "job":
      return runJob(rest, cwd);
    case "analyse":
    case "analyze":
      return runAnalyse(rest, cwd);
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
    case "dclgen":
      return runDclgen(rest, cwd);
    case "explain":
      return runExplain(rest);
    case "fmt":
      return runFmt(rest, cwd);
    case "init":
      return runInit(rest, cwd);
    case "config":
      return runConfig(rest, cwd);
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

  const format = resolveDiagnosticFormat(args);
  if (!format) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown --format value. Supported: ${DIAGNOSTIC_FORMATS.join(", ")}.\n`,
    };
  }

  const compiled = compileProject(projectPath, cwd);
  const diagnostics = collectCompileDiagnostics(compiled);

  // A warning is reported and does not fail the check. It used to, which made
  // it an error wearing a softer word: a batch warned about its restart hazard
  // could not pass `check` at all, and neither could a program using a
  // construct that merely carries a caveat. The report still carries every
  // diagnostic, so nothing is hidden by the exit code being 0.
  const failed = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );

  // Machine-readable formats are always produced, including when empty, so a
  // CI step can upload the report unconditionally.
  if (format !== "text") {
    const report = renderDiagnosticsAs(diagnostics, format);
    const outputPath = readFlagValue(args, "--output");
    const exitCode = failed.length > 0 ? 1 : 0;

    if (outputPath) {
      const target = resolve(cwd, outputPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, report, "utf8");
      return {
        exitCode,
        stdout: `Wrote ${target}\n`,
        stderr: "",
      };
    }

    return { exitCode, stdout: report, stderr: "" };
  }

  if (failed.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(diagnostics),
    };
  }

  return {
    exitCode: 0,
    stdout: `OK: ${projectPath}\n`,
    stderr: advisoryDiagnostics(compiled),
  };
}

function resolveDiagnosticFormat(args: string[]): DiagnosticFormat | null {
  const value = readFlagValue(args, "--format");
  if (value === null) {
    return "text";
  }
  return isDiagnosticFormat(value) ? value : null;
}

function readFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
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
    if (blockingDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(blockingDiagnostics(compiled)),
      };
    }

    const emitResult = emitCobol(compiled.ir.program as IRProgram, {
      cobolArtifactPath: getCobolArtifactPath(
        compiled.ir.program as IRProgram,
        outputRoot,
      ),
      sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
      artifactRoot: outputRoot,
      copybookMode: compiled.copybookMode,
      decimalPoint: compiled.decimalPoint,
      currencySign: compiled.currencySign,
    });
    writeCobolOutputs(emitResult);
    return {
      exitCode: 0,
      stdout: `Wrote ${emitResult.cobolArtifactPath}\nWrote ${emitResult.sourceMapArtifactPath}\n`,
      stderr: advisoryDiagnostics(compiled),
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
    if (blockingDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(blockingDiagnostics(compiled)),
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
    if (blockingDiagnostics(compiled).length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: renderDiagnostics(blockingDiagnostics(compiled)),
      };
    }

    const jclResult = emitJcl(compiled.ir.program as IRProgram, {
      jclArtifactPath: getJclArtifactPath(
        compiled.ir.program as IRProgram,
        outputRoot,
      ),
      usesCopybooks: compiled.copybookMode === "copy",
      runtimeOptions: compiled.runtimeOptions,
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

/**
 * `bankc analyse <path...>` — read COBOL that already exists and say what is
 * in it.
 *
 * The question a bank asks before any other: what happens to the two thousand
 * programs we already have. The answer starts as a count — how many, how big,
 * what they touch, which ones nobody can follow — and this is that count, with
 * what it does not know printed underneath it.
 *
 * A path may be a file or a directory; a directory is read for `.cbl` and
 * `.cob` members, one level deep and then recursively.
 */
function runAnalyse(args: string[], cwd: string): CliResult {
  const paths = positionalArgs(args);
  if (paths.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Usage: bankc analyse <file-or-directory>...\n",
    };
  }

  const members = paths.flatMap((path) => cobolMembers(resolve(cwd, path)));
  if (members.length === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `No .cbl or .cob members under ${paths.join(", ")}.\n`,
    };
  }

  const analyses = members.map((member) =>
    analyseCobol(readFileSync(member, "utf8"), relativeToCwd(member, cwd)),
  );

  const outIndex = args.indexOf("--out");
  if (outIndex === -1) {
    return {
      exitCode: 0,
      stdout: renderInventory(analyses),
      stderr: "",
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  mkdirSync(outputRoot, { recursive: true });
  const written = [join(outputRoot, "inventory.md")];
  writeFileSync(written[0], renderInventory(analyses), "utf8");

  for (const analysis of analyses) {
    const name = analysis.programId ?? "PROGRAM";
    const path = join(outputRoot, `${name}-paragraphs.md`);
    writeFileSync(
      path,
      `# ${name} — paragraph graph\n\n${renderParagraphGraph(analysis)}\n`,
      "utf8",
    );
    written.push(path);
  }

  return {
    exitCode: 0,
    stdout: written.map((path) => `Wrote ${path}`).join("\n") + "\n",
    stderr: "",
  };
}

/** Every COBOL member under a path, which may be one file. */
function cobolMembers(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  if (!statSync(path).isDirectory()) {
    return /\.(cbl|cob)$/i.test(path) ? [path] : [];
  }
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => cobolMembers(join(path, entry.name)))
    .sort();
}

export const JOB_FILE_NAME = "job.json";

/** One step as `job.json` writes it. */
type JobDescriptorStep =
  { kind: "program"; name: string; project: string } | JobSortStep;

interface JobDescriptor {
  name: string;
  description: string;
  steps: JobDescriptorStep[];
}

/**
 * `job.json`, read strictly.
 *
 * A step name becomes a JCL step name, which is one to eight characters and is
 * what a restart and every `COND` refer to; a job whose steps are named by
 * whatever happened to be in the file is one an operator cannot restart at a
 * step. Everything here is checked when the job is built rather than trusted
 * and written into the stream, because a malformed name is a JCL error at
 * three in the morning and a clear message now.
 */
export function parseJobDescriptor(text: string): JobDescriptor {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const name = raw.name;
  const description = raw.description;
  const steps = raw.steps;

  if (typeof name !== "string" || name.length === 0) {
    throw new Error("A job needs a name.");
  }
  if (typeof description !== "string" || description.length === 0) {
    throw new Error("A job needs a description; it goes on the JOB card.");
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("A job needs at least one step.");
  }

  const seen = new Set<string>();
  const parsed = steps.map((entry, index) => {
    const step = entry as Record<string, unknown>;
    const stepName = step.name;
    if (
      typeof stepName !== "string" ||
      !/^[A-Z#$@][A-Z0-9#$@]{0,7}$/.test(stepName)
    ) {
      throw new Error(
        `Step ${index + 1} needs a name of one to eight characters, starting with a letter, as JCL requires.`,
      );
    }
    if (seen.has(stepName)) {
      throw new Error(
        `Two steps are named ${stepName}. A COND and a restart both refer to a step by name, so they have to differ.`,
      );
    }
    seen.add(stepName);

    if (typeof step.project === "string") {
      return {
        kind: "program" as const,
        name: stepName,
        project: step.project,
      };
    }
    if (
      typeof step.input === "string" &&
      typeof step.output === "string" &&
      typeof step.fields === "string"
    ) {
      return {
        kind: "sort" as const,
        name: stepName,
        input: step.input,
        output: step.output,
        fields: step.fields,
      };
    }
    throw new Error(
      `Step ${stepName} is neither a program (\`project\`) nor a sort (\`input\`, \`output\`, \`fields\`).`,
    );
  });

  return { name, description, steps: parsed };
}

/**
 * `bankc job <dir>` — build every program in a job directory, then emit the one
 * job stream that runs them.
 *
 * A job directory holds `job.json` and a subdirectory per program, each of them
 * an ordinary BankLang project. Every program is built exactly as `bankc build`
 * would build it, load module and build job and all; what this adds is the
 * stream that runs them in order, with the sort steps between and the
 * conditions that stop a night whose extract failed from posting anyway.
 */
function runJob(args: string[], cwd: string): CliResult {
  const jobPath = requireProjectPath(args, "job");
  if (!jobPath) {
    return { exitCode: 1, stdout: "", stderr: renderHelp() };
  }

  const descriptorPath = resolve(cwd, jobPath, JOB_FILE_NAME);
  if (!existsSync(descriptorPath)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `No ${JOB_FILE_NAME} in ${jobPath}. A job directory holds one, naming the steps in order.\n`,
    };
  }

  let descriptor: JobDescriptor;
  try {
    descriptor = parseJobDescriptor(readFileSync(descriptorPath, "utf8"));
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${descriptorPath}: ${(error as Error).message}\n`,
    };
  }

  const outputRoot = resolveOutputRoot(cwd, args);
  const written: string[] = [];
  const steps: JobStep[] = [];
  let runtimeOptions: readonly string[] = [];

  for (const step of descriptor.steps) {
    if (step.kind === "sort") {
      steps.push(step);
      continue;
    }

    // Each program is a project of its own, built into its own directory so
    // two programs in one job cannot overwrite each other's artifacts.
    const projectPath = join(jobPath, step.project);
    const result = runBuild(
      [projectPath, "--out", join(outputRoot, step.project)],
      cwd,
    );
    if (result.exitCode !== 0) {
      return {
        exitCode: result.exitCode,
        stdout: "",
        stderr: `${projectPath}\n${result.stderr}`,
      };
    }
    written.push(...result.stdout.trimEnd().split("\n"));

    const compiled = compileProject(projectPath, cwd);
    steps.push({
      kind: "program",
      name: step.name,
      program: compiled.ir.program as IRProgram,
    });
    runtimeOptions = compiled.runtimeOptions;
  }

  const jclPath = join(
    outputRoot,
    "jcl",
    `${toCobolProgramId(descriptor.name)}.jcl`,
  );
  const jcl = emitJobJcl(
    { name: descriptor.name, description: descriptor.description, steps },
    { runtimeOptions },
  );
  mkdirSync(dirname(jclPath), { recursive: true });
  writeFileSync(jclPath, jcl, "utf8");

  return {
    exitCode: 0,
    stdout: [...written, `Wrote ${jclPath}`].join("\n") + "\n",
    stderr: "",
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
  if (blockingDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(blockingDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
    artifactRoot: outputRoot,
    copybookMode: compiled.copybookMode,
    decimalPoint: compiled.decimalPoint,
    currencySign: compiled.currencySign,
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
    usesCopybooks: compiled.copybookMode === "copy",
    runtimeOptions: compiled.runtimeOptions,
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
  if (blockingDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(blockingDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
    artifactRoot: outputRoot,
    copybookMode: compiled.copybookMode,
    decimalPoint: compiled.decimalPoint,
    currencySign: compiled.currencySign,
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
    usesCopybooks: compiled.copybookMode === "copy",
    runtimeOptions: compiled.runtimeOptions,
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
  if (blockingDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(blockingDiagnostics(compiled)),
    };
  }

  const emitResult = emitCobol(compiled.ir.program as IRProgram, {
    cobolArtifactPath: getCobolArtifactPath(
      compiled.ir.program as IRProgram,
      outputRoot,
    ),
    sourceMapArtifactPath: join(outputRoot, "maps", "source-map.json"),
    artifactRoot: outputRoot,
    copybookMode: compiled.copybookMode,
    decimalPoint: compiled.decimalPoint,
    currencySign: compiled.currencySign,
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
    usesCopybooks: compiled.copybookMode === "copy",
    runtimeOptions: compiled.runtimeOptions,
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
  if (blockingDiagnostics(compiled).length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: renderDiagnostics(blockingDiagnostics(compiled)),
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

  if (subcommand === "import") {
    const filePath = requireCopybookPath(rest, "copybook import");
    if (!filePath) {
      return { exitCode: 1, stdout: "", stderr: renderHelp() };
    }

    try {
      return renderCopybookImport(
        readFileSync(resolve(cwd, filePath), "utf8"),
        filePath,
        jsonMode,
      );
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
 * A DCLGEN member read into a BankTS record.
 *
 * DCLGEN is Db2's own declarations generator, so the member states each
 * column's real SQL type and whether it may be null — two things a copybook
 * cannot say. A nullable column becomes `nullable<T>`, which is what makes
 * `BANK-TYPE-008` refuse a program that reads one without checking.
 *
 * The member also carries DCLGEN's own COBOL declaration for the same columns,
 * and every type read here is turned back into a picture and compared against
 * it. A disagreement is this compiler being wrong about Db2.
 */
function runDclgen(args: string[], cwd: string): CliResult {
  const [subcommand, ...rest] = args;
  const jsonMode = rest.includes("--json");

  if (subcommand !== "import") {
    return {
      exitCode: 1,
      stdout: renderHelp(),
      stderr: `Unknown dclgen subcommand: ${subcommand ?? ""}\n`,
    };
  }

  const filePath = requireCopybookPath(rest, "dclgen import");
  if (!filePath) {
    return { exitCode: 1, stdout: "", stderr: renderHelp() };
  }

  try {
    const imported = importDclgen(readFileSync(resolve(cwd, filePath), "utf8"));
    if (jsonMode) {
      return {
        exitCode: imported.problems.length > 0 ? 1 : 0,
        stdout: `${JSON.stringify(imported, null, 2)}\n`,
        stderr: "",
      };
    }
    if (imported.problems.length > 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${[
          `${filePath} did not import cleanly.`,
          "",
          ...imported.problems.map(
            (problem) => `${problem.field}: ${problem.message}`,
          ),
          "",
          "Nothing was written. A host variable of the wrong shape is one Db2",
          "refuses at bind time if you are lucky.",
        ].join("\n")}\n`,
      };
    }
    return { exitCode: 0, stdout: `${imported.source}\n`, stderr: "" };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

/**
 * A copybook read into a BankTS record, and the round trip that proves it.
 *
 * The record is emitted straight back to a copybook and the two layouts are
 * compared field by field. An import that does not survive that is refused: a
 * field read at the wrong length moves every field after it, and a record that
 * lays out differently from the one the rest of the estate uses is a program
 * reading somebody else’s data.
 */
function renderCopybookImport(
  sourceText: string,
  filePath: string,
  jsonMode: boolean,
): CliResult {
  const imported = importCopybook(sourceText);
  const problems = [...imported.problems];

  // Round-tripped only when the import is whole. A record missing a field it
  // could not read would fail the comparison for a reason already reported,
  // and saying it twice helps nobody.
  if (problems.length === 0) {
    const module = `module CopybookImport;\n\n${imported.source}\n`;
    const parsed = parseBankTs(module, filePath);
    const typechecked = typecheckProgram(parsed.program);
    const ir = lowerProgramToIR(typechecked);
    const record = ir.program?.records.find(
      (entry) => entry.name === imported.recordName,
    );

    if (!record) {
      problems.push({
        field: imported.recordName,
        message: `The imported record does not compile: ${[
          ...parsed.diagnostics,
          ...typechecked.diagnostics,
        ]
          .map((entry) => entry.id)
          .join(", ")}`,
      });
    } else {
      problems.push(
        ...compareLayouts(
          inspectGeneratedCopybook(sourceText),
          inspectGeneratedCopybook(renderCopybook(record)),
        ),
      );
    }
  }

  if (jsonMode) {
    return {
      exitCode: problems.length > 0 ? 1 : 0,
      stdout: `${JSON.stringify({ ...imported, problems }, null, 2)}\n`,
      stderr: "",
    };
  }

  if (problems.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${[
        `${filePath} did not import cleanly.`,
        "",
        ...problems.map((problem) => `${problem.field}: ${problem.message}`),
        "",
        "Nothing was written. A record that lays out differently from the",
        "copybook is worse than no record at all.",
      ].join("\n")}\n`,
    };
  }

  return { exitCode: 0, stdout: `${imported.source}\n`, stderr: "" };
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
 * Diagnostics that stop a command, which is the errors and not the warnings.
 *
 * Every command used to stop on any diagnostic at all, so a warning was an
 * error wearing a softer word: a batch warned about its restart hazard
 * (`BANK-FILE-003`) could not be emitted, and neither could a program using a
 * construct that carries a caveat. A warning exists to be read and weighed, not
 * to refuse the work — so warnings are still printed, and the command carries
 * on.
 */
function blockingDiagnostics(compiled: CompiledProject): Diagnostic[] {
  const diagnostics = collectCompileDiagnostics(compiled);
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? diagnostics
    : [];
}

/** Warnings from a command that is going ahead anyway. */
function advisoryDiagnostics(compiled: CompiledProject): string {
  const warnings = collectCompileDiagnostics(compiled).filter(
    (diagnostic) => diagnostic.severity !== "error",
  );
  return warnings.length > 0 ? renderDiagnostics(warnings) : "";
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
    case "StringCall":
    case "NumericCall":
    case "TemporalCall":
      return `${expression.operation}(${expression.args.map(describeExpression).join(", ")})`;
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
    case "Logical":
    case "BinaryComparison":
    case "BinaryArithmetic":
      return `${describeExpression(expression.left)} ${expression.operator} ${describeExpression(expression.right)}`;
    case "Not":
      return `!${describeExpression(expression.operand)}`;
    case "Rounded":
      return `round(${describeExpression(expression.operand)}, ${expression.mode})`;
    case "Call":
      return `${expression.callee}(${expression.args.map(describeExpression).join(", ")})`;
    case "EnumMember":
      return `${expression.enumName}.${expression.member}`;
    case "IndexAccess":
      return `${describeExpression(expression.target)}[${describeExpression(expression.index)}]`;
    case "NullableCheck":
      return `${expression.operation}(${describeExpression(expression.operand)})`;
  }
}

function compileProject(projectPath: string, cwd: string): CompiledProject {
  const sourceFile = resolveSourceFile(projectPath, cwd);
  const projectConfig = loadConfig(projectPath, cwd).config;
  const copybookMode = projectConfig.copybookMode;
  const sourceText = readFileSync(sourceFile, "utf8");
  // Parsed under the path as it was typed, not the resolved one. Every
  // diagnostic, every source map entry and every audit report carries this
  // string, and an absolute path makes all three different on every machine —
  // in a project whose first claim is that the same input produces the same
  // output. `evidence/` is checked in, so that difference was checked in too.
  const parsed = parseBankTs(sourceText, relativeToCwd(sourceFile, cwd));
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
        reports: [],
        databases: [],
        queues: [],
        fileErrorHandlers: [],
        enums: [],
        sql: [],
        callTargets: new Map(),
        recordBases: new Map(),
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
    copybookMode,
    decimalPoint: projectConfig.decimalPoint,
    currencySign: projectConfig.currencySign,
    runtimeOptions: projectConfig.runtimeOptions,
    sourceText,
    parsed,
    typechecked,
    ir,
    semantics,
  };
}

/**
 * A path as it should be written down: relative to where the command was run.
 *
 * Paths outside the working directory keep their absolute form, because a
 * `../../..` chain is no more portable and is harder to read.
 */
function relativeToCwd(path: string, cwd: string): string {
  const within = relative(cwd, path);
  return within.startsWith("..") || isAbsolute(within) ? path : within;
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

/** Flags that consume the argument after them. */
const VALUE_FLAGS = new Set(["--format", "--output", "--out"]);

/**
 * Positional arguments, skipping flags and the values they consume.
 *
 * Without this, `bankc check --format sarif examples/x` would treat `sarif`
 * as the project path.
 */
function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) {
        index += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

function requireProjectPath(
  args: string[],
  commandName: string,
): string | null {
  const [project] = positionalArgs(args);
  if (!project) {
    return null;
  }
  return project;
}

function requireCopybookPath(
  args: string[],
  commandName: string,
): string | null {
  const [file] = positionalArgs(args);
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

/**
 * `bankc fmt <project>` rewrites source files in place.
 * `--check` reports which files would change and exits non-zero, for CI.
 */
function runFmt(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "fmt");
  if (!projectPath) {
    return { exitCode: 1, stdout: "", stderr: renderHelp() };
  }

  const checkOnly = args.includes("--check");
  const sourceFile = resolveSourceFile(projectPath, cwd);

  if (!existsSync(sourceFile)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `No source file at ${sourceFile}\n`,
    };
  }

  const original = readFileSync(sourceFile, "utf8");
  const result = formatBankTs(original, sourceFile);

  if (result.diagnostics.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Cannot format a file with syntax errors.\n\n${renderDiagnostics(result.diagnostics)}`,
    };
  }

  if (result.unchanged) {
    return {
      exitCode: 0,
      stdout: `Already formatted: ${sourceFile}\n`,
      stderr: "",
    };
  }

  if (checkOnly) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Would reformat: ${sourceFile}\nRun \`bankc fmt ${projectPath}\` to fix.\n`,
    };
  }

  writeFileSync(sourceFile, result.text, "utf8");
  return { exitCode: 0, stdout: `Formatted ${sourceFile}\n`, stderr: "" };
}

/** `bankc init <directory>` scaffolds a compilable starter project. */
function runInit(args: string[], cwd: string): CliResult {
  const [target] = positionalArgs(args);
  if (!target) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Usage: bankc init <directory>\n",
    };
  }

  const root = resolve(cwd, target);
  const sourcePath = join(root, "src", "main.bank.ts");
  const configPath = join(root, CONFIG_FILE_NAME);

  if (existsSync(sourcePath)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Refusing to overwrite ${sourcePath}\n`,
    };
  }

  const moduleName = toModuleName(target);
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, renderStarterProgram(moduleName), "utf8");
  writeFileSync(configPath, renderDefaultConfig(), "utf8");

  return {
    exitCode: 0,
    stdout: [
      `Created ${sourcePath}`,
      `Created ${configPath}`,
      "",
      "Next:",
      `  bankc check ${target}`,
      `  bankc build ${target}`,
      "",
    ].join("\n"),
    stderr: "",
  };
}

/** `bankc config <project>` shows the resolved configuration. */
function runConfig(args: string[], cwd: string): CliResult {
  const projectPath = requireProjectPath(args, "config");
  if (!projectPath) {
    return { exitCode: 1, stdout: "", stderr: renderHelp() };
  }

  const loaded = loadConfig(projectPath, cwd);
  const lines = [
    `source: ${loaded.path ?? "defaults (no banklang.json found)"}`,
    `entry: ${loaded.config.entry}`,
    `outDir: ${loaded.config.outDir}`,
    `backendProfile: ${loaded.config.backendProfile}`,
    `formatCheck: ${loaded.config.formatCheck}`,
    `copybookMode: ${loaded.config.copybookMode}`,
    `decimalPoint: ${loaded.config.decimalPoint}`,
    `currencySign: ${loaded.config.currencySign}`,
  ];

  if (loaded.problems.length > 0) {
    return {
      exitCode: 1,
      stdout: `${lines.join("\n")}\n`,
      stderr: `${loaded.problems.map((problem) => `warning: ${problem}`).join("\n")}\n`,
    };
  }

  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function toModuleName(target: string): string {
  const base = target.split(/[\\/]/).filter(Boolean).pop() ?? "Main";
  const pascal = base
    .replace(/[^A-Za-z0-9]+(.)?/g, (_match, char: string | undefined) =>
      char ? char.toUpperCase() : "",
    )
    .replace(/^[a-z]/, (char) => char.toUpperCase());
  return /^[A-Za-z]/.test(pascal) ? pascal : `Module${pascal}`;
}

/**
 * `bankc <command> <project> --watch` reruns on source changes.
 *
 * Watching lives in the binary rather than in `runBankc`, which stays a pure
 * argv-to-result function so it remains directly testable.
 */
export function watchProject(
  argv: string[],
  cwd: string,
  write: (result: CliResult) => void,
): () => void {
  const args = argv.filter((arg) => arg !== "--watch");
  const projectPath = requireProjectPath(args.slice(1), cwd) ?? ".";
  const sourceFile = resolveSourceFile(projectPath, cwd);

  let running = false;
  let pending = false;

  const run = () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    write(runBankc(args, cwd));
    running = false;
    if (pending) {
      pending = false;
      run();
    }
  };

  run();

  const watcher = watch(
    dirname(sourceFile),
    { recursive: true },
    (_event, file) => {
      if (!file || file.toString().endsWith(".bank.ts")) {
        run();
      }
    },
  );

  return () => watcher.close();
}

function renderStarterProgram(moduleName: string): string {
  return `module ${moduleName};

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  // Required by BANK-TXN-001: a transaction must be safe to retry.
  idempotencyKey: string<36>;
}

function validateAmount(amount: MoneyBDT): bool {
  return amount > 0.00;
}

transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}
`;
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
    "  job <directory>",
    "  analyse <file-or-directory>...",
    "  emit cobol <project>",
    "  emit copybooks <project>",
    "  emit jcl <project>",
    "  audit-report <project>",
    "  verify <project>",
    "  test <project>",
    "  layout <project>",
    "  doctor",
    "  copybook import <file>",
    "  dclgen import <file>",
    "  copybook inspect <file>",
    "  copybook types <file>",
    "  copybook diff <left> <right>",
    "  explain [diagnostic-id]",
    "  fmt <project> [--check]",
    "  init <directory>",
    "  config <project>",
    "",
    "Options:",
    "  --format text|json|sarif   diagnostic output format for `check`",
    "  --output <file>            write the machine-readable report to a file",
    "  --out <dir>                output root for generated artifacts",
    "",
  ].join("\n");
}

/**
 * `bankc explain BANK-LED-001` prints the catalogue entry for a diagnostic.
 * With no argument it lists every catalogued identifier, grouped by namespace.
 */
function runExplain(args: string[]): CliResult {
  const [id] = args;

  if (!id) {
    const grouped = new Map<string, string[]>();
    for (const doc of DIAGNOSTICS) {
      const namespace = namespaceOf(doc.id);
      if (!namespace) {
        continue;
      }
      const label = `${NAMESPACE_TITLES[namespace]} (BANK-${namespace}-*)`;
      const line = `  ${doc.id}  ${doc.title}${doc.implemented ? "" : "  [reserved]"}`;
      grouped.set(label, [...(grouped.get(label) ?? []), line]);
    }

    const sections = [...grouped.entries()].map(
      ([label, lines]) => `${label}\n${lines.join("\n")}`,
    );

    return {
      exitCode: 0,
      stdout: `${["BankLang diagnostic catalogue", "", ...sections, "", "Run `bankc explain <id>` for one diagnostic."].join("\n")}\n`,
      stderr: "",
    };
  }

  const doc = explainDiagnostic(id);
  if (!doc) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown diagnostic: ${id}\nRun \`bankc explain\` to list every catalogued identifier.\n`,
    };
  }

  return { exitCode: 0, stdout: renderDiagnosticDoc(doc), stderr: "" };
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
    const outputPath = join(
      copybookDir,
      `${copybookMemberName(record.name)}.cpy`,
    );
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
      join(outputRoot, "copybooks", `${copybookMemberName(record.name)}.cpy`),
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
    join(outputRoot, "copybooks", `${copybookMemberName(record.name)}.cpy`),
  );
  const copybookContents = copybookPaths.map((path) =>
    readFileSync(path, "utf8"),
  );
  const reEmittedCobol = emitCobol(program, {
    cobolArtifactPath: emitResult.cobolArtifactPath,
    sourceMapArtifactPath: emitResult.sourceMapArtifactPath,
    artifactRoot: outputRoot,
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
              ? // Say when the compiled artifact went through the precompiler,
                // because that changes what the pass actually proves.
                gnucobolValidation.precompiled
                ? `Local cobc validation passed after precompiling (${gnucobolValidation.backendRequirements.join(" and ")}).`
                : "Local cobc validation passed."
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
    `| GnuCOBOL report | ${existsSync(gnucobolReportPath) ? "emitted" : "skipped"} | ${relative(process.cwd(), gnucobolReportPath)} |`,
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

/**
 * One line of a command's output, with this machine's path taken out of it.
 *
 * The report goes into a checked-in evidence bundle, and a bundle holding
 * `/Users/somebody/Code/banklang/dist/...` is one nobody else can reproduce
 * byte for byte — which is the whole claim the bundle is there to support.
 */
function summarizeCliResult(result: CliResult, cwd = process.cwd()): string {
  const firstLine =
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? result.stderr.trim();
  return firstLine.length > 0
    ? firstLine.split(`${cwd}/`).join("")
    : "no additional output";
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

/**
 * Where the generated program is written, named for the PDS member it becomes.
 *
 * The same rule as the `PROGRAM-ID`, the load module, and the `EXEC PGM=` in
 * the job, for the same reason the copybook file is named for its member: a
 * file named any other way is one the reader has to translate before finding
 * the member it corresponds to.
 */
function getCobolArtifactPath(program: IRProgram, outputRoot: string): string {
  return join(
    outputRoot,
    "cobol",
    `${toCobolProgramId(program.moduleName)}.cbl`,
  );
}

function getJclArtifactPath(program: IRProgram, outputRoot: string): string {
  return join(outputRoot, "jcl", `${toCobolProgramId(program.moduleName)}.jcl`);
}
