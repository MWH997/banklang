/**
 * zUnit test cases, generated from the `test` declarations in a program.
 *
 * IBM's z/OS Automated Unit Testing Framework runs a COBOL program on the
 * mainframe and reports pass or fail. A test case is three artifacts, not one:
 * a `.bzucfg` configuration in XML, a COBOL *test case program* that drives the
 * program under test, and — when the data was recorded from a real run — a
 * playback file. This module writes the first two and the JCL that runs them.
 * It writes no playback file: everything a generated case supplies is written
 * into the driver, which is the "supplied" rather than the "recorded" route.
 *
 * Every shape here was taken from test cases IBM's own generator produced,
 * which are quoted and cited in `docs/zunit.md`. The
 * parts that are inferred rather than observed are marked in that page and in
 * `docs/divergences.md`; there are two of them, and neither is guessed at
 * silently.
 *
 * What a generated case can see is what shapes the language surface. The driver
 * is a separate program: it enters the program under test through its entry
 * point and the runner intercepts the modules that program calls, so the
 * observable surface is the LINKAGE the step is started with and the calls it
 * makes. The program's WORKING-STORAGE is not reachable from here, and a test
 * that appeared to assert on it would be reporting a pass it never checked.
 */

import { createDiagnostic, type Diagnostic } from "../../ast/src/index";
import type { IRProgram, IRTest, IRTestLiteral } from "../../ir/src/index";
import { toCobolProgramId } from "../../cobol-ir/src/index";
import {
  RUNTIME_INTERFACES,
  batchParmFields,
  type BatchParmField,
  type RuntimeInterface,
} from "../../cobol-backend/src/index";
import {
  toJclStatement,
  toReferenceFormat,
} from "../../cobol-backend/src/reference-format";

export interface ZunitEmitOptions {
  /**
   * High-level qualifier the generated JCL puts its datasets under.
   *
   * A placeholder in the same sense as the rest of the generated JCL: no site
   * lets a compiler choose its dataset naming standard.
   */
  hlq?: string;
  configurationArtifactPath?: string;
  driverArtifactPath?: string;
  jclArtifactPath?: string;
}

export interface ZunitEmitResult {
  /** The `.bzucfg` configuration. */
  configuration: string;
  /** The test case program, in reference format. */
  driver: string;
  /** JCL that compiles the driver and runs the case. */
  jcl: string;
  /** Load module and member name of the test case program. */
  moduleName: string;
  /** Load module name of the program under test. */
  programName: string;
  configurationArtifactPath: string;
  driverArtifactPath: string;
  jclArtifactPath: string;
  diagnostics: Diagnostic[];
}

/**
 * The namespace of the configuration this writes.
 *
 * Two independently produced test cases carry `4.0.0.0`, one carries `3.0.0.0`,
 * and the elements below are the ones the 4.0.0.0 files use. A runner reading a
 * configuration it does not recognise rejects it, so the version is written out
 * here rather than left to a default.
 */
const RUNNER_NAMESPACE = "http://www.ibm.com/zUnit/4.0.0.0/TestRunner";

/**
 * Compiler options the test case program is translated with.
 *
 * Copied from IBM's generated cases, and every one of them matters. `TEST` is
 * what puts the hooks in that the runner intercepts calls through — it is the
 * z/OS Debugger's mechanism, which is why the info block comes from a copybook
 * named `EQAITERC` — and `PGMN(LU)` is what allows `TEST_<NAME>` to be a
 * program-name at all: under `PGMNAME(COMPAT)` it would be truncated to eight
 * characters with the underscore rejected.
 *
 * The program under test needs `TEST` too. The generated JCL says so, because
 * a program compiled without it runs and calls the real `BANKLEDG`.
 */
const PROCESS_OPTIONS = "NODLL,NODYNAM,TEST(NOSEP),NOCICS,NOSQL,PGMN(LU),NOSEQ";

/** Assertion severity, message number and prefix, as IBM's generator sets them. */
const ASSERT_SEVERITY = 4;
const ASSERT_MESSAGE_NUMBER = 2001;
const ASSERT_PREFIX = "AZU";

/**
 * The load module and member name of the generated test case.
 *
 * `T` in front of the program's own name, truncated to the eight characters a
 * member name has — the rule IBM's editor follows, which turned `LGICDB01`
 * into `TLGICDB0`. Two programs whose names agree in seven characters produce
 * one member, exactly as two programs agreeing in eight produce one load
 * module; `BANK-NAME-001` is what refuses the second case.
 */
export function zunitModuleName(program: IRProgram): string {
  return `T${toCobolProgramId(program.moduleName)}`.slice(0, 8);
}

export function emitZunit(
  program: IRProgram,
  options: ZunitEmitOptions = {},
): ZunitEmitResult {
  const programName = toCobolProgramId(program.moduleName);
  const moduleName = zunitModuleName(program);
  const hlq = options.hlq ?? "BANKLANG";
  const diagnostics: Diagnostic[] = [];
  const tests = program.tests;
  const parmFields = batchParmFields(program);

  // The modules a generated case stubs. A program that calls anything else
  // reaches the real module, which the JCL says in as many words.
  const stubbed = RUNTIME_INTERFACES.filter((runtimeInterface) =>
    tests.some((test) =>
      test.expectations.some(
        (expectation) =>
          expectedModule(expectation.kind) === runtimeInterface.module,
      ),
    ),
  );

  if (tests.length === 0) {
    diagnostics.push(
      createDiagnostic({
        id: "BANK-TEST-007",
        severity: "error",
        message: `${program.moduleName} declares no tests, so there is no case to run.`,
        span: program.moduleSpan,
        hint: "Write `test <name> for <entry transaction> { ... }`. A configuration naming no test is one the runner ends with nothing done.",
        backendProfile: "ibm-enterprise-cobol-zos",
      }),
    );
  }

  return {
    configuration: renderConfiguration(
      program,
      moduleName,
      programName,
      stubbed,
      parmFields,
    ),
    driver: renderDriver(program, moduleName, programName, stubbed, parmFields),
    jcl: renderJcl(program, moduleName, programName, hlq),
    moduleName,
    programName,
    configurationArtifactPath:
      options.configurationArtifactPath ?? `dist/zunit/${moduleName}.bzucfg`,
    driverArtifactPath:
      options.driverArtifactPath ?? `dist/zunit/${moduleName}.cbl`,
    jclArtifactPath: options.jclArtifactPath ?? `dist/zunit/${moduleName}.jcl`,
    diagnostics,
  };
}

