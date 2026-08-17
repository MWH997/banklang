import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { toDdName } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import { lintCobol } from "../packages/conformance-lint/src/index";
import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
} from "../tools/conformance";
import { runInterpreted } from "../tools/interpret";
import { runtimePrograms } from "../tools/generated-artifacts";

/**
 * `record Heading, Detail`: several `01` layouts under one `FD`.
 *
 * The feature exists because of a measurement rather than because two
 * benchmark tasks wanted it. `evidence/horizontal/xcobol-v2/record-usage.json`:
 * 2,812 of 6,451 file descriptions carry more than one record, and 2,663 of
 * those are opened `OUTPUT`: a report whose heading line and detail lines are
 * different shapes. 143 are opened `INPUT`, across fourteen repositories of
 * which six are parser test suites, and those are the ones BankTS refuses:
 * a `read` cannot know which layout arrived.
 *
 * The safety argument in one line: the variant is chosen where its type is
 * known. `write bills from heading` writes the heading layout because `heading`
 * is a `BillHeading`, and nothing in the language produces a value of an
 * undetermined variant, so there is nothing to narrow.
 */

const AVAILABLE = hasCobc();

const PROGRAM = `module BillPrint;

record BillHeading {
  headingText: string<40>;
}

record BillDetail {
  detailCustomer: string<5>;
  detailGap: string<2>;
  detailAmount: edited<zoned<9, 2>, "plain">;
}

record BillTrailer {
  trailerText: string<8>;
  trailerCount: unsigned<3, 0>;
}

record FeedLine {
  feedCustomer: string<5>;
  feedAmount: zoned<9, 2>;
  idempotencyKey: string<36>;
}

file feedIn lineSequential input record FeedLine status feedInStatus;
file bills
  lineSequential
  output
  record BillHeading, BillDetail, BillTrailer
  status billsStatus;

entry transaction printBills(
  line: FeedLine,
  heading: BillHeading,
  detail: BillDetail,
  trailer: BillTrailer,
) {
  open bills;
  heading.headingText = "CUSTOMER   AMOUNT DUE";
  write bills from heading;

  open feedIn;
  while feedInStatus == "00" limit 1000 {
    read feedIn into line;
    if feedInStatus == "00" {
      detail.detailCustomer = line.feedCustomer;
      detail.detailGap = "  ";
      detail.detailAmount = line.feedAmount;
      write bills from detail;
      trailer.trailerCount = trailer.trailerCount + 1;
    }
  }
  close feedIn;

  trailer.trailerText = "COUNT   ";
  write bills from trailer;
  close bills;

  audit("BILLS_PRINTED", line.idempotencyKey);
}`;

const FEED_IN = toDdName("feedIn");
const BILLS = toDdName("bills");

/** Two feed lines, in the fixed shape the record declares. */
const FEED = "A0001000012345+KEY-1\nB0002000067890+KEY-2\n";

function options(): ConformanceOptions {
  return {
    source: PROGRAM,
    sourceFile: "multi-record.bank.ts",
    workDir: join(tmpdir(), "banklang-multi-record"),
    inputs: { [FEED_IN]: Buffer.from(FEED, "latin1") },
    outputs: [BILLS],
  };
}

describe("a file carrying several record layouts", () => {
  const result = compile(PROGRAM, { sourceFile: "multi-record.bank.ts" });

  it("compiles", () => {
    expect(
      result.diagnostics.map((entry) => `${entry.id} ${entry.message}`),
    ).toEqual([]);
  });

  /** One FD, three 01 entries, each named after the record it came from. */
  it("emits one 01 per layout under one FD", () => {
    const cobol = result.cobol ?? "";
    const section = cobol.slice(
      cobol.indexOf("FD  BILLS-FILE"),
      cobol.indexOf("WORKING-STORAGE SECTION"),
    );
    expect(section).toContain("01  BILLS-RECORD.");
    expect(section).toContain("01  BILLS-BILL-DETAIL-RECORD.");
    expect(section).toContain("01  BILLS-BILL-TRAILER-RECORD.");
  });

  /**
   * Each write names its own 01. Writing them all through the first would put
   * the detail's fields at the heading's offsets, which compiles and produces
   * a file of nonsense.
   */
  it("writes through the 01 the record's type names", () => {
    const cobol = result.cobol ?? "";
    expect(cobol).toContain("WRITE BILLS-RECORD");
    expect(cobol).toContain("WRITE BILLS-BILL-DETAIL-RECORD");
    expect(cobol).toContain("WRITE BILLS-BILL-TRAILER-RECORD");
    expect(cobol.replace(/\s+/g, " ")).toContain(
      "MOVE DETAIL-CUSTOMER OF BILL-DETAIL TO DETAIL-CUSTOMER OF BILLS-BILL-DETAIL-RECORD",
    );
  });

  it("passes the conformance lint the target's rules are in", () => {
    expect(
      lintCobol("multi-record.bank.ts", result.cobol ?? "", {
        knownPrograms: runtimePrograms(),
      }).map((finding) => `${finding.rule}: ${finding.message}`),
    ).toEqual([]);
  });

  /**
   * The whole point of the differential lane, and it earned its keep here on
   * the first run: the interpreter wrote the record *area* rather than the
   * record, so a short detail line carried the tail of the longer heading
   * written before it, `A0001   123.45 DUE`, where ` DUE` was four bytes of
   * `AMOUNT DUE`. `cobc` wrote the detail's own length. Both now do.
   */
  it.skipIf(!AVAILABLE)("writes each layout's own length, both ways", () => {
    const compiled = runConformance(options());
    const interpreted = runInterpreted(options());

    const expected =
      "CUSTOMER   AMOUNT DUE\nA0001      123.45\nB0002      678.90\nCOUNT   002\n";
    expect(compiled.outputs.get(BILLS)?.toString("latin1")).toBe(expected);
    expect(interpreted.outputs.get(BILLS)?.toString("latin1")).toBe(expected);
    expect(interpreted.exitCode).toBe(compiled.exitCode);
    expect(interpreted.stdout).toBe(compiled.stdout);
  });
});

