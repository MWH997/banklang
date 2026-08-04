import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { formatDiagnostic, type Diagnostic } from "../packages/ast/src/index";
import { emitCobol } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { toCobolProgramId } from "../packages/cobol-ir/src/index";
import { precompile } from "../packages/precompiler/src/index";

export interface GnucobolValidationSummary {
  backendProfile: "gnucobol-local";
  sourceArtifact: string;
  sourceArtifactHash: string;
  generatedArtifact: string;
  generatedArtifactHash: string;
  sourceMapArtifact: string;
  sourceMapArtifactHash: string;
  compilerExecutable: string | null;
  compilerVersion: string | null;
  compilerCommand: string;
  compilerExitCode: number | null;
  compilerStatus: "passed" | "failed" | "skipped";
  /** Preprocessing the generated program needs before a compiler accepts it. */
  backendRequirements: string[];
  /**
   * True when the compiled artifact was produced by the BankLang precompiler
   * rather than being the shipped COBOL directly.
   */
  precompiled: boolean;
  precompiledArtifact: string | null;
  compilerOutput: string | null;
  validatedWithGnucobol: boolean;
  knownBackendGaps: string[];
}

interface ValidationArtifacts {
  sourceFile: string;
  sourceMapPath: string;
  cobolPath: string;
  binaryPath: string;
}

export function runGnucobolValidation(
  cwd = process.cwd(),
  projectPath = "examples/account-transfer",
  outputRoot = resolve(cwd, "dist"),
): GnucobolValidationSummary {
  const sourceFile = resolve(cwd, projectPath, "src/main.bank.ts");
  const sourceText = readFileSync(sourceFile, "utf8");
  const sourceArtifactHash = hashText(sourceText);

  const parsed = parseBankTs(sourceText, sourceFile);
  const diagnostics = [...parsed.diagnostics];
  if (!parsed.program) {
    throw new Error(renderDiagnostics(diagnostics));
  }

  const typechecked = typecheckProgram(parsed.program);
  diagnostics.push(...typechecked.diagnostics);
  if (diagnostics.length > 0 || !typechecked.program) {
    throw new Error(renderDiagnostics(diagnostics));
  }

  const ir = lowerProgramToIR(typechecked);
  if (!ir.program) {
    throw new Error(renderDiagnostics(ir.diagnostics));
  }

  const gnucobolRoot = join(outputRoot, "gnucobol");
  const moduleArtifactName = toCobolProgramId(ir.program.moduleName);
  const artifacts = {
    sourceFile,
    sourceMapPath: join(gnucobolRoot, "maps", "source-map.json"),
    cobolPath: join(gnucobolRoot, "cobol", `${moduleArtifactName}.cbl`),
    binaryPath: join(gnucobolRoot, "bin", moduleArtifactName.toLowerCase()),
  } satisfies ValidationArtifacts;

  const emit = emitCobol(ir.program, {
    cobolArtifactPath: artifacts.cobolPath,
    sourceMapArtifactPath: artifacts.sourceMapPath,
  });
  writeCobolOutputs(emit);
  mkdirSync(dirname(artifacts.binaryPath), { recursive: true });

  const sourceMapArtifactHash = hashText(
    readFileSync(artifacts.sourceMapPath, "utf8"),
  );
  const generatedArtifactHash = hashText(
    readFileSync(artifacts.cobolPath, "utf8"),
  );

  // Embedded SQL and CICS need preprocessing before any COBOL compiler will
  // accept them, exactly as DSNHPC and the CICS translator do on z/OS. The
  // BankLang precompiler performs the equivalent translation so the program
  // can still be compiled and checked here.
  const backendRequirements = ir.program?.backendRequirements ?? [];
  const precompiled = backendRequirements.length > 0;
  let precompiledArtifact: string | null = null;

  if (precompiled) {
    const translated = precompile(readFileSync(artifacts.cobolPath, "utf8"));
    precompiledArtifact = artifacts.cobolPath.replace(
      /\.cbl$/,
      ".precompiled.cbl",
    );
    writeFileSync(precompiledArtifact, translated.cobol, "utf8");
  }

  const compileTarget = precompiledArtifact ?? artifacts.cobolPath;
  const compilerExecutable = resolveCobcExecutable(cwd);
  let compilerVersion: string | null = null;
  let compilerCommand = "cobc not found";
  let compilerExitCode: number | null = null;
  let compilerStatus: GnucobolValidationSummary["compilerStatus"] = "skipped";
  let compilerOutput: string | null = null;

  if (compilerExecutable) {
    compilerVersion =
      readProcessOutput(
        spawnSync(compilerExecutable, ["--version"], {
          encoding: "utf8",
        }),
      )?.split("\n")[0] ?? null;
    const compileArgs = [
      "-x",
      "-free",
      relative(cwd, compileTarget),
      "-o",
      relative(cwd, artifacts.binaryPath),
    ];
    compilerCommand = [compilerExecutable, ...compileArgs].join(" ");
    const compileResult = spawnSync(compilerExecutable, compileArgs, {
      encoding: "utf8",
      cwd,
    });
    compilerExitCode = compileResult.status;
    compilerOutput = joinProcessOutput(compileResult) || null;
    compilerStatus = compileResult.status === 0 ? "passed" : "failed";
    if (compileResult.error) {
      compilerOutput = [compilerOutput, compileResult.error.message]
        .filter(Boolean)
        .join("\n");
    }
  }

  const summary: GnucobolValidationSummary = {
    backendRequirements,
    precompiled,
    precompiledArtifact: precompiledArtifact
      ? relative(cwd, precompiledArtifact)
      : null,
    backendProfile: "gnucobol-local",
    sourceArtifact: relative(cwd, artifacts.sourceFile),
    sourceArtifactHash,
    generatedArtifact: relative(cwd, artifacts.cobolPath),
    generatedArtifactHash,
    sourceMapArtifact: relative(cwd, artifacts.sourceMapPath),
    sourceMapArtifactHash,
    compilerExecutable,
    compilerVersion,
    compilerCommand,
    compilerExitCode,
    compilerStatus,
    compilerOutput,
    validatedWithGnucobol: compilerStatus === "passed",
    knownBackendGaps: [
      ...(precompiled
        ? [
            `This program requires ${backendRequirements.join(" and ")}. It was translated by the BankLang precompiler before compiling, which checks the surrounding COBOL and every host variable but does not validate SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.`,
          ]
        : []),
      "This local profile covers the account-transfer subset only.",
      "GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.",
      "Db2, CICS, and VSAM sections are not exercised by this example.",
    ],
  };

  const reportPath = join(outputRoot, "audit", "gnucobol-validation.md");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, buildGnucobolValidationReport(summary), "utf8");

  return summary;
}