function expectedModule(kind: "ledger" | "audit"): string {
  return kind === "ledger" ? "BANKLEDG" : "BANKAUDT";
}

/**
 * The configuration's identity, derived rather than drawn from a random source.
 *
 * IBM's editor writes a UUID here and the same UUID into the driver's
 * `BZU_INIT`, and the two have to agree. A random one would make the artifact
 * different on every build of an unchanged program, which is the one thing this
 * compiler promises never to do — so it is a hash of what the case is about,
 * shaped as a version 4 UUID because that is what the attribute holds.
 */
function testCaseId(programName: string, tests: IRTest[]): string {
  // Joined on a character no name can hold, so two different lists of names
  // cannot hash to one seed. Written as an escape: a literal NUL in the
  // source makes every tool that reads it treat this file as binary.
  const seed = [programName, ...tests.map((test) => test.name)].join("\u0000");
  // FNV-1a, run four times over the same text with different offsets, which is
  // enough to fill 128 bits without pulling in a hash implementation.
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map(
    (offset) => {
      let hash = offset >>> 0;
      for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash;
    },
  );
  const hex = words
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")
    .split("");
  // Version 4 in the 13th nibble and the variant in the 17th, so the value is a
  // well-formed UUID and not merely 32 hexadecimal characters.
  hex[12] = "4";
  hex[16] = "8";
  const digits = hex.join("");
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20, 32),
  ].join("-");
}

function xmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The `.bzucfg`, in the element order the observed configurations use.
 *
 * `runner:options`, then the test case and its tests, then one
 * `runner:intercept` per module — the program under test first, with
 * `stub="false"`, then each stubbed module with `stub="true"` — then
 * `runner:playback` and `runner:fileAttributes`.
 */
function renderConfiguration(
  program: IRProgram,
  moduleName: string,
  programName: string,
  stubbed: readonly RuntimeInterface[],
  parmFields: BatchParmField[],
): string {
  const tests = program.tests;
  const parmLength = parmFields.reduce((sum, field) => sum + field.width, 0);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<runner:RunnerConfiguration xmlns:runner="${RUNNER_NAMESPACE}" id="${testCaseId(programName, tests)}">`,
    `  <runner:options contOnTestCaseError="false" contOnTestCaseFail="true" contOnTestError="false" contOnTestFail="true" fileIOCapture="compat"/>`,
    `  <runner:testCase moduleName="${xmlAttribute(moduleName)}">`,
  ];

  for (const test of tests) {
    lines.push(
      [
        `    <test name="${xmlAttribute(testName(test))}"`,
        `entry="${xmlAttribute(entryName(test))}"`,
        `type="BTCH"`,
        `init="BZU_INIT"`,
        `term="BZU_TERM"`,
        `program="${xmlAttribute(programName)}"`,
        `skipTest="false"`,
        `resetFile="true"`,
        `stubCall="true"`,
        `dummy="false"`,
        // Inferred, and the only inferred value in the file: nothing public
        // carries `noPlaybackData="true"`, and a case that supplies its data in
        // the driver has none to play back. `docs/divergences.md` records the
        // fallback if a runner refuses it.
        `noPlaybackData="true"/>`,
      ].join(" "),
    );
  }

  lines.push(`  </runner:testCase>`);
  lines.push(
    `  <runner:intercept module="${xmlAttribute(programName)}" stub="false" lengths="${parmFields.length > 0 ? parmLength + 2 : ""}"${parmFields.length > 0 ? ` parmtype="I"` : ""} retcode="true" exist="false"/>`,
  );
  for (const runtimeInterface of stubbed) {
    lines.push(
      `  <runner:intercept module="${xmlAttribute(runtimeInterface.module)}" stub="true" lengths="${interfaceBytes(runtimeInterface)}" parmtype="I" retcode="false" exist="false"/>`,
    );
  }
  lines.push(`  <runner:playback moduleName="${xmlAttribute(programName)}"/>`);
  lines.push(`  <runner:fileAttributes hlqDdName="AZUHLQ"/>`);
  lines.push(`</runner:RunnerConfiguration>`);
  return `${lines.join("\n")}\n`;
}

function interfaceBytes(runtimeInterface: RuntimeInterface): number {
  return runtimeInterface.fields.reduce((sum, field) => sum + field.bytes, 0);
}

function testName(test: IRTest): string {
  return test.name.toUpperCase();
}

function entryName(test: IRTest): string {
  return `TEST_${testName(test)}`;
}

/** `1 CALL`, `2 CALLS` — a count read by whoever the failure lands on. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "S"}`;
}

/** A literal's own text, for a message rather than for a comparison. */
function literalText(literal: IRTestLiteral): string {
  return literal.kind === "decimal" ? literal.text : literal.value;
}

