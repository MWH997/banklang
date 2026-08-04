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
const sources = import.meta.glob("../../../examples/*/src/main.bank.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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
};

function idFromPath(path: string): string {
  return path.split("/examples/")[1]?.split("/")[0] ?? path;
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
