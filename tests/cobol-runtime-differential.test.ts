import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CobolUnsupportedError } from "../packages/cobol-runtime/src/index";
import { batchParmFields } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import {
  cursorRowsOf,
  inputsFor,
  parmText,
} from "../packages/playground/src/inputs";
import { sqlOutcomesFor, sqlRowRecords } from "../packages/playground/src/run";
import { precompile } from "../packages/precompiler/src/index";
import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
  type ConformanceRun,
  type SqlOutcome,
} from "../tools/conformance";
import {
  differentialProjects,
  generatedCobol,
  NOT_INTERPRETED,
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "../tools/interpret";

/**
 * The interpreter against a real COBOL compiler, over the whole example corpus.
 *
 * `packages/cobol-runtime` exists so the playground can run what it compiles.
 * On its own that is a second implementation of this project's semantics
 * written by the same hand as the first, which is worth exactly nothing as
 * evidence, since a shared misreading of the Language Reference would agree with
 * itself perfectly.
 *
 * So every program is run twice: once compiled by `cobc` and executed as a
 * native binary against `runtime/`, and once interpreted. Then the two are
 * compared on everything a reader of the playground would look at: the return
 * code, what the program displayed, the ledger journal, the closing balances,
 * and the audit log. A difference in any of them fails here.
 *
 * **Skips without `cobc`.** A skipped run means unchecked, not passing; the CI
 * job builds GnuCOBOL 3.2 precisely so this lane runs there.
 */

const AVAILABLE = hasCobc();

interface Comparison {
  project: string;
  compiled: ConformanceRun;
  interpreted: ConformanceRun;
}

/** The PARM the Input tab holds for this program, as a job step passes it. */
function panelParm(source: string, sourceFile: string): string {
  const result = compile(source, { sourceFile });
  if (!result.program || !result.layout) {
    return "";
  }
  const surface = inputsFor(result.program, result.layout).surfaces.find(
    (each) => each.kind === "parm",
  );
  return surface ? parmText(surface) : "";
}

/**
 * The cursor script the Input tab holds, for `cobc` as well as the interpreter.
 *
 * Unscripted, `runtime/DSNHLI.cbl` succeeds every FETCH, so a cursor loop only
 * ends by reaching its own bound. Both sides did that and agreed on return code
 * 12, the same shape of empty agreement the empty PARM produced. Running the
 * panel's row count through both is what makes the browser's answer for
 * `branch-accrual-cursor` a checked one.
 */
function panelSql(
  source: string,
  sourceFile: string,
): { outcomes: SqlOutcome[]; rows: string[] } {
  const result = compile(source, { sourceFile });
  if (!result.program || !result.layout || !result.cobol) {
    return { outcomes: [], rows: [] };
  }
  const surfaces = inputsFor(result.program, result.layout).surfaces;
  const cursors = cursorRowsOf(surfaces, result.layout, result.program);
  const translated = precompile(result.cobol).cobol;
  const decoder = new TextDecoder();
  return {
    outcomes: sqlOutcomesFor(translated, cursors),
    rows: sqlRowRecords(translated, cursors).map((line) =>
      decoder.decode(line),
    ),
  };
}

function compare(project: string): Comparison {
  const source = readFileSync(join(project, "src/main.bank.ts"), "utf8");
  const sourceFile = `${project}/src/main.bank.ts`;
  const cobol = generatedCobol(source, sourceFile);

  // A program entered with a PARM needs something to supply one, exactly as a
  // job step does. Without it `cobc -x` refuses to build the program at all,
  // which is why no example taking entry parameters had ever been executed.
  //
  // The PARM is the playground's own, built by `packages/playground/src/inputs`
  // from the emitter's account of the parameter area. It used to be empty here,
  // which meant both sides failed the length check on the first statement and
  // agreed on return code 12, so the generated parsing was compared, but only
  // on the path that never reaches it. A real PARM puts the separate sign, the
  // numeric class test and every offset in the linkage group under `cobc` as
  // well, and makes what the Input tab writes the thing being checked.
  const options: ConformanceOptions = {
    source,
    sourceFile,
    workDir: join(tmpdir(), `banklang-diff-${project.replace(/\W+/g, "-")}`),
    driver: takesParm(cobol)
      ? parmDriver(programNameOf(cobol), panelParm(source, sourceFile))
      : undefined,
    ...(() => {
      const sql = panelSql(source, sourceFile);
      return { sqlOutcomes: sql.outcomes, sqlRows: sql.rows };
    })(),
  };
  return {
    project,
    compiled: runConformance(options),
    interpreted: runInterpreted(options),
  };
}

describe("the interpreter and GnuCOBOL, on the same program", () => {
  const projects = differentialProjects();

  it("has a corpus worth comparing", () => {
    expect(projects.length).toBeGreaterThan(15);
  });

  /**
   * The PARM lane, held open.
   *
   * Two runs that both refuse the PARM agree perfectly and check nothing, which
   * is what this lane did for every PARM-driven example until the Input panel
   * had a PARM to give it. The refusal is easy to fall back into: an empty
   * default, or a seed that stops matching the parameter list, and it fails
   * silently, by passing.
   *
   * Asserted on the interpreted side, which needs no `cobc`: the per-project
   * tests above already require the compiled side to print the same lines, so
   * a refusal here that GnuCOBOL did not also print would fail there instead.
   */
  it("runs PARM-driven programs on a PARM they accept", () => {
    let checked = 0;

    for (const project of projects) {
      const source = readFileSync(join(project, "src/main.bank.ts"), "utf8");
      const sourceFile = `${project}/src/main.bank.ts`;
      const cobol = generatedCobol(source, sourceFile);

      // `batchParmFields`, not `takesParm`. The lexical test is true of any
      // `PROCEDURE DIVISION USING`, and an IMS program's names its PCBs, so the
      // region passes those, not a job step, and there is no PARM to build.
      const program = compile(source, { sourceFile }).program;
      if (!program || batchParmFields(program).length === 0) {
        continue;
      }

      const parm = panelParm(source, sourceFile);
      expect(parm, `${project} is entered with a PARM and given none`).not.toBe(
        "",
      );

      const interpreted = runInterpreted({
        source,
        sourceFile,
        workDir: join(
          tmpdir(),
          `banklang-parm-${project.replace(/\W+/g, "-")}`,
        ),
        driver: parmDriver(programNameOf(cobol), parm),
      });
      expect(
        interpreted.stdout,
        `${project} refused the PARM the panel built`,
      ).not.toMatch(/BYTES, \d+ REQUIRED|NO PARM PASSED|IS NOT NUMERIC/);
      checked += 1;
    }

    expect(checked, "PARM-driven examples").toBeGreaterThanOrEqual(4);
  });

  /**
   * The cursor lane, held open for the same reason.
   *
   * An unscripted cursor ends by exhausting its own bound, which both sides do
   * identically: agreement that says nothing about whether end of data is
   * handled, because end of data never arrives. The script has to reach the
   * FETCH's statement number to do anything at all, and that number comes from
   * the precompiler; if the pattern that reads it back ever stops matching,
   * `sqlOutcomesFor` returns nothing and this silently reverts.
   */
  it("runs cursor programs to end of data, not to their bound", () => {
    let checked = 0;

    for (const project of projects) {
      const source = readFileSync(join(project, "src/main.bank.ts"), "utf8");
      const sourceFile = `${project}/src/main.bank.ts`;
      const program = compile(source, { sourceFile }).program;
      if (!program?.sql.some((each) => each.form === "cursor")) {
        continue;
      }

      const { outcomes, rows } = panelSql(source, sourceFile);
      expect(
        outcomes.filter((each) => each.sqlcode === 100),
        `${project} has a cursor no script ever ends`,
      ).not.toHaveLength(0);

      const interpreted = runInterpreted({
        source,
        sourceFile,
        workDir: join(
          tmpdir(),
          `banklang-cursor-${project.replace(/\W+/g, "-")}`,
        ),
        sqlOutcomes: outcomes,
        sqlRows: rows,
      });
      expect(
        interpreted.stdout,
        `${project} ran its cursor to the declared bound`,
      ).not.toMatch(/CURSOR LIMIT/);
      checked += 1;
    }

    expect(checked, "cursor examples").toBeGreaterThanOrEqual(1);
  });

  for (const project of projects) {
    it.skipIf(!AVAILABLE)(
      `${project} runs the same both ways`,
      () => {
        const { compiled, interpreted } = compare(project);

        // The return code first: it is what a job step reads, and a program
        // that ends 12 under one and 0 under the other is the difference that
        // matters most.
        expect(interpreted.exitCode, "RETURN-CODE").toBe(compiled.exitCode);

        // DISPLAY output, line for line. GnuCOBOL pads a DISPLAY of a group
        // item to its full length, so both sides are compared with trailing
        // blanks removed rather than with one side reformatted to match.
        expect(lines(interpreted.stdout), "DISPLAY output").toEqual(
          lines(compiled.stdout),
        );

        expect(interpreted.journal, "ledger journal").toEqual(compiled.journal);
        expect([...interpreted.balances].sort(), "closing balances").toEqual(
          [...compiled.balances].sort(),
        );
        expect(interpreted.auditLog, "audit log").toEqual(compiled.auditLog);
      },
      30_000,
    );
  }

  it.skipIf(!AVAILABLE)(
    "refuses what it cannot run, rather than running it wrongly",
    () => {
      // The exclusions, held to their reasons. If Report Writer is ever
      // implemented this fails and the list has to be revisited, which is the
      // point: an exclusion nobody re-checks becomes a permanent hole.
      const excluded = Object.keys(NOT_INTERPRETED);
      expect(excluded).toHaveLength(2);

      // Paths built from the shared list rather than written out again. A
      // literal here would also be the string `tools/evidence-grades.ts` reads
      // to decide which examples a test asserts on, and this one asserts the
      // opposite: that the program cannot be run at all.
      for (const project of excluded) {
        expect(
          () =>
            runInterpreted({
              source: readFileSync(join(project, "src/main.bank.ts"), "utf8"),
              sourceFile: `${project}/src/main.bank.ts`,
              workDir: join(tmpdir(), "banklang-diff-unused"),
            }),
          project,
        ).toThrow(CobolUnsupportedError);
      }
    },
    30_000,
  );
});

/** Output lines, with trailing blanks removed and the final newline dropped. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => index < all.length - 1 || line !== "");
}
