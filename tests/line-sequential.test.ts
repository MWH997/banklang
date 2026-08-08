import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { lintCobol } from "../packages/conformance-lint/src/index";
import { detectFeatures } from "../packages/migration-analysis/src/features";
import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
} from "../tools/conformance";
import {
  generatedCobol,
  isLineSequential,
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "../tools/interpret";
import { flowed } from "./helpers";

/**
 * Line-sequential files: text in, text out.
 *
 * The organization a payment feed, a reconciliation extract or an import from
 * anything that is not a mainframe actually has. Enterprise COBOL 6.4 has it as
 * `ORGANIZATION IS LINE SEQUENTIAL` for files in the z/OS UNIX file system, and
 * it carries restrictions the other three organizations do not — restrictions
 * that are the interesting part of this feature rather than an afterthought.
 *
 * The one worth reading twice: a record may hold only `USAGE DISPLAY` items,
 * and BankTS's default is the thing that is forbidden. `decimal<11,2>` lowers
 * to `COMP-3`, packed two digits to a byte with a sign nibble; written into a
 * text file it produces bytes that are neither the number nor readable text,
 * the WRITE succeeds, and nothing says so until somebody opens the file. That
 * is a compile error here.
 */

const HEAD = `module Feed;

record FeedLine {
  feedAccount: string<10>;
  feedAmount: zoned<9, 2>;
}
`;

function diagnose(source: string): string[] {
  return compile(source, { sourceFile: "feed.bank.ts" })
    .diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.id);
}

describe("declaring a line-sequential file", () => {
  it("parses and typechecks alongside the other organizations", () => {
    const result = compile(
      `${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
      { sourceFile: "feed.bank.ts" },
    );
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
  });

  it("refuses an organization that is not one of the four", () => {
    expect(
      diagnose(`${HEAD}
file feedInput streamed input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`),
    ).toContain("BANK-SYN-001");
  });
});

describe("what a line-sequential record may hold", () => {
  /**
   * The rule, from Enterprise COBOL's Programming Guide: "Records written to
   * line-sequential files must contain only USAGE DISPLAY and DISPLAY-1 items.
   * Zoned decimal data items must be unsigned or declared with the SEPARATE
   * phrase of the SIGN clause if signed."
   */
  const withField = (field: string) => `module Feed;

record FeedLine {
  feedAccount: string<10>;
  ${field}
}

file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`;

  it("refuses packed decimal, which is the BankTS default", () => {
    expect(diagnose(withField("feedAmount: decimal<9, 2>;"))).toContain(
      "BANK-FILE-014",
    );
  });

  it("refuses binary and native binary", () => {
    expect(diagnose(withField("feedCount: binary<9>;"))).toContain(
      "BANK-FILE-014",
    );
    expect(diagnose(withField("feedCount: native<9>;"))).toContain(
      "BANK-FILE-014",
    );
  });

  it("refuses a currency amount, which is packed by construction", () => {
    expect(
      diagnose(
        `module Feed;

type BDT = currency<"BDT", 11, 2>;

record FeedLine {
  feedAccount: string<10>;
  feedAmount: BDT;
}

file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
      ),
    ).toContain("BANK-FILE-014");
  });

  it("accepts zoned, which emits the SEPARATE sign the rule asks for", () => {
    expect(diagnose(withField("feedAmount: zoned<9, 2>;"))).toEqual([]);
    const cobol = compile(withField("feedAmount: zoned<9, 2>;"), {
      sourceFile: "feed.bank.ts",
    }).cobol;
    expect(flowed(cobol)).toContain("SIGN IS TRAILING SEPARATE");
  });

  it("accepts unsigned, which has no sign to place", () => {
    expect(diagnose(withField("feedCount: unsigned<9, 0>;"))).toEqual([]);
  });

  it("accepts text, national text and dates, which are all DISPLAY", () => {
    expect(diagnose(withField("feedName: string<20>;"))).toEqual([]);
    expect(diagnose(withField("feedName: national<20>;"))).toEqual([]);
    expect(diagnose(withField("feedValueDate: date;"))).toEqual([]);
  });

  it("looks inside an array and a nested record rather than only at the top", () => {
    // A packed field one level down is just as unprintable as one at the top,
    // and a check that only walked the first level would pass this.
    expect(
      diagnose(`module Feed;

record Inner {
  innerAmount: decimal<9, 2>;
}

record FeedLine {
  feedAccount: string<10>;
  feedInner: Inner;
}

file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`),
    ).toContain("BANK-FILE-014");
  });
});

