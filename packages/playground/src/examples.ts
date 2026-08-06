export interface PlaygroundExample {
  id: string;
  title: string;
  blurb: string;
  source: string;
}

/**
 * Example sources are pulled from `examples/` at build time, so the playground
 * always shows the same programs the test suite and evidence bundles use.
 */
const sources = {
  ...(import.meta.glob("../../../examples/*/src/main.bank.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  // A job directory holds a program per subdirectory rather than a `src/` of
  // its own, so the picker needs both depths or the several-program example is
  // the one thing the playground cannot show.
  ...(import.meta.glob("../../../examples/*/*/src/main.bank.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
};

const META: Record<string, { title: string; blurb: string; order: number }> = {
  "account-transfer": {
    title: "Account transfer",
    blurb:
      "The baseline slice: a record, a decimal type alias, and a validation function.",
    order: 1,
  },
  "batch-interest-accrual": {
    title: "Batch interest accrual",
    blurb:
      "Local variables, exact decimal arithmetic, and deterministic if/else lowering.",
    order: 2,
  },
  "account-posting": {
    title: "Account posting",
    blurb:
      "A transaction with balanced debit and credit postings plus an audit event.",
    order: 3,
  },
  "account-file-batch": {
    title: "Account file batch",
    blurb:
      "Sequential file declarations producing FILE-CONTROL and FD sections.",
    order: 4,
  },
  "interest-posting-batch": {
    title: "Interest posting batch",
    blurb:
      "A batch that reads accounts, accrues interest, and posts both sides of each entry.",
    order: 5,
  },
  "amortisation-schedule": {
    title: "Amortisation schedule",
    blurb:
      "A bounded array walked with `for each`, lowering to PERFORM VARYING over an OCCURS table.",
    order: 6,
  },
  "statement-generation": {
    title: "Statement generation",
    blurb:
      "Enums, nullable values, an indexed file, and `sensitive` fields that cannot reach a log.",
    order: 7,
  },
  "withdrawal-with-recovery": {
    title: "Withdrawal with recovery",
    blurb:
      "Record inheritance, `raise` with an `on failure` handler, and a ledger rollback. Executed in CI.",
    order: 8,
  },
  "online-enquiry": {
    title: "Online enquiry",
    blurb:
      "A CICS transaction reading Db2: COMMAREA input, SQLCODE handling, and syncpoint or rollback.",
    order: 9,
  },
  "branch-accrual-cursor": {
    title: "Branch accrual cursor",
    blurb:
      "A Db2 cursor read with a bounded loop. The OPEN and CLOSE are generated, so it cannot be left open.",
    order: 10,
  },
  "parm-driven-batch": {
    title: "PARM-driven batch",
    blurb:
      "The batch entry convention: the job's PARM behind its halfword length, validated, with a restart position.",
    order: 11,
  },
  "high-volume-master": {
    title: "High-volume master",
    blurb:
      "A file bigger than the loop bound. Running out of bound and running out of file end the step differently.",
    order: 12,
  },
  "rounding-conformance": {
    title: "Rounding conformance",
    blurb:
      "All seven rounding modes over the same tie, both signs. Five of them are arithmetic the compiler writes out.",
    order: 13,
  },
  "failed-open": {
    title: "Failed open",
    blurb:
      "What an OPEN that fails looks like: 35, 37 and 39 named apart, and a USE declarative behind them.",
    order: 14,
  },
  "full-disk": {
    title: "Full disk",
    blurb:
      "A WRITE that runs out of extents halfway through, and the message that lets the rerun start from the right record.",
    order: 15,
  },
  "deadlock-retry": {
    title: "Deadlock retry",
    blurb:
      "Db2 -911 and -913 told apart from a real error, retried a bounded number of times with an explicit rollback.",
    order: 16,
  },
  "vsam-browse": {
    title: "VSAM browse",
    blurb:
      "START and READ NEXT on an alternate index, with the walk stopping itself when the key stops matching.",
    order: 17,
  },
  "mq-request-reply": {
    title: "MQ request/reply",
    blurb:
      "A queue drained under syncpoint, where a get has three outcomes and the empty one is not a failure.",
    order: 18,
  },
  "report-with-controls": {
    title: "Report with control breaks",
    blurb:
      "Report Writer: subtotals, a grand total and page headings, none of which the source adds up itself.",
    order: 19,
  },
  "end-of-day-settlement/extract": {
    title: "End of day: extract",
    blurb:
      "Step one of a four-step night. Selects what settles and posts nothing, so a bad selection can be rerun.",
    order: 20,
  },
  "end-of-day-settlement/post": {
    title: "End of day: post",
    blurb:
      "Step three. The one step that cannot simply be rerun, so it is the one that keeps a restart position.",
    order: 21,
  },
  "end-of-day-settlement/report": {
    title: "End of day: report",
    blurb:
      "Step four. Control breaks written by hand with LINAGE pagination, and the last branch total that has no successor to trigger it.",
    order: 22,
  },
  "zunit-tested-posting": {
    title: "A program with a test case",
    blurb:
      "A test written next to the program, in the same language, which becomes a zUnit case that runs on z/OS and compiles to nothing here.",
    order: 23,
  },
};

function idFromPath(path: string): string {
  return path.split("/examples/")[1]?.replace("/src/main.bank.ts", "") ?? path;
}

export const EXAMPLES: PlaygroundExample[] = Object.entries(sources)
  .map(([path, source]) => {
    const id = idFromPath(path);
    const meta = META[id];
    return {
      id,
      title: meta?.title ?? id,
      blurb: meta?.blurb ?? "",
      source,
      order: meta?.order ?? 99,
    };
  })
  .sort((left, right) => left.order - right.order)
  .map(({ order: _order, ...example }) => example);

/**
 * A deliberately broken program, so a visitor can see the banking safety
 * diagnostics fire without having to write one.
 */
export const BROKEN_EXAMPLE: PlaygroundExample = {
  id: "unsafe-posting",
  title: "Unsafe posting (fails on purpose)",
  blurb:
    "No idempotency key, no audit event, and the credit does not match the debit.",
  source: `module UnsafePosting;

type MoneyBDT = decimal<18, 2>;

record Posting {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  fee: MoneyBDT;
}

// Every banking safety rule below is violated on purpose.
transaction postTransfer(request: Posting) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee);
}
`,
};

export const ALL_EXAMPLES: PlaygroundExample[] = [...EXAMPLES, BROKEN_EXAMPLE];