/**
 * The refusals, which are the reason this is a safe feature rather than a
 * loosened restriction.
 */
describe("layouts a file may not carry", () => {
  const ids = (source: string): string[] =>
    compile(source, { sourceFile: "refused.bank.ts" }).diagnostics.map(
      (entry) => entry.id,
    );

  const RECORDS = `module Refused;

record Alpha { alphaText: string<10>; idempotencyKey: string<36>; }
record Beta { betaText: string<20>; }
`;

  const use = (declaration: string): string => `${RECORDS}
${declaration}

entry transaction touch(alpha: Alpha) {
  audit("TOUCHED", alpha.idempotencyKey);
}`;

  /**
   * The central rule. A `read` names no layout, so which one arrived is
   * decided by the data, and a value whose type is a guess is what this
   * language exists not to hand back.
   */
  it("refuses several layouts on a file that is read", () => {
    expect(
      ids(
        use("file feed sequential input record Alpha, Beta status feedStatus;"),
      ),
    ).toContain("BANK-FILE-015");
    expect(
      ids(
        use(
          "file feed sequential update record Alpha, Beta status feedStatus;",
        ),
      ),
    ).toContain("BANK-FILE-015");
  });

  /** A record key belongs to one layout. */
  it("refuses several layouts on an indexed file", () => {
    expect(
      ids(
        use(
          "file store indexed output record Alpha, Beta key alphaText status storeStatus;",
        ),
      ),
    ).toContain("BANK-FILE-015");
  });

  /** `RECORD IS VARYING` describes one record's length, not a choice. */
  it("refuses several layouts with a varying record length", () => {
    expect(
      ids(
        `${RECORDS}
record Sized { usedLength: unsigned<4, 0>; }
file out sequential output record Alpha, Beta varying 10 to 40 length feedLength status outStatus;

entry transaction touch(alpha: Alpha) {
  audit("TOUCHED", alpha.idempotencyKey);
}`,
      ),
    ).toContain("BANK-FILE-015");
  });

  it("refuses the same layout twice", () => {
    expect(
      ids(
        use("file out sequential output record Alpha, Alpha status outStatus;"),
      ),
    ).toContain("BANK-FILE-015");
  });

  /** A write still has to name one of the layouts the file declares. */
  it("refuses a write of a layout the file does not carry", () => {
    expect(
      ids(`${RECORDS}
record Gamma { gammaText: string<4>; }
file out sequential output record Alpha, Beta status outStatus;

entry transaction touch(alpha: Alpha, gamma: Gamma) {
  open out;
  write out from gamma;
  close out;
  audit("TOUCHED", alpha.idempotencyKey);
}`),
    ).toContain("BANK-FILE-002");
  });

  /**
   * A DD name that is also a data item.
   *
   * `ASSIGN TO FEED` takes the file name from the *contents* of a data item
   * called `FEED` when one exists, on Enterprise COBOL 6 and on GnuCOBOL
   * both. The program compiled, the OPEN failed with status 35, and the two
   * engines disagreed about whether the input file existed at all.
   */
  it("refuses a DD name that is also a record or field name", () => {
    expect(
      ids(`module Collide;

record Feed { feedText: string<10>; idempotencyKey: string<36>; }

file feed sequential input record Feed status feedStatus;

entry transaction touch(line: Feed) {
  audit("TOUCHED", line.idempotencyKey);
}`),
    ).toContain("BANK-FILE-016");
  });
});
