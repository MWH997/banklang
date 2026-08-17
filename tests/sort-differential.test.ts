import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { toDdName } from "../packages/cobol-backend/src/index";
import {
  buildRecord,
  hasCobc,
  layoutOf,
  runConformance,
  type ConformanceOptions,
} from "../tools/conformance";
import { runInterpreted } from "../tools/interpret";

/**
 * `SORT` and `MERGE`, run by both engines and compared.
 *
 * These were the last locally executable verbs the interpreter could not
 * execute, and three CobolCodeBench tasks passed under `cobc` with no
 * differential result at all because of it, the exact shape of unchecked green
 * that `packages/cobol-runtime` exists to make impossible. Two of those three
 * were also ending with return code 16 while writing correct output, and
 * nothing noticed for as long as only one engine ran them.
 *
 * So this file does not ask whether the interpreter runs a sort. It asks
 * whether it runs the same sort `cobc` does, over the cases where two
 * implementations plausibly differ: the order of equal keys, a descending
 * minor key, a signed key, a packed key, an empty input, a merge whose inputs
 * run out at different times, a sort that fails.
 *
 * **The collating sequence is not covered by any of this.** With no COLLATING
 * SEQUENCE phrase Enterprise COBOL orders alphanumeric keys in EBCDIC; both
 * engines here order them in ASCII. Agreement below is agreement about ASCII
 * ordering, and divergence D11 is where that is written down. The numeric cases
 * are unaffected, since a numeric key is compared as a number on any target.
 */

const AVAILABLE = hasCobc();
const encoder = new TextEncoder();

interface Both {
  exitCode: number | null;
  stdout: string;
  outputs: Map<string, Buffer>;
}

/** Output lines, with trailing blanks removed and the final newline dropped. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => index < all.length - 1 || line !== "");
}

/**
 * Runs one program both ways and fails on any difference.
 *
 * Returns the compiled side's observations so the caller can also say what the
 * answer should be. Both halves matter: agreement alone would be satisfied by
 * two engines that are wrong together, and an expectation alone would not
 * notice that only one of them was ever asked.
 */
function bothWays(
  name: string,
  source: string,
  inputs: Record<string, Buffer>,
  outputs: string[],
): Both {
  const options: ConformanceOptions = {
    source,
    sourceFile: `${name}.bank.ts`,
    workDir: join(tmpdir(), `banklang-sort-diff-${name}`),
    inputs,
    outputs,
  };
  const compiled = runConformance(options);
  const interpreted = runInterpreted(options);

  expect(interpreted.exitCode, `${name}: RETURN-CODE`).toBe(compiled.exitCode);
  expect(lines(interpreted.stdout), `${name}: DISPLAY output`).toEqual(
    lines(compiled.stdout),
  );
  for (const dd of outputs) {
    expect(
      interpreted.outputs.get(dd)?.toString("latin1"),
      `${name}: ${dd}`,
    ).toBe(compiled.outputs.get(dd)?.toString("latin1"));
  }
  return compiled;
}

function text(value: string): Buffer {
  return Buffer.from(encoder.encode(value));
}

function outputText(run: Both, dd: string): string {
  return run.outputs.get(dd)?.toString("latin1") ?? "";
}

/* ------------------------------------------------------------------ *
 * Text keys, over a line-sequential feed.
 * ------------------------------------------------------------------ */

const TEXT_PREAMBLE = `module SortText;

record Line {
  keyText: string<4>;
  seqText: string<3>;
  idempotencyKey: string<36>;
}

file feedIn lineSequential input record Line status feedInStatus;
file feedOut lineSequential output record Line status feedOutStatus;
`;

function textProgram(body: string): string {
  return `${TEXT_PREAMBLE}
entry transaction orderLines(line: Line) {
${body}
  audit("ORDERED", line.idempotencyKey);
}`;
}

const FEED_IN = toDdName("feedIn");
const FEED_OUT = toDdName("feedOut");

function runText(
  name: string,
  body: string,
  input: string,
): { run: Both; out: string } {
  const run = bothWays(name, textProgram(body), { [FEED_IN]: text(input) }, [
    FEED_OUT,
  ]);
  return { run, out: outputText(run, FEED_OUT) };
}