/** A COBOL alphanumeric literal, with an embedded apostrophe doubled. */
function cobolText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A number, written with a full stop whatever the program under test uses.
 *
 * The driver is its own compilation unit with its own SPECIAL-NAMES, and it has
 * none: `DECIMAL-POINT IS COMMA` in the program being tested does not reach it.
 * Writing the program's convention here would put a comma in a literal the
 * driver's own compilation reads as a separator.
 */
function cobolNumber(literal: IRTestLiteral): string {
  return literal.kind === "decimal" ? literal.text : cobolText(literal.value);
}

function renderDriver(
  program: IRProgram,
  moduleName: string,
  programName: string,
  stubbed: readonly RuntimeInterface[],
  parmFields: BatchParmField[],
): string {
  const lines: string[] = [];
  const addLine = (line = "") => {
    lines.push(...toReferenceFormat(line));
  };

  // The PROCESS statement goes before the IDENTIFICATION DIVISION header and
  // before any comment line, so it is the first thing in the file.
  addLine(`       PROCESS ${PROCESS_OPTIONS}`);
  addLine(`      *> Generated by bankc.`);
  addLine(`      *> Do not edit this file directly.`);
  addLine(`      *> zUnit test case ${moduleName} for ${programName}.`);
  // The base name, as the program's own prologue records it: a comment cannot
  // be continued, and an absolute path is both longer than the margin and
  // different on every machine that builds it.
  addLine(`      *> Source: ${program.sourceFile.split(/[/\\]/).pop()}`);
  addLine(`      *>`);
  addLine(
    `      *> Run it with the job in ${moduleName}.jcl. The program under`,
  );
  addLine(
    `      *> test has to be compiled with TEST and be in BZULOD, or the`,
  );
  addLine(`      *> runner has nothing to intercept.`);

  for (const test of program.tests) {
    emitTestProgram(test, programName, stubbed, parmFields, addLine);
  }

  emitProgramCallback(programName, parmFields, addLine);
  emitInitProgram(programName, program.tests, addLine);
  emitTermProgram(addLine);
  for (const runtimeInterface of stubbed) {
    emitStubProgram(runtimeInterface, program.tests, stubbed, addLine);
  }
  if (stubbed.length > 0) {
    emitCounterProgram(stubbed.length, addLine);
  }

  return `${lines.join("\n")}\n`;
}

/** The storage every generated program needs to raise an assertion. */
function emitAssertionStorage(addLine: (line?: string) => void): void {
  addLine(`       01  BZ-ASSERT.`);
  addLine(`           05  MESSAGE-LEN          PIC S9(4) COMP-4 VALUE 1.`);
  addLine(`           05  MESSAGE-TXT          PIC X(254) VALUE SPACES.`);
  addLine(
    `       01  BZ-P1                    PIC S9(9) COMP-4 VALUE ${ASSERT_SEVERITY}.`,
  );
  addLine(
    `       01  BZ-P2                    PIC S9(9) COMP-4 VALUE ${ASSERT_MESSAGE_NUMBER}.`,
  );
  addLine(
    `       01  BZ-P3                    PIC X(3) VALUE ${cobolText(ASSERT_PREFIX)}.`,
  );
  addLine(`       01  BZUASSRT                 PIC X(8) VALUE 'BZUASSRT'.`);
}

/** The paragraph that reports one, which is IBM's `THROW-ASSERTION-M`. */
function emitThrowAssertion(addLine: (line?: string) => void): void {
  addLine(`       THROW-ASSERTION.`);
  addLine(
    `           DISPLAY 'AZU2001W THE TEST "' AZ-TEST(1:AZ-TEST-LEN) '" FAILED DUE TO AN ASSERTION.'`,
  );
  addLine(
    `           DISPLAY 'AZU1101I ' MESSAGE-TXT OF BZ-ASSERT(1:MESSAGE-LEN OF BZ-ASSERT)`,
  );
  addLine(`           CALL BZUASSRT USING BZ-P1 BZ-P2 BZ-P3 BZ-ASSERT`);
  addLine(`           EXIT.`);
}

/**
 * Opens a message, which is a length and text the assertion call carries.
 *
 * `MESSAGE-LEN` is a pointer into `MESSAGE-TXT` while the message is being
 * built and its length once it is built, which is what the trailing
 * `SUBTRACT 1` is for.
 */
function emitMessage(
  parts: string[],
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(`${indent}MOVE 1 TO MESSAGE-LEN OF BZ-ASSERT`);
  addLine(`${indent}MOVE SPACES TO MESSAGE-TXT OF BZ-ASSERT`);
  addLine(`${indent}STRING ${parts.join(" ")}`);
  addLine(`${indent}    DELIMITED BY SIZE INTO MESSAGE-TXT OF BZ-ASSERT`);
  addLine(`${indent}    WITH POINTER MESSAGE-LEN OF BZ-ASSERT`);
  addLine(`${indent}END-STRING`);
  addLine(`${indent}SUBTRACT 1 FROM MESSAGE-LEN OF BZ-ASSERT`);
  addLine(`${indent}PERFORM THROW-ASSERTION`);
}

/** The PARM group, declared in whichever program has to hold or read one. */
function emitParmGroup(
  parmFields: BatchParmField[],
  level: number,
  addLine: (line?: string) => void,
): void {
  const indent = " ".repeat(7);
  addLine(`${indent}${String(level).padStart(2, "0")}  BANK-PARM.`);
  addLine(
    `${indent}    ${String(level + 4).padStart(2, "0")}  BANK-PARM-LENGTH     PIC S9(4) COMP.`,
  );
  addLine(
    `${indent}    ${String(level + 4).padStart(2, "0")}  BANK-PARM-DATA.`,
  );
  for (const field of parmFields) {
    addLine(
      `${indent}        ${String(level + 9).padStart(2, "0")}  ${field.name.padEnd(24)} ${field.picture}.`,
    );
  }
}

