import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `BANK-FILE-017` — a file operation whose outcome the program never looked at.
 *
 * The largest known safety gap in this compiler, and the second attempt at it.
 * The first read "a declared status must be referenced somewhere", which is not
 * a property of a program's behaviour: it is satisfied by a `log` of the status
 * and violated by a perfectly safe drain loop, and it was measured, rejected
 * and never shipped.
 *
 * What is checked now is flow-sensitive and about the outcome rather than the
 * field. An operation that can end with a status the generated check lets
 * through — end of file, no such record, a duplicate key — leaves an outstanding
 * fact. Using the record it filled, operating on the file again, or leaving the
 * routine with the fact outstanding is the defect. Comparing the status
 * discharges it, wherever that comparison is written.
 *
 * These are the two halves of the same claim: the idioms below must stay legal,
 * and the defects below must not.
 */

const PREAMBLE = `module Outcomes;

record Feed {
  feedAccount: string<16>;
  feedAmount: zoned<11, 2>;
  idempotencyKey: string<36>;
}

record Master {
  masterAccount: string<16>;
  masterBalance: zoned<11, 2>;
  idempotencyKey: string<36>;
}

file feedIn sequential input record Feed status feedInStatus;
file otherIn sequential input record Feed status otherInStatus;
file store indexed update record Master key masterAccount status storeStatus;
file trail sequential output record Feed status trailStatus;
`;

function ids(body: string, extra = ""): string[] {
  return compile(
    `${PREAMBLE}${extra}
entry transaction handle(line: Feed, master: Master) {
${body}
  audit("HANDLED", line.idempotencyKey);
}`,
    { sourceFile: "outcomes.bank.ts" },
  ).diagnostics.map((entry) => entry.id);
}

function outcomes(body: string, extra = ""): string[] {
  return ids(body, extra).filter((id) => id === "BANK-FILE-017");
}

/** Everything else has to stay clean, or the fixture is testing the wrong thing. */
function clean(body: string, extra = ""): string[] {
  return ids(body, extra);
}

describe("idioms that handle the outcome", () => {
  it("a read then an if on the status", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  /** The drain loop the language reference teaches. */
  it("a read whose status drives the loop condition", () => {
    expect(
      clean(`  open feedIn;
  while feedInStatus == "00" limit 1000 {
    read feedIn into line;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("a read in a loop, guarded inside the body", () => {
    expect(
      clean(`  open feedIn;
  while feedInStatus == "00" limit 1000 {
    read feedIn into line;
    if feedInStatus == "00" {
      log "ACCOUNT ", line.feedAccount;
    }
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("a test written into a local before the branch", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  let arrived: bool = feedInStatus == "00";
  if arrived {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  /** Both branches of the test use the record; neither is unguarded. */
  it("both branches of a status test", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  } else {
    log "NOTHING READ ", feedInStatus;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("a nested branch under the status test", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    if line.feedAmount > 0.00 {
      log "ACCOUNT ", line.feedAccount;
    }
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("several operations, each handled in turn", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ONE ", line.feedAccount;
  }
  read feedIn into line;
  if feedInStatus == "00" {
    log "TWO ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("two files, each tested on its own status", () => {
    expect(
      clean(`  open feedIn;
  open otherIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ONE ", line.feedAccount;
  }
  read otherIn into line;
  if otherInStatus == "00" {
    log "TWO ", line.feedAccount;
  }
  close otherIn;
  close feedIn;`),
    ).toEqual([]);
  });

  /**
   * A sequential write has no outcome the program is left to handle: anything
   * other than success stops the step, so there is nothing outstanding.
   */
  it("a write to a sequential file, which has no expected status", () => {
    expect(
      clean(`  open trail;
  write trail from line;
  close trail;`),
    ).toEqual([]);
  });

  /** A file with an error handler still has to test what the handler never sees. */
  it("an error handler, with the expected outcome still tested", () => {
    expect(
      clean(
        `  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`,
        `
on error feedIn {
  log "FEED FAILED ", feedInStatus;
}
`,
      ),
    ).toEqual([]);
  });

  /**
   * A `raise` abandons the work rather than carrying on with a stale record, so
   * the path ends and nothing is outstanding on it.
   */
  it("a raise before the record is used", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  raise "NOTHING_TO_DO";`),
    ).toEqual([]);
  });
});

describe("outcomes the program did not handle", () => {
  it("a read whose record is used with no test at all", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("a read followed by another read", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** `CLOSE` sets the status too, so a test after it reads the close's answer. */
  it("a read whose status the close overwrites", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  close feedIn;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("the wrong file's status", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if otherInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** A test written before the read answers about the operation before it. */
  it("a status tested before the read rather than after", () => {
    expect(
      outcomes(`  open feedIn;
  if feedInStatus == "00" {
    log "READY";
  }
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /**
   * A status logged is a status mentioned. The program printed the answer and
   * carried on regardless, which is the shape this check exists to refuse.
   */
  it("a status logged but never branched on", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  log "STATUS ", feedInStatus;
  log "ACCOUNT ", line.feedAccount;
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** One path tests it; the other reaches the end of the transaction with it open. */
  it("only one branch handling the read", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if line.feedAmount > 0.00 {
    if feedInStatus == "00" {
      log "ACCOUNT ", line.feedAccount;
    }
  }
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("a transaction that ends with the outcome outstanding", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** A keyed read answers "no such record" with 23, and the record is stale. */
  it("a keyed read on an indexed file", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  log "BALANCE ", master.masterBalance;
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** A write to a KSDS answers "duplicate key" with 22, and nothing was written. */
  it("a write to an indexed file", () => {
    expect(
      outcomes(`  open store;
  write store from master;
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("a browse positioned and never checked", () => {
    expect(
      outcomes(`  open store;
  start store key master.masterAccount;
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * The check is about a program's own control flow, so a function is analysed
 * like a transaction.
 */
describe("functions", () => {
  it("reports an outcome left outstanding at a function's end", () => {
    const result = compile(
      `${PREAMBLE}
function firstAccount(line: Feed): string<16> {
  read feedIn into line;
  return line.feedAccount;
}

entry transaction handle(line: Feed, master: Master) {
  open feedIn;
  log "FIRST ", firstAccount(line);
  close feedIn;
  audit("HANDLED", line.idempotencyKey);
}`,
      { sourceFile: "outcomes.bank.ts" },
    );

    expect(
      result.diagnostics.filter((entry) => entry.id === "BANK-FILE-017"),
    ).toHaveLength(1);
  });
});