describe("what a line-sequential file may do", () => {
  it("refuses update, because the organization cannot be opened I-O", () => {
    expect(
      diagnose(`${HEAD}
file feedInput lineSequential update record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`),
    ).toContain("BANK-FILE-013");
  });

  it("refuses delete, which needs a record it can address", () => {
    const ids = diagnose(`${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

entry transaction run(line: FeedLine, idempotencyKey: string<36>) {
  open feedInput;
  delete feedInput;
  close feedInput;
  audit("RUN", idempotencyKey);
}
`);
    expect(ids).toContain("BANK-FILE-011");
  });

  it("refuses a browse, which needs an index", () => {
    const ids = diagnose(`${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

entry transaction run(line: FeedLine, idempotencyKey: string<36>) {
  open feedInput;
  start feedInput key line.feedAccount;
  close feedInput;
  audit("RUN", idempotencyKey);
}
`);
    // Refused twice over: `start` browses an index (BANK-FILE-004) and needs
    // the file open for update (BANK-FILE-005), and a line-sequential file can
    // be neither.
    expect(ids).toContain("BANK-FILE-004");
  });

  it("keeps the sensitive-data rules, which are not about organization", () => {
    // The information-flow rule is on assignment into a field, so a text file
    // is no way around it. Asserted rather than assumed: a new file
    // organization is exactly where somebody would expect a gap.
    const ids = diagnose(`module Feed;

record FeedLine {
  feedAccount: string<10>;
  sensitive feedCustomer: string<20>;
}

record OutLine {
  outAccount: string<10>;
  outCustomer: string<20>;
}

file feedInput lineSequential input record FeedLine status feedInputStatus;
file feedReport lineSequential output record OutLine status feedReportStatus;

entry transaction run(line: FeedLine, out: OutLine, idempotencyKey: string<36>) {
  open feedInput;
  open feedReport;
  read feedInput into line;
  out.outCustomer = line.feedCustomer;
  write feedReport from out;
  close feedReport;
  close feedInput;
  audit("RUN", idempotencyKey);
}
`);
    expect(ids).toContain("BANK-SEC-001");
  });
});

describe("the COBOL a line-sequential file becomes", () => {
  const compiled = compile(
    `${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
    { sourceFile: "feed.bank.ts", emitJcl: true },
  );

  it("writes the two-word clause rather than one run-together word", () => {
    // `organization.toUpperCase()` would give `LINESEQUENTIAL`, which no
    // compiler accepts and which nothing else here would have caught.
    expect(flowed(compiled.cobol)).toContain("ORGANIZATION IS LINE SEQUENTIAL");
    expect(compiled.cobol).not.toContain("LINESEQUENTIAL");
  });

  it("is sequential access, the only mode the organization allows", () => {
    expect(flowed(compiled.cobol)).toContain("ACCESS MODE IS SEQUENTIAL");
  });

  it("carries the file status", () => {
    expect(flowed(compiled.cobol)).toContain(
      "FILE STATUS IS FEED-INPUT-STATUS",
    );
  });

  it("emits no QSAM blocking clauses, which do not apply", () => {
    // BLOCK CONTAINS and RECORDING MODE describe a blocked dataset. A
    // line-sequential file is a stream of characters and has neither.
    const fd = /FD {2}FEED-INPUT-FILE([\s\S]*?)\./.exec(compiled.cobol ?? "");
    expect(fd?.[1] ?? "").not.toContain("BLOCK CONTAINS");
    expect(fd?.[1] ?? "").not.toContain("RECORDING MODE");
  });

  it("allocates a z/OS UNIX path rather than a dataset", () => {
    // Enterprise COBOL reads these through the z/OS UNIX file system, so the
    // DD names a path. A `DSN=` DD names an MVS dataset and would not resolve.
    //
    // Compiled from a module with an entry transaction, because the DD
    // statements belong to the step that runs the program and a module with no
    // entry point produces no step to allocate them for.
    const job = compile(
      `${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

entry transaction run(line: FeedLine, idempotencyKey: string<36>) {
  open feedInput;
  read feedInput into line;
  if feedInputStatus != "00" {
    log "NOTHING READ ", feedInputStatus;
  }
  close feedInput;
  audit("RUN", idempotencyKey);
}
`,
      { sourceFile: "feed.bank.ts", emitJcl: true },
    ).jcl;
    expect(job).toContain("//FEEDINPU DD PATH='/u/banklang/feedinpu',");
    expect(job).toContain("PATHOPTS=(ORDONLY)");
    expect(job).not.toMatch(/\/\/FEEDINPU DD DISP=SHR,DSN=/);
  });

  it("passes the conformance linter", () => {
    expect(lintCobol("feed.cbl", compiled.cobol ?? "")).toEqual([]);
  });

  it("compiles to the same bytes twice", () => {
    const again = compile(
      `${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
      { sourceFile: "feed.bank.ts", emitJcl: true },
    );
    expect(again.cobol).toBe(compiled.cobol);
    expect(again.jcl).toBe(compiled.jcl);
  });
});

describe("the analyser and the harness recognise it", () => {
  it("detects the organization in COBOL it reads", () => {
    const counts = detectFeatures(
      "       IDENTIFICATION DIVISION.\n" +
        "       PROGRAM-ID. X.\n" +
        "           SELECT F ASSIGN TO FEED\n" +
        "               ORGANIZATION IS LINE SEQUENTIAL.\n",
    );
    expect(counts["file-line-sequential"]).toBe(1);
  });

  it("finds the organization for a DD in generated COBOL", () => {
    const cobol =
      compile(
        `${HEAD}
file feedInput lineSequential input record FeedLine status feedInputStatus;

function unused(): bool {
  return true;
}
`,
        { sourceFile: "feed.bank.ts" },
      ).cobol ?? "";
    expect(isLineSequential(cobol, "FEEDINPU")).toBe(true);
    expect(isLineSequential(cobol, "NOSUCHDD")).toBe(false);
  });
});

