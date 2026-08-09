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
  masterOne: string<4>;
  masterTwo: string<4>;
  amounts: zoned<9, 2>[4];
  masterCount: unsigned<4, 0>;
  idempotencyKey: string<36>;
}

file feedIn sequential input record Feed status feedInStatus;
file otherIn sequential input record Feed status otherInStatus;
file store indexed update record Master key masterAccount status storeStatus;
file trail sequential output record Feed status trailStatus;
file amend sequential update record Feed status amendStatus;
file printOut sequential output record Feed page 60 status printOutStatus;

queue feedQueue manager "CSQ1" name "BANK.FEED" output
  record Feed status feedQueueReason;

enum Kind { ONE, TWO }
`;

function compiled(
  body: string,
  extra = "",
  parameter = "",
): ReturnType<typeof compile>["diagnostics"] {
  return compile(
    `${PREAMBLE}${extra}
entry transaction handle(line: Feed, master: Master, chosen: Kind${parameter ? `, ${parameter}` : ""}) {
${body}
  audit("HANDLED", master.idempotencyKey);
}`,
    { sourceFile: "outcomes.bank.ts" },
  ).diagnostics;
}

function ids(body: string, extra = "", parameter = ""): string[] {
  return compiled(body, extra, parameter).map((entry) => entry.id);
}

function outcomes(body: string, extra = "", parameter = ""): string[] {
  return ids(body, extra, parameter).filter((id) => id === "BANK-FILE-017");
}

/** The messages of the outcome diagnostics, for the cases that check wording. */
function messages(body: string, extra = ""): string[] {
  return compiled(body, extra)
    .filter((entry) => entry.id === "BANK-FILE-017")
    .map((entry) => `${entry.message} ${entry.hint ?? ""}`);
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

  /**
   * The status inside a compound condition.
   *
   * `comparedNames` walks into the operands of an `AND` for this. Mutating the
   * walk away left every earlier test passing, because they all read the status
   * at the top of the condition.
   */
  it("a status tested alongside something else", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" && line.feedAmount > 0.00 {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("a status tested in one arm of an or", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if master.masterBalance > 0.00 || feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  /** A negated test is a test: `NullableCheck` and `Not` carry an operand. */
  it("a status tested through a negation", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if !(feedInStatus == "10") {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("a status tested inside a call's argument", () => {
    expect(
      clean(
        `  open feedIn;
  read feedIn into line;
  if arrived(feedInStatus == "00") {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`,
        `
function arrived(ok: bool): bool {
  return ok;
}
`,
      ),
    ).toEqual([]);
  });

  /** The end-of-file path abandons the work; the success path uses the record. */
  it("an end-of-file path that leaves", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if feedInStatus == "10" {
    raise "NOTHING_TO_DO";
  }
  log "ACCOUNT ", line.feedAccount;
  close feedIn;`),
    ).toEqual([]);
  });

  /** The same shape in a function, where the early exit is a `return`. */
  it("an early return after the status was tested", () => {
    const result = compile(
      `${PREAMBLE}
function firstAccount(line: Feed): string<16> {
  read feedIn into line;
  if feedInStatus == "10" {
    return "";
  }
  return line.feedAccount;
}

entry transaction handle(line: Feed, master: Master) {
  open feedIn;
  log "FIRST ", firstAccount(line);
  close feedIn;
  audit("HANDLED", master.idempotencyKey);
}`,
      { sourceFile: "outcomes.bank.ts" },
    );

    expect(
      result.diagnostics.filter((entry) => entry.id === "BANK-FILE-017"),
    ).toEqual([]);
  });

  it("a status mapped to a return code", () => {
    expect(
      clean(`  open store;
  write store from master;
  if storeStatus == "22" {
    returnCode = 4;
  }
  close store;`),
    ).toEqual([]);
  });

  /** Two nested loops, with the read tested in the inner one. */
  it("nested loops with the read tested inside", () => {
    expect(
      clean(`  open feedIn;
  while master.masterBalance > 0.00 limit 10 {
    while feedInStatus == "00" limit 1000 {
      read feedIn into line;
    }
    master.masterBalance = 0.00;
  }
  close feedIn;`),
    ).toEqual([]);
  });

  /** A sequential rewrite has no status the program is left to branch on. */
  it("a rewrite on a sequential file", () => {
    expect(
      clean(`  open amend;
  read amend into line;
  if amendStatus == "00" {
    rewrite amend from line;
  }
  close amend;`),
    ).toEqual([]);
  });

  /** The guarded form of the write this check exists to catch. */
  it("a write from the record after the status was tested", () => {
    expect(
      clean(`  open feedIn;
  open trail;
  read feedIn into line;
  if feedInStatus == "00" {
    write trail from line;
  }
  close trail;
  close feedIn;`),
    ).toEqual([]);
  });

  /** A `for each` over an array in the record, after the status was tested. */
  it("a loop over the record's table after the status was tested", () => {
    expect(
      clean(`  open store;
  read store into master key line.feedAccount;
  if storeStatus == "00" {
    for each amount in master.amounts {
      log "AMOUNT ", amount;
    }
  }
  close store;`),
    ).toEqual([]);
  });

  /**
   * A file with no declared status is somebody else's diagnostic.
   *
   * `BANK-FILE-001` says the file has no status field, and this rule cannot say
   * anything at all about a file whose outcome has nowhere to land — so it must
   * not add a second, more confusing report on top.
   */
  it("a file with no status at all", () => {
    const result = compile(
      `module Outcomes;

record Feed {
  feedAccount: string<16>;
  idempotencyKey: string<36>;
}

file feedIn sequential input record Feed;
file kept sequential input record Feed status keptStatus;

entry transaction handle(line: Feed) {
  open feedIn;
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;
  close feedIn;
  audit("HANDLED", line.idempotencyKey);
}`,
      { sourceFile: "outcomes.bank.ts" },
    );

    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-FILE-001",
    ]);
  });
});

