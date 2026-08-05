import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { formatDiagnostic, type Diagnostic } from "../packages/ast/src/index";
import { emitCobol, renderCopybook } from "../packages/cobol-backend/src/index";
import { loadConfig } from "../packages/config/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { toCobolName, toCobolProgramId } from "../packages/cobol-ir/src/index";
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
  /** Where copybooks are written, and the compiler's search path for them. */
  copybookDir: string;
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
  // A warning is a hazard the compiler wants recorded, not a reason to refuse
  // to validate. Stopping on one meant the program most worth compiling here —
  // the one carrying a known caveat — was the one never compiled.
  if (
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !typechecked.program
  ) {
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
    copybookDir: join(gnucobolRoot, "copybooks"),
  } satisfies ValidationArtifacts;

  // The project decides whether record layouts are written into the program or
  // copied into it, and validation has to compile whichever it actually ships.
  const copybookMode = loadConfig(projectPath, cwd).config.copybookMode;

  const emit = emitCobol(ir.program, {
    cobolArtifactPath: artifacts.cobolPath,
    sourceMapArtifactPath: artifacts.sourceMapPath,
    copybookMode,
  });
  writeCobolOutputs(emit);
  mkdirSync(dirname(artifacts.binaryPath), { recursive: true });
  mkdirSync(artifacts.copybookDir, { recursive: true });
  for (const record of ir.program.records) {
    writeFileSync(
      join(artifacts.copybookDir, `${toCobolName(record.name)}.cpy`),
      renderCopybook(record),
      "utf8",
    );
  }

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
    // `-PRE` rather than `.precompiled`, because GnuCOBOL caps a source file's
    // base name at 31 characters and a suffix this tool chose should not be
    // what makes a legitimate module name too long to validate.
    precompiledArtifact = artifacts.cobolPath.replace(/\.cbl$/, "-PRE.cbl");
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
      // A program that COPYs its record layouts needs the copybook directory
      // on the search path, the local equivalent of SYSLIB. Without it the
      // copy statements resolve to nothing and every data name is undefined.
      "-I",
      relative(cwd, artifacts.copybookDir),
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