describe.skipIf(!AVAILABLE)("SORT, both engines", () => {
  it("orders one alphanumeric key ascending", () => {
    const { out } = runText(
      "ascending",
      "  sort feedIn into feedOut on keyText;",
      "CCCC001\nAAAA002\nBBBB003\n",
    );
    expect(out).toBe("AAAA002\nBBBB003\nCCCC001\n");
  });

  it("orders one alphanumeric key descending", () => {
    const { out } = runText(
      "descending",
      "  sort feedIn into feedOut on descending keyText;",
      "CCCC001\nAAAA002\nBBBB003\n",
    );
    expect(out).toBe("CCCC001\nBBBB003\nAAAA002\n");
  });

  /**
   * The major key decides; the minor key breaks its ties, in its own direction.
   *
   * A sort that read both keys as ascending, or that applied the last
   * direction to all of them, passes the single-key cases and fails here.
   */
  it("orders a major ascending key and a minor descending one", () => {
    const { out } = runText(
      "two-keys",
      "  sort feedIn into feedOut on keyText, descending seqText;",
      "BBBB001\nAAAA002\nBBBB003\nAAAA004\n",
    );
    expect(out).toBe("AAAA004\nAAAA002\nBBBB003\nBBBB001\n");
  });

  /**
   * Equal keys come back in the order they arrived.
   *
   * Only because the backend emits `WITH DUPLICATES IN ORDER`: without it the
   * Language Reference leaves this undefined, and two engines agreeing on an
   * undefined order would be agreement about their own implementations rather
   * than about the program.
   */
  it("keeps records with equal keys in order", () => {
    const { out } = runText(
      "duplicates",
      "  sort feedIn into feedOut on keyText;",
      "BBBB001\nAAAA002\nBBBB003\nAAAA004\nBBBB005\n",
    );
    expect(out).toBe("AAAA002\nAAAA004\nBBBB001\nBBBB003\nBBBB005\n");
  });

  it("sorts an empty input to an empty output", () => {
    const { run, out } = runText(
      "empty",
      "  sort feedIn into feedOut on keyText;",
      "",
    );
    expect(out).toBe("");
    expect(run.exitCode).toBe(0);
  });

  it("sorts one record", () => {
    const { out } = runText(
      "single",
      "  sort feedIn into feedOut on keyText;",
      "AAAA001\n",
    );
    expect(out).toBe("AAAA001\n");
  });

  it("sorts records that are equal in every byte", () => {
    const { out } = runText(
      "identical",
      "  sort feedIn into feedOut on keyText;",
      "AAAA001\nAAAA001\nAAAA001\n",
    );
    expect(out).toBe("AAAA001\nAAAA001\nAAAA001\n");
  });

  /** An input procedure filters, and `GIVING` still writes the output file. */
  it("runs an input procedure that releases some records", () => {
    const { out } = runText(
      "input-procedure",
      `  sort feedIn into feedOut on keyText input line {
    if line.seqText != "999" {
      release line;
    }
  };`,
      "CCCC001\nAAAA999\nBBBB003\n",
    );
    expect(out).toBe("BBBB003\nCCCC001\n");
  });

  /** An output procedure reformats, and nothing else opens the output file. */
  it("runs an output procedure that rewrites each record", () => {
    const { out } = runText(
      "output-procedure",
      `  sort feedIn into feedOut on keyText output line {
    line.seqText = "XXX";
    write feedOut from line;
  };`,
      "CCCC001\nAAAA002\nBBBB003\n",
    );
    expect(out).toBe("AAAAXXX\nBBBBXXX\nCCCCXXX\n");
  });

  it("runs both procedures on the same sort", () => {
    const { out } = runText(
      "both-procedures",
      `  sort feedIn into feedOut on keyText input line {
    if line.seqText != "999" {
      release line;
    }
  } output line {
    line.seqText = "OUT";
    write feedOut from line;
  };`,
      "CCCC001\nAAAA999\nBBBB003\n",
    );
    expect(out).toBe("BBBBOUT\nCCCCOUT\n");
  });

  /**
   * The failure path, which is the one worth running.
   *
   * With the input dataset missing the sort cannot complete. Both engines have
   * to reach the same return code and print the same line, or the check that
   * stops a job from writing a plausible-looking partial result is only
   * checked on one of them.
   */
  it("agrees on a sort whose input is not there", () => {
    const source = textProgram("  sort feedIn into feedOut on keyText;");
    const options: ConformanceOptions = {
      source,
      sourceFile: "missing.bank.ts",
      workDir: join(tmpdir(), "banklang-sort-diff-missing"),
      outputs: [FEED_OUT],
    };
    const compiled = runConformance(options);
    const interpreted = runInterpreted(options);

    expect(compiled.exitCode).toBe(16);
    expect(interpreted.exitCode).toBe(compiled.exitCode);
    expect(lines(interpreted.stdout)).toEqual(lines(compiled.stdout));
    expect(compiled.stdout).toContain("SORT FAILED feedOut SORT-RETURN 0016");
  });
});