export function buildGnucobolValidationReport(
  summary: GnucobolValidationSummary,
): string {
  const lines = [
    "# GnuCOBOL Validation Report",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| validated-with-gnucobol | ${summary.validatedWithGnucobol ? "yes" : "no"} |`,
    `| backend-profile | ${summary.backendProfile} |`,
    `| source-artifact | ${summary.sourceArtifact} |`,
    `| source-artifact-sha256 | ${summary.sourceArtifactHash} |`,
    `| generated-artifact | ${summary.generatedArtifact} |`,
    `| generated-artifact-sha256 | ${summary.generatedArtifactHash} |`,
    `| source-map-artifact | ${summary.sourceMapArtifact} |`,
    `| source-map-artifact-sha256 | ${summary.sourceMapArtifactHash} |`,
    `| compiler-executable | ${summary.compilerExecutable ?? "not found"} |`,
    `| compiler-version | ${summary.compilerVersion ?? "unavailable"} |`,
    `| compiler-command | ${summary.compilerCommand} |`,
    `| compiler-exit-code | ${summary.compilerExitCode ?? "n/a"} |`,
    `| compiler-status | ${summary.compilerStatus} |`,
    "",
    "## Compiler Output",
    "",
    summary.compilerOutput ? "```text" : "_No compiler output recorded._",
    ...(summary.compilerOutput
      ? [summary.compilerOutput.trimEnd(), "```"]
      : []),
    "",
    "## Known Backend Gaps",
    "",
    ...summary.knownBackendGaps.map((gap) => `- ${gap}`),
    "",
    "## Validation Notes",
    "",
    "- GnuCOBOL is a local validation target only.",
    "- The IBM Enterprise COBOL profile remains the source of truth.",
    "- This report was generated without timestamps to preserve determinism.",
    "",
  ];

  return `${lines.join("\n")}`;
}

function resolveCobcExecutable(cwd: string): string | null {
  const configured = process.env.GNUCOBOL_COBC_PATH?.trim();
  if (configured) {
    return configured;
  }

  const probe = spawnSync("cobc", ["--version"], {
    cwd,
    encoding: "utf8",
  });

  if (probe.error || probe.status !== 0) {
    return null;
  }

  return "cobc";
}

function writeCobolOutputs({
  cobol,
  sourceMap,
  cobolArtifactPath,
  sourceMapArtifactPath,
}: ReturnType<typeof emitCobol>): void {
  mkdirSync(dirname(cobolArtifactPath), { recursive: true });
  mkdirSync(dirname(sourceMapArtifactPath), { recursive: true });
  writeFileSync(cobolArtifactPath, cobol, "utf8");
  writeFileSync(
    sourceMapArtifactPath,
    `${JSON.stringify(sourceMap, null, 2)}\n`,
    "utf8",
  );
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function joinProcessOutput(result: {
  stdout: string | Uint8Array | null;
  stderr: string | Uint8Array | null;
}): string {
  return [result.stdout, result.stderr]
    .map((value) =>
      typeof value === "string"
        ? value
        : value
          ? Buffer.from(value).toString("utf8")
          : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readProcessOutput(result: {
  stdout: string | Uint8Array | null;
  stderr: string | Uint8Array | null;
  error?: Error | null;
}): string | null {
  const output = joinProcessOutput(result);
  if (result.error) {
    return [output, result.error.message].filter(Boolean).join("\n");
  }
  return output || null;
}

function renderDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => formatDiagnostic(diagnostic))
    .join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Accept a project path so the lane can validate any example.
  const project = process.argv[2];
  const summary = project
    ? runGnucobolValidation(process.cwd(), project)
    : runGnucobolValidation();
  if (summary.compilerStatus === "failed") {
    process.exitCode = 1;
  }
}
