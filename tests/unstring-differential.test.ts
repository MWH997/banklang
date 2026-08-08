import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
} from "../tools/conformance";
import {
  generatedCobol,
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "../tools/interpret";

/**
 * `split`, executed by both engines and compared.
 *
 * The interpreter had no `UNSTRING` at all, which is how `task_func_02` came to
 * pass under `cobc` with no differential result: the compiled side ran, the
 * interpreted side refused the statement, and the comparison that gives this
 * project's green its meaning simply did not happen. A silent hole in the
 * second implementation is worse than a failing test, because it looks like
 * success.
 *
 * So these run the *same generated COBOL* through `cobc` and through
 * `packages/cobol-runtime` and require the same answer. The cases are the ones
 * where two implementations of UNSTRING plausibly disagree: where a field is
 * empty, where the delimiter is missing, where there are more fields than
 * receivers, and where there are fewer.
 *
 * **Skips without `cobc`.** A skipped run means unchecked, not passing.
 */

const SOURCE = `module SplitProbe;

record Line {
  lineText: string<30>;
}

record Parts {
  partOne: string<10>;
  partTwo: string<10>;
  partThree: string<10>;
}

file probeInput lineSequential input record Line status probeInputStatus;

file probeReport lineSequential output record Parts status probeReportStatus;

on error probeInput {
  log "PROBEINPUT FAILED ", probeInputStatus;
}

on error probeReport {
  log "PROBEREPORT FAILED ", probeReportStatus;
}

entry transaction splitLines(
  line: Line,
  parts: Parts,
  idempotencyKey: string<36>,
) {
  open probeInput;
  open probeReport;

  while probeInputStatus == "00" limit 1000 {
    read probeInput into line;

    if probeInputStatus == "00" {
      split line.lineText by "-" into parts.partOne, parts.partTwo, parts.partThree;
      write probeReport from parts;
    }
  }

  close probeReport;
  close probeInput;

  audit("SPLIT_PROBE", idempotencyKey);
}
`;

function options(input: string, workDir: string): ConformanceOptions {
  const cobol = generatedCobol(SOURCE, "probe.bank.ts");
  return {
    source: SOURCE,
    sourceFile: "probe.bank.ts",
    workDir,
    inputs: { PROBEINP: Buffer.from(input, "utf8") },
    outputs: ["PROBEREP"],
    driver: takesParm(cobol)
      ? parmDriver(programNameOf(cobol), "SPLIT".padEnd(36, "0"))
      : undefined,
  };
}

/** The same program, both ways, with the output file each produced. */
function both(input: string): { compiled: string; interpreted: string } {
  const workDir = mkdtempSync(join(tmpdir(), "banklang-unstring-"));
  try {
    const config = options(input, workDir);
    const compiled = runConformance(config);
    const interpreted = runInterpreted(config);
    return {
      compiled: (compiled.outputs.get("PROBEREP") ?? Buffer.alloc(0)).toString(
        "utf8",
      ),
      interpreted: (
        interpreted.outputs.get("PROBEREP") ?? Buffer.alloc(0)
      ).toString("utf8"),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const AVAILABLE = hasCobc();
const when = AVAILABLE ? it : it.skip;

describe("split, executed by both engines", () => {
  when("agrees on an ordinary three-field line", () => {
    const { compiled, interpreted } = both("AAA-BBB-CCC\n");
    expect(interpreted).toBe(compiled);
    expect(compiled.trimEnd()).toContain("AAA");
  });

  when("agrees when the first field is empty", () => {
    // A leading delimiter. The first receiver gets nothing, which is not the
    // same as the scan skipping it.
    const { compiled, interpreted } = both("-BBB-CCC\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees when the last field is empty", () => {
    const { compiled, interpreted } = both("AAA-BBB-\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees on adjacent delimiters, which are not collapsed", () => {
    // `DELIMITED BY ALL` is what collapses a run, and the emitter does not
    // write it. `A--B` is three fields: `A`, empty, `B`.
    const { compiled, interpreted } = both("A--B\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees when no delimiter is present at all", () => {
    // The whole field goes into the first receiver and the rest stay as the
    // `MOVE SPACES` left them.
    const { compiled, interpreted } = both("NODELIMITER\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees when there are more fields than receivers", () => {
    // The overflow case: every receiver filled and characters left over.
    const { compiled, interpreted } = both("AA-BB-CC-DD-EE\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees when there are fewer fields than receivers", () => {
    const { compiled, interpreted } = both("AA-BB\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees on a field wider than its receiver", () => {
    // Ten characters is the receiver's width, so the eleventh is truncated by
    // the move rather than spilling into the next field.
    const { compiled, interpreted } = both("ABCDEFGHIJKL-BB\n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees on an all-space line", () => {
    const { compiled, interpreted } = both("          \n");
    expect(interpreted).toBe(compiled);
  });

  when("agrees across several records in one run", () => {
    // The case the emitter's `MOVE SPACES` exists for: a short record after a
    // long one must not read the previous record's third field.
    const { compiled, interpreted } = both("AAA-BBB-CCC\nXXX-YYY\n");
    expect(interpreted).toBe(compiled);
    // And the third field of the second record really is blank rather than
    // still holding CCC.
    const second = compiled.split("\n")[1] ?? "";
    expect(second).not.toContain("CCC");
  });
});