/**
 * What the report says, not only that there is one.
 *
 * The status a statement can end with, what that status means, and the field to
 * branch on are the three things a reader needs, and all three were mutable
 * without a test noticing: emptying the table of meanings, returning `undefined`
 * from the mapping, and falling one case through in the table of expected
 * statuses each left the message plausible and wrong.
 */
describe("what the diagnostic says", () => {
  it("names end of file on a sequential read", () => {
    expect(
      messages(`  open feedIn;
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;`)[0],
    ).toContain("status 10 (end of file)");
  });

  it("names the missing record on a keyed read", () => {
    expect(
      messages(`  open store;
  read store into master key line.feedAccount;
  log "BALANCE ", master.masterBalance;`)[0],
    ).toContain("status 23 (no such record)");
  });

  it("names the duplicate key on an indexed write", () => {
    expect(
      messages(`  open store;
  write store from master;`)[0],
    ).toContain("status 22 (a duplicate key)");
  });

  it("names the missing record on a browse", () => {
    expect(
      messages(`  open store;
  start store key master.masterAccount;`)[0],
    ).toContain("status 23 (no such record)");
  });

  it("names the status field to branch on", () => {
    const message = messages(`  open feedIn;
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;`)[0];

    expect(message).toContain("without testing feedInStatus");
    expect(message).toContain('if feedInStatus == "00"');
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

/**
 * Which statements count as *using* what an operation left behind.
 *
 * Each of these was a surviving mutant: emptying the expression list for a
 * ledger posting, an assignment, a split or a keyed read changed nothing that
 * any test could see, which means the rule was not being checked there at all.
 * A posting made from a record that was never read is the defect this exists
 * for, so it is the one that most needed the test.
 */
describe("the statements that use a record", () => {
  /**
   * The status is tested *after* the use, and the `close` is gone.
   *
   * Both matter. With the test after it, the only thing left that can report is
   * the use itself — every one of these read `close feedIn;` at the end, and a
   * close on a pending file reports on its own, so mutating the use detection
   * away left them all passing. That is how "the record it read is used" came
   * to be checked by no test at all.
   */
  it("counts a ledger posting", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  debit(line.feedAccount, line.feedAmount);
  credit("CASH", line.feedAmount);
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts an assignment out of the record", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  master.masterAccount = line.feedAccount;
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts an assignment into the record", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  line.feedAccount = "OVERWRITTEN";
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a local declared from it", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  let taken: string<16> = line.feedAccount;
  log "TAKEN ", taken;
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a split of it", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  split line.feedAccount by "," into master.masterOne, master.masterTwo;
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a log of it", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  log "ACCOUNT ", line.feedAccount;
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a call of a function with it", () => {
    expect(
      outcomes(
        `  open feedIn;
  read feedIn into line;
  log "TRIMMED ", shortened(line.feedAccount);
  if feedInStatus == "00" {
    log "OK";
  }`,
        `
function shortened(account: string<16>): string<8> {
  return substring(account, 1, 8);
}
`,
      ),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts the key of another file's read", () => {
    expect(
      outcomes(`  open feedIn;
  open store;
  read feedIn into line;
  read store into master key line.feedAccount;
  if storeStatus == "00" {
    log "FOUND ", master.masterAccount;
  }
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts an audit correlation", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  audit("EARLY", line.idempotencyKey);
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a condition that reads it", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if line.feedAmount > 0.00 {
    log "POSITIVE";
  }
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a loop condition that reads it", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  while line.feedAmount > 0.00 limit 10 {
    line.feedAmount = line.feedAmount - 1.00;
  }
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * A routine that ends with the outcome outstanding, and nothing having used the
 * record at all. Every other fail case above reports through the record; this
 * one reports through the end of the routine, and mutating that check away left
 * every test still passing.
 */
describe("reaching the end with the outcome outstanding", () => {
  it("reports a transaction that read and never looked", () => {
    const result = compile(
      `${PREAMBLE}
entry transaction handle(line: Feed, master: Master) {
  open feedIn;
  read feedIn into line;
  close feedIn;
  audit("HANDLED", master.idempotencyKey);
}`,
      { sourceFile: "outcomes.bank.ts" },
    );
    expect(
      result.diagnostics.filter((entry) => entry.id === "BANK-FILE-017"),
    ).toHaveLength(1);
  });
});

/** The outcomes of the operations the earlier cases did not reach. */
describe("every operation that leaves an outcome", () => {
  it("reports a rewrite on an indexed file", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  if storeStatus == "00" {
    rewrite store from master;
  }
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("reports a delete on an indexed file", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  if storeStatus == "00" {
    delete store key master.masterAccount;
  }
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * The record moved out by name rather than read through an expression.
 *
 * COBOL hands whole records to things — a file, a sort, a queue, another
 * program — by naming them, and none of that goes through an expression. So
 * none of it counted, and `read feedIn into line; write trail from line;` — the
 * stale record posted straight back out, which is the defect the rule was
 * written for and the one OpenCBS records five times over — reported nothing.
 */
describe("the record a statement names", () => {
  it("counts a write of it to another file", () => {
    expect(
      outcomes(`  open feedIn;
  open trail;
  read feedIn into line;
  write trail from line;
  if feedInStatus == "00" {
    log "OK";
  }
  close trail;
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a rewrite of it", () => {
    expect(
      outcomes(`  open amend;
  read amend into line;
  rewrite amend from line;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a release of it into a sort", () => {
    expect(
      outcomes(`  sort otherIn into trail on feedAccount
    input line {
      read feedIn into line;
      release line;
    };`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a put of it onto a queue", () => {
    expect(
      outcomes(`  open feedIn;
  connectQueue feedQueue;
  read feedIn into line;
  putMessage feedQueue from line;
  if feedInStatus == "00" {
    log "OK";
  }
  disconnectQueue feedQueue;
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a checkpoint written from it", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  checkpoint store from master every 1000;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a loop over a table inside it", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  for each amount in master.amounts {
    log "AMOUNT ", amount;
  }
  if storeStatus == "00" {
    log "OK";
  }
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a search of a table inside it", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  search amount in master.amounts where amount > 0.00 {
    log "FOUND";
  } else {
    log "NONE";
  }
  if storeStatus == "00" {
    log "OK";
  }
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * The statements whose expressions nobody had classified.
 *
 * The list used to end in a `default: return []`, which is an exemption written
 * as an oversight: `call "SUB" using line` hands the stale record to another
 * program, `json out from line` publishes it, and neither was a use.
 */
describe("the expressions a statement evaluates", () => {
  it("counts a call that passes it on", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  call "BANKSUB" using line on error {
    returnCode = 12;
  };
  if feedInStatus == "00" {
    log "OK";
  }
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a JSON generate of it", () => {
    expect(
      outcomes(
        `  open store;
  read store into master key line.feedAccount;
  json payload.body from master;
  if storeStatus == "00" {
    log "OK";
  }
  close store;`,
        `
record Payload {
  body: string<200>;
}
`,
        "payload: Payload",
      ),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("counts a return code computed from it", () => {
    expect(
      outcomes(`  open store;
  read store into master key line.feedAccount;
  returnCode = master.masterCount;
  if storeStatus == "00" {
    log "OK";
  }
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * Blocks the walk did not reach.
 *
 * `on page` is the one the key-based traversal missed outright: a `write ...
 * on page { ... }` carries a block, `atEndOfPage` was in the list of names it
 * looked up, and it never called the lookup for a file statement at all.
 */
describe("blocks a statement runs", () => {
  it("reaches inside an on-page block", () => {
    expect(
      outcomes(`  open store;
  open printOut;
  read store into master key line.feedAccount;
  write printOut from line advancing 1 on page {
    log "BALANCE ", master.masterBalance;
  };
  if storeStatus == "00" {
    log "OK";
  }
  close printOut;
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("reports an outcome an on-page block leaves outstanding", () => {
    expect(
      outcomes(`  open store;
  open printOut;
  write printOut from line advancing 1 on page {
    read store into master key master.masterAccount;
    log "BALANCE ", master.masterBalance;
  };
  close printOut;
  close store;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("reaches inside a sort's output procedure", () => {
    expect(
      outcomes(`  sort feedIn into trail on feedAccount
    output line {
      read otherIn into line;
      write trail from line;
    };`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("reaches inside a call's error block", () => {
    expect(
      outcomes(`  open feedIn;
  call "BANKSUB" using master on error {
    read feedIn into line;
    log "ACCOUNT ", line.feedAccount;
  };
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  it("reaches inside a search's not-found branch", () => {
    expect(
      outcomes(`  open feedIn;
  search amount in master.amounts where amount > 0.00 {
    log "FOUND";
  } else {
    read feedIn into line;
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * The two handlers, which run outside the flow the body's walk describes.
 *
 * A transaction's `on failure` block is entered from a `raise` anywhere inside
 * the body, so nothing the body owed is known there — but the handler's own
 * operations are its own, and a recovery path that reads a file and posts what
 * it found owes exactly the answer the body would. Neither handler was walked.
 */
describe("handlers", () => {
  it("reports an outcome a failure handler leaves outstanding", () => {
    const result = compile(
      `${PREAMBLE}
entry transaction handle(line: Feed, master: Master) {
  on failure {
    read feedIn into line;
    log "ACCOUNT ", line.feedAccount;
  }
  open feedIn;
  raise "NO_GOOD";
}`,
      { sourceFile: "outcomes.bank.ts" },
    );

    expect(
      result.diagnostics.filter((entry) => entry.id === "BANK-FILE-017"),
    ).toHaveLength(1);
  });

  it("reports an outcome a file error handler leaves outstanding", () => {
    expect(
      outcomes(
        `  open feedIn;
  read feedIn into line;
  if feedInStatus == "00" {
    log "ACCOUNT ", line.feedAccount;
  }
  close feedIn;`,
        `
on error feedIn {
  start store key "0000000000000001";
}
`,
      ),
    ).toEqual(["BANK-FILE-017"]);
  });
});

/**
 * A fact is discharged after a branch only when every path through it
 * discharged it, which is the whole reason this is a walk rather than a scan.
 */
describe("merging the state at a join", () => {
  it("is clean when both branches test the status", () => {
    expect(
      clean(`  open feedIn;
  read feedIn into line;
  if master.masterBalance > 0.00 {
    if feedInStatus == "00" {
      log "POSITIVE ", line.feedAccount;
    }
  } else {
    if feedInStatus == "00" {
      log "OTHER ", line.feedAccount;
    }
  }
  close feedIn;`),
    ).toEqual([]);
  });

  it("reaches inside a switch", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  switch chosen {
    case ONE {
      log "ONE ", line.feedAccount;
    }
    case TWO {
      log "TWO ", line.feedAccount;
    }
  }
  if feedInStatus == "00" {
    log "OK";
  }`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /**
   * One branch discharges it and there is no `else`, so the other path arrives
   * with it still outstanding — and the merge has to keep it. Mutating the
   * merge to return the first state left every earlier case passing, because
   * every earlier case had the same answer on both paths.
   */
  it("keeps an outcome one branch left outstanding", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if master.masterBalance > 0.00 {
    if feedInStatus == "00" {
      log "TESTED";
    }
  }
  log "ACCOUNT ", line.feedAccount;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** The same the other way round: the `else` discharges and the `then` does not. */
  it("keeps an outcome the else branch discharged and the then did not", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if master.masterBalance > 0.00 {
    log "POSITIVE";
  } else {
    if feedInStatus == "00" {
      log "TESTED";
    }
  }
  log "ACCOUNT ", line.feedAccount;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /**
   * A branch that ends the path arrives at the join with nothing at all, so the
   * merge takes the other path's state wholesale — the `!existing` arm, which
   * no earlier case reached.
   */
  it("keeps an outcome from the path that did not end", () => {
    expect(
      outcomes(`  open feedIn;
  read feedIn into line;
  if master.masterBalance > 0.00 {
    raise "NOTHING_TO_DO";
  }
  log "ACCOUNT ", line.feedAccount;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /**
   * A switch whose *first* case leaves an outcome outstanding and whose last
   * discharges nothing of the sort. Merging only the last branch's state — or
   * dropping the merge back into the head state — loses it.
   */
  it("keeps an outcome an earlier case left outstanding", () => {
    expect(
      outcomes(`  open feedIn;
  switch chosen {
    case ONE {
      read feedIn into line;
    }
    case TWO {
      log "NOTHING";
    }
  }
  log "ACCOUNT ", line.feedAccount;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /** An outcome a loop body left outstanding is still outstanding after it. */
  it("keeps an outcome a loop body left outstanding", () => {
    expect(
      outcomes(`  open feedIn;
  while master.masterBalance > 0.00 limit 10 {
    read feedIn into line;
    master.masterBalance = 0.00;
  }
  log "ACCOUNT ", line.feedAccount;`),
    ).toEqual(["BANK-FILE-017"]);
  });

  /**
   * Two files, each with an outcome outstanding, and each reported once. A
   * merge that let one file's state stand in for another's would report one.
   */
  it("keeps both files' outcomes apart", () => {
    expect(
      outcomes(`  open feedIn;
  open store;
  read feedIn into line;
  start store key master.masterAccount;`),
    ).toEqual(["BANK-FILE-017", "BANK-FILE-017"]);
  });
});