/**
 * The program executed, both ways.
 *
 * A text file is where the two engines are most likely to disagree, because
 * every byte of the boundary is a decision: where a record ends, whether
 * trailing blanks survive, whether the last line has a delimiter. Both of those
 * disagreements actually happened the first time this ran, and both were in the
 * harness rather than the compiler — which is exactly what a differential lane
 * is for.
 */
describe("executing a line-sequential program", () => {
  const source = `module SettlementFeed;

record FeedLine {
  feedAccount: string<10>;
  feedAmount: zoned<9, 2>;
}

record OutLine {
  outAccount: string<10>;
  outAmount: zoned<9, 2>;
}

file feedInput lineSequential input record FeedLine status feedInputStatus;
file feedReport lineSequential output record OutLine status feedReportStatus;

entry transaction copyFeed(line: FeedLine, out: OutLine, idempotencyKey: string<36>) {
  open feedInput;
  open feedReport;

  while feedInputStatus == "00" limit 1000 {
    read feedInput into line;

    if feedInputStatus == "00" {
      out.outAccount = line.feedAccount;
      out.outAmount = line.feedAmount;
      write feedReport from out;
    }
  }

  close feedReport;
  close feedInput;

  audit("FEED_COPIED", idempotencyKey);
}
`;

  function options(input: string, workDir: string): ConformanceOptions {
    const cobol = generatedCobol(source, "main.bank.ts");
    return {
      source,
      sourceFile: "main.bank.ts",
      workDir,
      inputs: { FEEDINPU: Buffer.from(input, "utf8") },
      outputs: ["FEEDREPO"],
      driver: takesParm(cobol)
        ? parmDriver(programNameOf(cobol), "KEY".padEnd(36, "0"))
        : undefined,
    };
  }

  function both(input: string): { compiled: string; interpreted: string } {
    const workDir = mkdtempSync(join(tmpdir(), "banklang-ls-"));
    try {
      const config = options(input, workDir);
      const compiled = runConformance(config);
      const interpreted = runInterpreted(config);
      return {
        compiled: (
          compiled.outputs.get("FEEDREPO") ?? Buffer.alloc(0)
        ).toString("utf8"),
        interpreted: (
          interpreted.outputs.get("FEEDREPO") ?? Buffer.alloc(0)
        ).toString("utf8"),
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  const AVAILABLE = hasCobc();
  const when = AVAILABLE ? it : it.skip;

  when("copies every record, and both engines agree", () => {
    const { compiled, interpreted } = both(
      "ACC0000001000012345+\nACC0000002000006789+\nACC0000003000000500-\n",
    );
    expect(compiled).toBe(
      "ACC0000001000012345+\nACC0000002000006789+\nACC0000003000000500-\n",
    );
    expect(interpreted).toBe(compiled);
  });

  when("agrees with the interpreter on a file that ends properly", () => {
    // The contract a feed file has: every record delimited, including the last.
    const { compiled, interpreted } = both(
      "ACC0000001000012345+\nACC0000002000006789+\n",
    );
    expect(interpreted).toBe(compiled);
  });

  when("skips a final unterminated record rather than half-reading it", () => {
    /*
     * A measured GnuCOBOL 3.2.0 behaviour, pinned here because it is a
     * divergence from what Enterprise COBOL's Programming Guide describes.
     *
     * When the last line has no delimiter *and* its length exactly fills the
     * record area, GnuCOBOL sets file status 06 and does not deliver the
     * record. IBM documents the end-of-file case as "the remainder of the
     * record area is filled with spaces", which reads as delivering it.
     *
     * The generated loop tests `status == "00"` before using what it read, so
     * the record is skipped rather than processed as garbage — which is the
     * safe end of the difference. `docs/divergences.md` records it, and a
     * program must not depend on a file whose last line lacks a delimiter.
     */
    const { compiled } = both("ACC0000001000012345+\nACC0000002000006789+");
    expect(compiled).toBe("ACC0000001000012345+\n");
  });

  when("reads an empty file as no records at all", () => {
    const { compiled, interpreted } = both("");
    expect(compiled).toBe("");
    expect(interpreted).toBe(compiled);
  });

  when("space-fills a record shorter than the record area", () => {
    /*
     * IBM's rule for a short line: "The delimiter is discarded and the
     * remainder of the record area is filled with spaces."
     *
     * So a four-character line arrives as `ACC1` followed by sixteen spaces,
     * and the account field — ten characters wide — comes back padded. Only
     * `cobc` is asserted here: the amount field's bytes are spaces, which is
     * not a valid zoned number, and the two engines disagree about what moving
     * one does. That disagreement is recorded in `docs/divergences.md` rather
     * than resolved by a test, because on the target it is a data exception
     * and neither answer is right.
     */
    const { compiled } = both("ACC1\nACC0000002000006789+\n");
    expect(compiled.split("\n")[0]).toBe("ACC1");
  });
});