/* ------------------------------------------------------------------ *
 * Numeric keys, over a fixed-length dataset.
 * ------------------------------------------------------------------ */

/**
 * A record with one key of each numeric storage this language has.
 *
 * `COMP` and `COMP-3` hold bytes a text file cannot carry, so these run over a
 * fixed-length sequential dataset built from the compiler's own layout report
 * rather than from hand-counted offsets.
 */
const NUMERIC_PREAMBLE = `module SortNumbers;

record Movement {
  tag: string<3>;
  zonedKey: zoned<5, 0>;
  packedKey: decimal<7, 2>;
  binaryKey: binary<9>;
  plainKey: unsigned<5, 0>;
  idempotencyKey: string<36>;
}

file numbersIn sequential input record Movement status numbersInStatus;
file numbersOut sequential output record Movement status numbersOutStatus;
`;

function numericProgram(key: string): string {
  return `${NUMERIC_PREAMBLE}
entry transaction orderMovements(movement: Movement) {
  sort numbersIn into numbersOut on ${key};
  audit("ORDERED", movement.idempotencyKey);
}`;
}

const NUMBERS_IN = toDdName("numbersIn");
const NUMBERS_OUT = toDdName("numbersOut");

/** The three seeded records, in the order they are written to the input. */
const MOVEMENTS = [
  {
    TAG: "AAA",
    "ZONED-KEY": -12,
    "PACKED-KEY": 30.5,
    "BINARY-KEY": 7,
    "PLAIN-KEY": 300,
  },
  {
    TAG: "BBB",
    "ZONED-KEY": 34,
    "PACKED-KEY": -1.25,
    "BINARY-KEY": -9,
    "PLAIN-KEY": 100,
  },
  {
    TAG: "CCC",
    "ZONED-KEY": 0,
    "PACKED-KEY": 0,
    "BINARY-KEY": 0,
    "PLAIN-KEY": 200,
  },
];

function runNumeric(name: string, key: string): string[] {
  const source = numericProgram(key);
  const layout = layoutOf(
    compile(source, { sourceFile: `${name}.bank.ts` }),
    "Movement",
  );
  const records = MOVEMENTS.map((movement) => buildRecord(layout, movement));
  const run = bothWays(name, source, { [NUMBERS_IN]: Buffer.concat(records) }, [
    NUMBERS_OUT,
  ]);
  const written = run.outputs.get(NUMBERS_OUT) ?? Buffer.alloc(0);
  const labels: string[] = [];
  for (
    let at = 0;
    at + layout.totalLength <= written.length;
    at += layout.totalLength
  ) {
    labels.push(written.subarray(at, at + 3).toString("ascii"));
  }
  return labels;
}