function emitInterfaceGroup(
  runtimeInterface: RuntimeInterface,
  addLine: (line?: string) => void,
): void {
  addLine(`       01  ${runtimeInterface.group}.`);
  for (const field of runtimeInterface.fields) {
    addLine(`           05  ${field.name.padEnd(24)} ${field.picture}.`);
  }
}

/** The counter each stubbed module's calls are tallied in. */
function counterIndex(
  stubbed: readonly RuntimeInterface[],
  module: string,
): number {
  return stubbed.findIndex((entry) => entry.module === module) + 1;
}

function emitCounterFetch(
  index: number,
  target: string,
  addLine: (line?: string) => void,
  indent: string,
): void {
  addLine(`${indent}MOVE ${index} TO AZ-GRP-INDEX`);
  addLine(`${indent}MOVE 0 TO AZ-FLAG-IN`);
  // A CALL sets RETURN-CODE, and the entry's own return code is what the
  // runner reads, so it is put back afterwards.
  addLine(`${indent}MOVE RETURN-CODE TO AZ-RC-WORK`);
  addLine(`${indent}CALL 'GTMEMRC' USING TC-WORK-AREA OF AZ-INFO-BLOCK`);
  addLine(`${indent}    AZ-GRP-INDEX AZ-FLAG-IN AZ-RECORD-PTR`);
  addLine(`${indent}SET ADDRESS OF ${target} TO AZ-RECORD-PTR`);
  addLine(`${indent}MOVE AZ-RC-WORK TO RETURN-CODE`);
}

function emitTestProgram(
  test: IRTest,
  programName: string,
  stubbed: readonly RuntimeInterface[],
  parmFields: BatchParmField[],
  addLine: (line?: string) => void,
): void {
  const entry = entryName(test);
  const parmLength = parmFields.reduce((sum, field) => sum + field.width, 0);

  addLine(`      *>`);
  addLine(`      *> ${entry}: the driver for test ${testName(test)}.`);
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${cobolText(entry)}.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       WORKING-STORAGE SECTION.`);
  addLine(
    `       01  PROGRAM-NAME             PIC X(8) VALUE ${cobolText(programName)}.`,
  );
  addLine(`       01  AZ-CSECT                 PIC X(72) VALUE SPACES.`);
  emitAssertionStorage(addLine);
  addLine(`       01  BZUGETEP                 PIC X(8) VALUE 'BZUGETEP'.`);
  addLine(`       01  AZ-EP-PTR                USAGE IS POINTER.`);
  addLine(`       01  AZ-TEST-LEN              PIC S9(9) COMP-5.`);
  if (stubbed.length > 0) {
    addLine(`       01  AZ-GRP-INDEX             PIC 9(8).`);
    addLine(`       01  AZ-FLAG-IN               PIC 9(1).`);
    addLine(`       01  AZ-RECORD-PTR            USAGE IS POINTER.`);
    addLine(`       01  AZ-RC-WORK               PIC S9(4) USAGE BINARY.`);
    addLine(`       01  AZ-COUNT-SHOW            PIC Z(4)9.`);
  }
  if (parmFields.length > 0) {
    emitParmGroup(parmFields, 1, addLine);
  }
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TEST                  PIC X(80).`);
  addLine(`       01  AZ-ARG-LIST.`);
  addLine(`           05  ARG-LENGTH           PIC 9(4) COMP-4.`);
  addLine(`           05  ARG-DATA             PIC X(256).`);
  addLine(`       01  AZ-INFO-BLOCK.`);
  addLine(`           COPY EQAITERC.`);
  addLine(`       01  AZ-PROC-PTR              USAGE IS PROCEDURE-POINTER.`);
  if (stubbed.length > 0) {
    addLine(`       01  AZ-CALL-COUNT            PIC 9(5) COMP-5.`);
  }
  addLine(`       PROCEDURE DIVISION USING AZ-TEST AZ-ARG-LIST AZ-INFO-BLOCK.`);
  addLine(`           DISPLAY 'AZU0000I ${entry} STARTED...'`);
  addLine(`           MOVE 0 TO AZ-TEST-LEN`);
  addLine(`           INSPECT AZ-TEST TALLYING AZ-TEST-LEN FOR`);
  addLine(`               CHARACTERS BEFORE INITIAL SPACE`);
  // A name of all spaces tallies zero, and `AZ-TEST(1:0)` is a reference
  // modification of no characters — which SSRANGE abends on and which is
  // undefined without it. One character is a space, so every comparison below
  // falls to its WHEN OTHER, which is the right answer for a test with no name.
  addLine(`           IF AZ-TEST-LEN = 0`);
  addLine(`               MOVE 1 TO AZ-TEST-LEN`);
  addLine(`           END-IF`);

  if (stubbed.length > 0) {
    // The counters are zeroed here rather than trusted to arrive that way: the
    // area comes from BZUGTMEM, and nothing documents what is in it.
    addLine(`      *> Start the call counters from zero.`);
    for (const runtimeInterface of stubbed) {
      emitCounterFetch(
        counterIndex(stubbed, runtimeInterface.module),
        "AZ-CALL-COUNT",
        addLine,
        "           ",
      );
      addLine(`           MOVE 0 TO AZ-CALL-COUNT`);
    }
  }

  if (parmFields.length > 0) {
    addLine(`      *> The PARM the step is started with.`);
    addLine(`           INITIALIZE BANK-PARM`);
    addLine(`           MOVE ${parmLength} TO BANK-PARM-LENGTH`);
    for (const given of test.givens) {
      const field = parmFields.find(
        (entry) => entry.source === given.parameter,
      );
      if (!field) {
        continue;
      }
      addLine(`           MOVE ${cobolNumber(given.value)} TO ${field.name}`);
    }
  }

  addLine(`      *> Enter the program under test.`);
  addLine(`           DISPLAY 'AZU0000I CALL ${programName}'`);
  addLine(`           CALL BZUGETEP USING BY REFERENCE PROGRAM-NAME AZ-CSECT`);
  addLine(`               RETURNING AZ-EP-PTR`);
  addLine(`           IF AZ-EP-PTR = NULL`);
  emitMessage(
    [cobolText("UNABLE TO GET THE ENTRY POINT BY BZUGETEP.")],
    addLine,
    "               ",
  );
  addLine(`               GOBACK`);
  addLine(`           END-IF`);
  addLine(`           SET ADDRESS OF AZ-PROC-PTR TO AZ-EP-PTR`);
  addLine(
    parmFields.length > 0
      ? `           CALL AZ-PROC-PTR USING BANK-PARM`
      : `           CALL AZ-PROC-PTR`,
  );
  addLine(`           MOVE 0 TO RETURN-CODE`);

  if (stubbed.length > 0) {
    addLine(`      *> Every call the test expects has to have arrived.`);
    for (const runtimeInterface of stubbed) {
      addLine(`           PERFORM CHECK-${runtimeInterface.module}-CALLS`);
    }
  }

  addLine(`           DISPLAY 'AZU0000I ${entry} END.'`);
  addLine(`           GOBACK.`);

  for (const runtimeInterface of stubbed) {
    const expected = test.expectations.filter(
      (expectation) =>
        expectedModule(expectation.kind) === runtimeInterface.module,
    ).length;
    addLine(`       CHECK-${runtimeInterface.module}-CALLS.`);
    emitCounterFetch(
      counterIndex(stubbed, runtimeInterface.module),
      "AZ-CALL-COUNT",
      addLine,
      "           ",
    );
    addLine(`           IF AZ-CALL-COUNT NOT EQUAL ${expected}`);
    addLine(`               MOVE AZ-CALL-COUNT TO AZ-COUNT-SHOW`);
    emitMessage(
      [
        cobolText(
          `EXPECTED ${plural(expected, "CALL")} TO ${runtimeInterface.module}, GOT`,
        ),
        `AZ-COUNT-SHOW`,
      ],
      addLine,
      "               ",
    );
    addLine(`           END-IF`);
    addLine(`           EXIT.`);
  }

  emitThrowAssertion(addLine);
  addLine(`       END PROGRAM ${cobolText(entry)}.`);
}

/**
 * `BZU_TEST`, the callback for the program under test itself.
 *
 * The configuration carries a `runner:intercept` for that program, and the
 * runner calls these two entries around it. There is nothing for them to do
 * here — the PARM is built by the driver and the results are checked through
 * the stubs — but a named entry point the runner calls and cannot find is a
 * failed run, so both are written.
 */
function emitProgramCallback(
  programName: string,
  parmFields: BatchParmField[],
  addLine: (line?: string) => void,
): void {
  const using =
    parmFields.length > 0
      ? `AZ-TEST AZ-INFO-BLOCK BANK-PARM`
      : `AZ-TEST AZ-INFO-BLOCK`;
  addLine(`      *>`);
  addLine(
    `      *> BZU_TEST: the runner's callback for ${programName} itself.`,
  );
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. 'BZU_TEST'.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TEST                  PIC X(80).`);
  addLine(`       01  AZ-INFO-BLOCK.`);
  addLine(`           COPY EQAITERC.`);
  if (parmFields.length > 0) {
    emitParmGroup(parmFields, 1, addLine);
  }
  addLine(`       PROCEDURE DIVISION.`);
  addLine(`       PGM-INPT.`);
  addLine(`           ENTRY 'PGM_INPT_${programName}' USING ${using}`);
  addLine(`           DISPLAY 'AZU0000I PGM_INPT_${programName}'`);
  addLine(`           MOVE 0 TO RETURN-CODE`);
  addLine(`           GOBACK.`);
  addLine(`       PGM-OUTP.`);
  addLine(`           ENTRY 'PGM_OUTP_${programName}' USING ${using}`);
  addLine(`           DISPLAY 'AZU0000I PGM_OUTP_${programName}'`);
  addLine(`           MOVE 4 TO RETURN-CODE`);
  addLine(`           GOBACK.`);
  addLine(`       END PROGRAM 'BZU_TEST'.`);
}

/** `BZU_INIT`, which answers with the identity the configuration carries. */
function emitInitProgram(
  programName: string,
  tests: IRTest[],
  addLine: (line?: string) => void,
): void {
  addLine(`      *>`);
  addLine(`      *> BZU_INIT: run before each test.`);
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. 'BZU_INIT'.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       WORKING-STORAGE SECTION.`);
  addLine(`       01  AZ-TEST-LEN              PIC S9(9) COMP-5.`);
  addLine(`       01  AZ-TESTCASE-ID           PIC X(36)`);
  addLine(`           VALUE ${cobolText(testCaseId(programName, tests))}.`);
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TEST                  PIC X(80).`);
  addLine(`       01  AZ-TEST-ID               PIC X(80).`);
  addLine(`       01  AZ-INFO-BLOCK.`);
  addLine(`           COPY EQAITERC.`);
  addLine(`       PROCEDURE DIVISION USING AZ-TEST AZ-TEST-ID AZ-INFO-BLOCK.`);
  addLine(`           MOVE 0 TO AZ-TEST-LEN`);
  addLine(`           INSPECT AZ-TEST TALLYING AZ-TEST-LEN FOR`);
  addLine(`               CHARACTERS BEFORE INITIAL SPACE`);
  // A name of all spaces tallies zero, and `AZ-TEST(1:0)` is a reference
  // modification of no characters — which SSRANGE abends on and which is
  // undefined without it. One character is a space, so every comparison below
  // falls to its WHEN OTHER, which is the right answer for a test with no name.
  addLine(`           IF AZ-TEST-LEN = 0`);
  addLine(`               MOVE 1 TO AZ-TEST-LEN`);
  addLine(`           END-IF`);
  addLine(`           DISPLAY 'AZU0000I BZU_INIT: ' AZ-TEST(1:AZ-TEST-LEN)`);
  addLine(`           MOVE AZ-TESTCASE-ID TO AZ-TEST-ID`);
  addLine(`           GOBACK.`);
  addLine(`       END PROGRAM 'BZU_INIT'.`);
}

function emitTermProgram(addLine: (line?: string) => void): void {
  addLine(`      *>`);
  addLine(`      *> BZU_TERM: run after each test.`);
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. 'BZU_TERM'.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       WORKING-STORAGE SECTION.`);
  addLine(`       01  AZ-TEST-LEN              PIC S9(9) COMP-5.`);
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TEST                  PIC X(80).`);
  addLine(`       01  AZ-INFO-BLOCK.`);
  addLine(`           COPY EQAITERC.`);
  addLine(`       PROCEDURE DIVISION USING AZ-TEST AZ-INFO-BLOCK.`);
  addLine(`           MOVE 0 TO AZ-TEST-LEN`);
  addLine(`           INSPECT AZ-TEST TALLYING AZ-TEST-LEN FOR`);
  addLine(`               CHARACTERS BEFORE INITIAL SPACE`);
  // A name of all spaces tallies zero, and `AZ-TEST(1:0)` is a reference
  // modification of no characters — which SSRANGE abends on and which is
  // undefined without it. One character is a space, so every comparison below
  // falls to its WHEN OTHER, which is the right answer for a test with no name.
  addLine(`           IF AZ-TEST-LEN = 0`);
  addLine(`               MOVE 1 TO AZ-TEST-LEN`);
  addLine(`           END-IF`);
  addLine(`           DISPLAY 'AZU0000I BZU_TERM: ' AZ-TEST(1:AZ-TEST-LEN)`);
  addLine(`           GOBACK.`);
  addLine(`       END PROGRAM 'BZU_TERM'.`);
}

/**
 * The stub for one called module: it counts the call and checks its arguments.
 *
 * `PGM_INPT_<module>` is what the module was called with, which is what a test
 * is about. `PGM_OUTP_<module>` is what the stub answers with, and neither
 * `BANKLEDG` nor `BANKAUDT` answers with anything, so it only sets the return
 * code the runner reads.
 */
function emitStubProgram(
  runtimeInterface: RuntimeInterface,
  tests: IRTest[],
  stubbed: readonly RuntimeInterface[],
  addLine: (line?: string) => void,
): void {
  const module = runtimeInterface.module;
  const index = counterIndex(stubbed, module);
  const using = `AZ-TEST AZ-INFO-BLOCK ${runtimeInterface.group}`;

  addLine(`      *>`);
  addLine(`      *> PGM_${module}: the stub the program's calls arrive at.`);
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. ${cobolText(`PGM_${module}`)}.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       WORKING-STORAGE SECTION.`);
  emitAssertionStorage(addLine);
  addLine(`       01  AZ-TEST-LEN              PIC S9(9) COMP-5.`);
  addLine(`       01  AZ-GRP-INDEX             PIC 9(8).`);
  addLine(`       01  AZ-FLAG-IN               PIC 9(1).`);
  addLine(`       01  AZ-RECORD-PTR            USAGE IS POINTER.`);
  addLine(`       01  AZ-RC-WORK               PIC S9(4) USAGE BINARY.`);
  addLine(`       01  AZ-CALL-NUMBER           PIC 9(5) COMP-5.`);
  addLine(`       01  AZ-COUNT-SHOW            PIC Z(4)9.`);
  if (module === "BANKLEDG") {
    addLine(`       01  AZ-AMOUNT-SHOW           PIC -(16)9.99.`);
  }
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TEST                  PIC X(80).`);
  addLine(`       01  AZ-INFO-BLOCK.`);
  addLine(`           COPY EQAITERC.`);
  emitInterfaceGroup(runtimeInterface, addLine);
  addLine(`       01  AZ-CALL-COUNT            PIC 9(5) COMP-5.`);
  addLine(`       PROCEDURE DIVISION.`);
  addLine(`       PGM-INPT.`);
  addLine(`           ENTRY 'PGM_INPT_${module}' USING ${using}`);
  addLine(`           MOVE 4 TO RETURN-CODE`);
  addLine(`           MOVE 0 TO AZ-TEST-LEN`);
  addLine(`           INSPECT AZ-TEST TALLYING AZ-TEST-LEN FOR`);
  addLine(`               CHARACTERS BEFORE INITIAL SPACE`);
  // A name of all spaces tallies zero, and `AZ-TEST(1:0)` is a reference
  // modification of no characters — which SSRANGE abends on and which is
  // undefined without it. One character is a space, so every comparison below
  // falls to its WHEN OTHER, which is the right answer for a test with no name.
  addLine(`           IF AZ-TEST-LEN = 0`);
  addLine(`               MOVE 1 TO AZ-TEST-LEN`);
  addLine(`           END-IF`);
  emitCounterFetch(index, "AZ-CALL-COUNT", addLine, "           ");
  addLine(`           ADD 1 TO AZ-CALL-COUNT`);
  addLine(`           MOVE AZ-CALL-COUNT TO AZ-CALL-NUMBER`);
  addLine(`           EVALUATE AZ-TEST(1:AZ-TEST-LEN)`);
  for (const test of tests) {
    const expectations = test.expectations.filter(
      (expectation) => expectedModule(expectation.kind) === module,
    );
    if (expectations.length === 0) {
      continue;
    }
    addLine(`           WHEN ${cobolText(testName(test))}`);
    addLine(`               PERFORM CHECK-${testName(test)}`);
  }
  addLine(`           WHEN OTHER`);
  addLine(`               CONTINUE`);
  addLine(`           END-EVALUATE`);
  addLine(`           GOBACK.`);
  addLine(`       PGM-OUTP.`);
  addLine(`           ENTRY 'PGM_OUTP_${module}' USING ${using}`);
  addLine(`           MOVE 0 TO RETURN-CODE`);
  addLine(`           GOBACK.`);

  for (const test of tests) {
    const expectations = test.expectations.filter(
      (expectation) => expectedModule(expectation.kind) === module,
    );
    if (expectations.length === 0) {
      continue;
    }
    addLine(`       CHECK-${testName(test)}.`);
    addLine(`           EVALUATE AZ-CALL-NUMBER`);
    expectations.forEach((expectation, position) => {
      addLine(`           WHEN ${position + 1}`);
      if (expectation.kind === "ledger") {
        const operation =
          expectation.operation === "debit" ? "DEBIT" : "CREDIT";
        addLine(
          `               IF BANK-LEDGER-OPERATION = ${cobolText(operation)}`,
        );
        addLine(
          `                   AND BANK-LEDGER-ACCOUNT = ${cobolNumber(expectation.account)}`,
        );
        addLine(
          `                   AND BANK-LEDGER-AMOUNT = ${cobolNumber(expectation.amount)}`,
        );
        addLine(`                   CONTINUE`);
        addLine(`               ELSE`);
        addLine(`                   MOVE BANK-LEDGER-AMOUNT TO AZ-AMOUNT-SHOW`);
        emitMessage(
          [
            cobolText(
              `BANKLEDG CALL ${position + 1} EXPECTED ${operation} ${literalText(expectation.account)} ${literalText(expectation.amount)}, GOT`,
            ),
            `BANK-LEDGER-OPERATION`,
            cobolText(" "),
            `BANK-LEDGER-ACCOUNT`,
            cobolText(" "),
            `AZ-AMOUNT-SHOW`,
          ],
          addLine,
          "                   ",
        );
        addLine(`               END-IF`);
        return;
      }
      addLine(
        `               IF BANK-AUDIT-EVENT = ${cobolNumber(expectation.event)}`,
      );
      addLine(
        `                   AND BANK-AUDIT-CORRELATION = ${cobolNumber(expectation.correlation)}`,
      );
      addLine(`                   CONTINUE`);
      addLine(`               ELSE`);
      emitMessage(
        [
          cobolText(
            `BANKAUDT CALL ${position + 1} EXPECTED ${literalText(expectation.event)} ${literalText(expectation.correlation)}, GOT`,
          ),
          `BANK-AUDIT-EVENT`,
          cobolText(" "),
          `BANK-AUDIT-CORRELATION`,
        ],
        addLine,
        "                   ",
      );
      addLine(`               END-IF`);
    });
    addLine(`           WHEN OTHER`);
    addLine(`               MOVE AZ-CALL-NUMBER TO AZ-COUNT-SHOW`);
    emitMessage(
      [
        cobolText(
          `MORE THAN ${plural(expectations.length, "CALL")} TO ${module}, AT CALL`,
        ),
        `AZ-COUNT-SHOW`,
      ],
      addLine,
      "               ",
    );
    addLine(`           END-EVALUATE`);
    addLine(`           EXIT.`);
  }

  emitThrowAssertion(addLine);
  addLine(`       END PROGRAM ${cobolText(`PGM_${module}`)}.`);
}