describe.skipIf(!AVAILABLE)("SORT keys, by how the number is stored", () => {
  /**
   * A signed key is ordered by its value, not by its characters.
   *
   * `zoned<5,0>` is `SIGN IS TRAILING SEPARATE`, so -12 is the characters
   * `00012-`. An engine comparing those as text puts it after `00034+`; an
   * engine comparing them as numbers puts it first, which is what COBOL means.
   */
  it("orders a signed zoned key by value", () => {
    expect(runNumeric("zoned", "zonedKey")).toEqual(["AAA", "CCC", "BBB"]);
  });

  it("orders a packed key by value", () => {
    expect(runNumeric("packed", "packedKey")).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("orders a binary key by value", () => {
    expect(runNumeric("binary", "binaryKey")).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("orders an unsigned display key by value", () => {
    expect(runNumeric("unsigned", "plainKey")).toEqual(["BBB", "CCC", "AAA"]);
  });

  it("orders an alphanumeric key by its characters", () => {
    expect(runNumeric("tag", "tag")).toEqual(["AAA", "BBB", "CCC"]);
  });
});

/* ------------------------------------------------------------------ *
 * MERGE.
 * ------------------------------------------------------------------ */

const MERGE_PREAMBLE = `module MergeText;

record Line {
  keyText: string<4>;
  seqText: string<3>;
  idempotencyKey: string<36>;
}

file mergeOne lineSequential input record Line status mergeOneStatus;
file mergeTwo lineSequential input record Line status mergeTwoStatus;
file mergeThree lineSequential input record Line status mergeThreeStatus;
file mergeOut lineSequential output record Line status mergeOutStatus;
`;

const MERGE_ONE = toDdName("mergeOne");
const MERGE_TWO = toDdName("mergeTwo");
const MERGE_THREE = toDdName("mergeThree");
const MERGE_OUT = toDdName("mergeOut");

function mergeProgram(body: string): string {
  return `${MERGE_PREAMBLE}
entry transaction mergeLines(line: Line) {
${body}
  audit("MERGED", line.idempotencyKey);
}`;
}

function runMerge(
  name: string,
  body: string,
  feeds: { one: string; two: string; three?: string },
): string {
  const inputs: Record<string, Buffer> = {
    [MERGE_ONE]: text(feeds.one),
    [MERGE_TWO]: text(feeds.two),
  };
  if (feeds.three !== undefined) {
    inputs[MERGE_THREE] = text(feeds.three);
  }
  const run = bothWays(name, mergeProgram(body), inputs, [MERGE_OUT]);
  return outputText(run, MERGE_OUT);
}

const MERGE_TWO_WAY = "  merge mergeOne, mergeTwo into mergeOut on keyText;";

describe.skipIf(!AVAILABLE)("MERGE, both engines", () => {
  it("interleaves two ordered inputs", () => {
    expect(
      runMerge("merge-two", MERGE_TWO_WAY, {
        one: "AAAA001\nCCCC003\n",
        two: "BBBB002\nDDDD004\n",
      }),
    ).toBe("AAAA001\nBBBB002\nCCCC003\nDDDD004\n");
  });

  /**
   * Equal keys come back in the order of the input files, and within a file in
   * the order the records were read. That is the Language Reference's rule for
   * a merge and it needs no DUPLICATES phrase, which is why the backend emits
   * none.
   */
  it("orders equal keys by input file, then by position", () => {
    expect(
      runMerge("merge-duplicates", MERGE_TWO_WAY, {
        one: "AAAA101\nAAAA102\nBBBB103\n",
        two: "AAAA201\nBBBB202\n",
      }),
    ).toBe("AAAA101\nAAAA102\nAAAA201\nBBBB103\nBBBB202\n");
  });

  it("merges when one input is empty", () => {
    expect(
      runMerge("merge-one-empty", MERGE_TWO_WAY, {
        one: "",
        two: "BBBB002\nDDDD004\n",
      }),
    ).toBe("BBBB002\nDDDD004\n");
  });

  it("merges when both inputs are empty", () => {
    expect(
      runMerge("merge-both-empty", MERGE_TWO_WAY, { one: "", two: "" }),
    ).toBe("");
  });

  /** One input runs out first: the rest of the other has to follow it. */
  it("drains the longer input after the shorter one ends", () => {
    expect(
      runMerge("merge-uneven", MERGE_TWO_WAY, {
        one: "AAAA001\n",
        two: "BBBB002\nCCCC003\nDDDD004\n",
      }),
    ).toBe("AAAA001\nBBBB002\nCCCC003\nDDDD004\n");
  });

  it("merges three inputs", () => {
    expect(
      runMerge(
        "merge-three",
        "  merge mergeOne, mergeTwo, mergeThree into mergeOut on keyText;",
        {
          one: "AAAA001\nDDDD004\n",
          two: "BBBB002\nEEEE005\n",
          three: "CCCC003\nFFFF006\n",
        },
      ),
    ).toBe("AAAA001\nBBBB002\nCCCC003\nDDDD004\nEEEE005\nFFFF006\n");
  });

  it("merges descending inputs descending", () => {
    expect(
      runMerge(
        "merge-descending",
        "  merge mergeOne, mergeTwo into mergeOut on descending keyText;",
        { one: "CCCC003\nAAAA001\n", two: "DDDD004\nBBBB002\n" },
      ),
    ).toBe("DDDD004\nCCCC003\nBBBB002\nAAAA001\n");
  });

  it("runs an output procedure over the merged records", () => {
    expect(
      runMerge(
        "merge-output-procedure",
        `  merge mergeOne, mergeTwo into mergeOut on keyText output line {
    line.seqText = "MRG";
    write mergeOut from line;
  };`,
        { one: "AAAA001\nCCCC003\n", two: "BBBB002\n" },
      ),
    ).toBe("AAAAMRG\nBBBBMRG\nCCCCMRG\n");
  });
});