/**
 * `GTMEMRC`, which hands out one counter per stubbed module.
 *
 * A stub and the driver are separate programs, so a count kept in either one's
 * storage is invisible to the other. IBM's generator solves it by asking
 * `BZUGTMEM` for an area once and keeping the address in the info block's work
 * area, which every program in the case is passed; this is that, sized by the
 * number of modules being stubbed rather than by IBM's fixed three.
 */
function emitCounterProgram(
  groups: number,
  addLine: (line?: string) => void,
): void {
  addLine(`      *>`);
  addLine(
    `      *> GTMEMRC: the call counters, in storage every program sees.`,
  );
  addLine(`       IDENTIFICATION DIVISION.`);
  addLine(`       PROGRAM-ID. 'GTMEMRC'.`);
  addLine(`       DATA DIVISION.`);
  addLine(`       WORKING-STORAGE SECTION.`);
  addLine(`       01  BZUGTMEM                 PIC X(8) VALUE 'BZUGTMEM'.`);
  addLine(`       01  DATA-SIZE                PIC 9(8) COMP-4.`);
  addLine(`       LINKAGE SECTION.`);
  addLine(`       01  AZ-TC-WORK-AREA          PIC X(256).`);
  addLine(`       01  AZ-GRP-INDEX             PIC 9(8).`);
  addLine(`       01  AZ-FLAG-IN               PIC 9(1).`);
  addLine(`       01  AZ-RECORD-PTR            USAGE IS POINTER.`);
  addLine(`       01  AZ-RECORD-PTR-VALUE`);
  addLine(`           REDEFINES AZ-RECORD-PTR  PIC S9(9) COMP-5.`);
  addLine(`       01  DATA-PTR                 USAGE IS POINTER.`);
  addLine(`       01  DATA-PTR-VALUE`);
  addLine(`           REDEFINES DATA-PTR       PIC S9(9) COMP-5.`);
  addLine(`       01  DATA-AREA.`);
  addLine(`           05  RECORD-COUNT-IO OCCURS ${groups}.`);
  addLine(`               10  RECORD-COUNT-OT  PIC 9(5) COMP-5.`);
  addLine(`               10  RECORD-COUNT-IN  PIC 9(5) COMP-5.`);
  addLine(`       01  WK-RECORD-COUNT          PIC 9(5) COMP-5.`);
  addLine(
    `       PROCEDURE DIVISION USING AZ-TC-WORK-AREA AZ-GRP-INDEX AZ-FLAG-IN`,
  );
  addLine(`           AZ-RECORD-PTR.`);
  addLine(`       MAINPROC.`);
  addLine(`           SET ADDRESS OF DATA-PTR TO ADDRESS OF AZ-TC-WORK-AREA`);
  addLine(`           IF DATA-PTR-VALUE = 0`);
  addLine(
    `               COMPUTE DATA-SIZE = LENGTH OF WK-RECORD-COUNT * 2 * ${groups}`,
  );
  addLine(`               CALL BZUGTMEM USING DATA-SIZE RETURNING DATA-PTR`);
  addLine(`               SET ADDRESS OF DATA-AREA TO DATA-PTR`);
  addLine(`           END-IF`);
  addLine(`           SET AZ-RECORD-PTR TO DATA-PTR`);
  addLine(`           COMPUTE AZ-RECORD-PTR-VALUE = AZ-RECORD-PTR-VALUE +`);
  addLine(`               LENGTH OF WK-RECORD-COUNT * 2 * (AZ-GRP-INDEX - 1)`);
  addLine(`           IF AZ-FLAG-IN = 1`);
  addLine(
    `               ADD LENGTH OF WK-RECORD-COUNT TO AZ-RECORD-PTR-VALUE`,
  );
  addLine(`           END-IF`);
  addLine(`           SET ADDRESS OF WK-RECORD-COUNT TO AZ-RECORD-PTR`);
  addLine(`           GOBACK.`);
  addLine(`       END PROGRAM 'GTMEMRC'.`);
}

/**
 * The job: compile the test case program, then hand it to the runner.
 *
 * `EQAPPLAY` is the cataloged procedure the runner is submitted through — the
 * name observed in a working pipeline, where the older documentation says
 * `BZUPPLAY`. `PRM='STOP=E,REPORT=XML'` is the parameter that pipeline passes:
 * stop on error, and write the report as XML so something other than a person
 * can read it.
 */
function renderJcl(
  program: IRProgram,
  moduleName: string,
  programName: string,
  hlq: string,
): string {
  const lines: string[] = [];
  const add = (line: string) => {
    lines.push(...toJclStatement(line));
  };

  add(`//* Generated by bankc.`);
  add(`//* Do not edit this file directly.`);
  add(
    `//${moduleName.padEnd(8)} JOB (BANKLANG),'ZUNIT ${programName}',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID`,
  );
  add(`//* zUnit test case for ${programName}.`);
  add(`//* Source: ${program.sourceFile}`);
  add(`//*`);
  add(`//* The program under test has to be in the load library below and`);
  add(`//* to have been compiled with TEST. That is what the runner`);
  add(`//* intercepts its calls through: a program compiled without it`);
  add(`//* runs, and calls the real BANKLEDG and BANKAUDT.`);
  add(`//*`);
  add(`//* The compiler options are in the driver's PROCESS statement,`);
  add(`//* which is what Enterprise COBOL reads them from and what`);
  add(`//* overrides anything a site's procedure passes.`);
  add(`//*`);
  add(`//* Dataset names, unit and space parameters and the procedure`);
  add(`//* library are placeholders for an installation's standards.`);
  add(`//   JCLLIB ORDER=(${hlq}.TAZ.PROCLIB)`);
  add(`//COMPILE  EXEC IGYWCL`);
  add(`//COBOL.SYSIN DD DISP=SHR,DSN=${hlq}.ZUNIT.COBOL(${moduleName})`);
  add(`//LKED.SYSLMOD DD DISP=SHR,DSN=${hlq}.TEST.LOADLIB(${moduleName})`);
  add(`//RUNNER   EXEC PROC=EQAPPLAY,COND=(4,LT),`);
  add(`//         BZUCFG=${hlq}.ZUNIT.BZUCFG(${moduleName}),`);
  add(`//         BZUCBK=${hlq}.TEST.LOADLIB,`);
  add(`//         BZULOD=${hlq}.TEST.LOADLIB,`);
  add(`//         PRM='STOP=E,REPORT=XML'`);
  add(`//REPLAY.BZURPT DD DISP=SHR,DSN=${hlq}.ZUNIT.BZURES(${moduleName})`);
  add(`//REPLAY.SYSOUT DD SYSOUT=*`);
  add(`//REPLAY.CEEDUMP DD SYSOUT=*`);
  return `${lines.join("\n")}\n`;
}
