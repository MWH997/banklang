# BankLang

**[banklang.mwhassan.com](https://banklang.mwhassan.com)**. The compiler runs
in your browser at [/playground/](https://banklang.mwhassan.com/playground/).

**A compiler for banking programs.** You write BankTS; it emits IBM Enterprise
COBOL that a mainframe engineer can read and sign off.

[![CI](https://github.com/MWH997/banklang/actions/workflows/ci.yml/badge.svg)](https://github.com/MWH997/banklang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg)](https://nodejs.org)

BankTS borrows TypeScript's type syntax; its statements (`transaction`, `file`,
`cursor`, `queue`) are its own. No AI is involved anywhere, and the same input
always produces byte-identical output.

COBOL is good with money: amounts are packed decimal, exact to the penny. It
knows nothing about bookkeeping. A transaction whose debits and credits do not
match is, to a COBOL compiler, correct arithmetic. This one **refuses to build
it**.

```ts
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.fee); // ← a different amount
}
```

```txt
BANK-TXN-001  Transaction postTransfer has no idempotency key.
BANK-AUD-001  Transaction postTransfer does not emit an audit event.
BANK-LED-001  Transaction postTransfer does not balance:
              debited request.amount against credited request.fee.
```

Three compile errors, so the build stops and writes nothing: a retry that could
post twice, money moving unrecorded, and a total that does not add up.

**Validated with GnuCOBOL, not IBM.** Every example compiles in CI under a
GnuCOBOL configuration shaped to Enterprise COBOL 6.4 and under GnuCOBOL's own
default. No IBM Enterprise COBOL validation is claimed.

**Built with AI assistance.** The design and the decisions are the author's;
much of the implementation was written with an AI coding assistant under review.
There is no AI inside the compiler itself, at build time or at run time.

**[Read this first →](docs/getting-started.md)** ·
**[If you have to accept the output →](docs/for-mainframe-engineers.md)** ·
**[What it does not do →](docs/status-and-limits.md)**

---

## Try it

**[Open the playground](https://banklang.mwhassan.com/playground/)**: nothing
to install, and nothing you write is sent anywhere.

Click a line of BankTS and the COBOL it produced lights up, from the source map.
Fill in the entry record or dataset on **Input**, then **Run** executes it
against the reference runtime in [`runtime/`](runtime/README.md) and shows the
postings. Locally: `pnpm install && pnpm playground:dev`.

## What it generates

From one BankTS module, `bankc build` emits a COBOL program, a copybook per
record, the JCL to build and run it, a source map, and an audit bundle.

Interest accrual, in full:

```ts
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}
```

`MoneyBDT` is `decimal<18, 2>` and `Rate` is `decimal<9, 4>`, so the product has
scale 6. Storing it as money would discard four digits, so `round` with an
explicit mode is required.

Enterprise COBOL offers **one** rounding phrase, and `ROUNDED` rounds a half
away from zero. Banker's rounding has to be written out as arithmetic:

```cobol
           EVALUATE TRUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) > 0.005
                   ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) = 0.005
                   IF FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1
                       ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
                   END-IF
           END-EVALUATE
```

That sequence is executed against exact arithmetic over every boundary case, for
a product and a quotient, in all seven modes.
[The numeric model →](docs/numeric-model.md)

## Safety rules the compiler enforces

| Diagnostic      | Rule                                                        |
| --------------- | ----------------------------------------------------------- |
| `BANK-TXN-001`  | A transaction must carry an idempotency key                 |
| `BANK-AUD-001`  | A transaction must emit at least one audit event            |
| `BANK-LED-001`  | Debits and credits must balance                             |
| `BANK-DEC-003`  | A division must state its rounding mode                     |
| `BANK-SQL-007`  | A `SQLCODE` test must separate an error from a missing row  |
| `BANK-CICS-004` | A CICS response must be tested against its condition name   |
| `BANK-AUD-002`  | A `sensitive` field must not reach an audit event or ledger |

`bankc explain BANK-LED-001` prints any of them, and no diagnostic can be
emitted without a catalogue entry. [The full catalogue →](docs/diagnostics.md)

## Quick start

Node.js 24+ and pnpm 11.7.0. GnuCOBOL is optional locally.

```bash
pnpm bankc init    my-service                 # scaffold a project
pnpm bankc check   examples/account-posting   # diagnostics only
pnpm bankc build   examples/account-posting   # full artifact bundle
pnpm bankc verify  examples/account-posting   # determinism + coverage
pnpm bankc test    examples/account-posting   # the above, plus cobc
pnpm bankc job     examples/end-of-day-settlement  # several programs, one job
pnpm bankc explain BANK-LED-001               # explain a diagnostic

pnpm bankc analyse  legacy/                   # inventory + dependency graphs
pnpm bankc copybook import ACCTMAST.cpy       # your record, as BankTS
```

Add `--watch` to any command that reads a project to rerun it on save. The rest
refuse it and name the ones that take it.
[The whole toolchain →](docs/toolchain.md)

## Examples

Each with a checked-in [evidence bundle](evidence/): its artifacts and the
report over them.

**The language**

| Example                                                          | Demonstrates                                  |
| ---------------------------------------------------------------- | --------------------------------------------- |
| [`account-transfer`](examples/account-transfer/)                 | Records, decimal aliases, a validator         |
| [`account-posting`](examples/account-posting/)                   | Transactions, ledger postings, audit events   |
| [`account-file-batch`](examples/account-file-batch/)             | Sequential files, `FILE-CONTROL` and `FD`     |
| [`batch-interest-accrual`](examples/batch-interest-accrual/)     | Locals, exact decimal arithmetic, `if`/`else` |
| [`withdrawal-with-recovery`](examples/withdrawal-with-recovery/) | Inheritance, `raise` / `on failure`, **run**  |
| [`statement-generation`](examples/statement-generation/)         | Indexed files, enums, tables, nullables       |
| [`interest-posting-batch`](examples/interest-posting-batch/)     | Rounding, tiered rates, a fee that can refuse |
| [`amortisation-schedule`](examples/amortisation-schedule/)       | Recursion as a `RECURSIVE` program            |
| [`rounding-conformance`](examples/rounding-conformance/)         | All seven rounding modes, both signs          |
| [`payment-feed-import`](examples/payment-feed-import/)           | `lineSequential` text from off the mainframe  |
| [`settlement-bill-file`](examples/settlement-bill-file/)         | Header, detail and trailer in one output file |
| [`zunit-tested-posting`](examples/zunit-tested-posting/)         | A `test` beside the program it covers         |

**The subsystems**

| Example                                                    | Demonstrates                                |
| ---------------------------------------------------------- | ------------------------------------------- |
| [`online-enquiry`](examples/online-enquiry/)               | CICS, commarea, Db2, three-outcome SQL      |
| [`branch-accrual-cursor`](examples/branch-accrual-cursor/) | `WITH HOLD`, checkpoint in a loop, **run**  |
| [`vsam-browse`](examples/vsam-browse/)                     | `START` / `READ NEXT` on an alternate index |
| [`mq-request-reply`](examples/mq-request-reply/)           | A queue drained under syncpoint             |
| [`report-with-controls`](examples/report-with-controls/)   | Report Writer: control breaks and totals    |

**When it goes wrong, and a night**

| Example                                                    | Demonstrates                                    |
| ---------------------------------------------------------- | ----------------------------------------------- |
| [`failed-open`](examples/failed-open/)                     | File status 35, 37 and 39 named apart           |
| [`full-disk`](examples/full-disk/)                         | A `WRITE` out of extents, halfway through       |
| [`deadlock-retry`](examples/deadlock-retry/)               | Db2 -911 and -913, bounded retry                |
| [`high-volume-master`](examples/high-volume-master/)       | A file bigger than the loop bound               |
| [`parm-driven-batch`](examples/parm-driven-batch/)         | The PARM convention, restart and checkpoint     |
| [`end-of-day-settlement`](examples/end-of-day-settlement/) | Three programs and a sort in **one JCL stream** |

**And five conversions** in [`conversions/`](conversions/): existing COBOL
beside the BankTS it becomes.

Every example is **run**, not only compiled. Three have hand-written expected
balances; the rest are executed twice, by `cobc` and by an interpreter written
against the same output, and a test fails on any disagreement. That catches a
defect that compiles: the bounds guard once clamped an out-of-range subscript
instead of refusing it, and every static check passed.

That lane covers 27 of the 31 COBOL verbs the backend emits. The other four are
a generated zUnit test case's entry points and a Report Writer section, neither
of which has anywhere local to run. [The grades →](evidence/GRADES.md)

## Documentation

**Start here**

| Document                                                   | Contents                                     |
| ---------------------------------------------------------- | -------------------------------------------- |
| [Getting started](docs/getting-started.md)                 | Thirty minutes from clone to reading COBOL   |
| [For mainframe engineers](docs/for-mainframe-engineers.md) | The generated COBOL, construct by construct  |
| [For the person deciding](docs/for-decision-makers.md)     | The risk, and what it would cost to find out |
| [Status and limits](docs/status-and-limits.md)             | What this is not                             |
| [Comparison](docs/comparison.md)                           | Against converters, Micro Focus, and by hand |

**The output**

| Document                                                     | Contents                                     |
| ------------------------------------------------------------ | -------------------------------------------- |
| [Generated code standards](docs/generated-code-standards.md) | The house style, as a contract               |
| [Target conformance](docs/target-conformance.md)             | The rules it obeys, with manual citations    |
| [Divergences](docs/divergences.md)                           | Where GnuCOBOL and Enterprise COBOL disagree |
| [Numeric model](docs/numeric-model.md)                       | Precision, scale, intermediates, rounding    |
| [Error handling](docs/error-handling.md)                     | Return codes, file status, SQLCODE, RESP     |
| [JCL model](docs/jcl-model.md)                               | The generated job, and what to change        |
| [COBOL backend](docs/cobol-backend.md)                       | Emission rules                               |

**The language and the compiler**

| Document                                         | Contents                        |
| ------------------------------------------------ | ------------------------------- |
| [Grammar](docs/language/grammar.md)              | Every production, in EBNF       |
| [Language stability](docs/language/stability.md) | What is settled and what is not |
| [Diagnostics](docs/diagnostics.md)               | The full catalogue              |
| [Architecture](docs/architecture.md)             | Pipeline, packages, `compile()` |
| [Verification](docs/verification.md)             | Testing and evidence strategy   |
| [Security and data](docs/security-and-data.md)   | `sensitive`, PII, dumps         |
| [Toolchain](docs/toolchain.md)                   | CLI, formatter, CI, editors     |
| [Migration analysis](docs/migration-analysis.md) | Reading COBOL you have          |
| [Glossary](docs/glossary.md)                     | Compiler and mainframe terms    |
| [Roadmap](docs/roadmap.md)                       | What is planned                 |

**Language reference**

| Document                               | Contents                      |
| -------------------------------------- | ----------------------------- |
| [Contents](docs/language-reference.md) | Which page holds which rule   |
| [Every construct](docs/language/)      | Records, files, SQL, CICS, MQ |

**Decisions**

| Document          | Contents                     |
| ----------------- | ---------------------------- |
| [ADRs](docs/adr/) | Why the compiler is as it is |

## Status

A working compiler for a **deliberately narrow subset**, not a production
mainframe toolchain. It has never run against a real ledger.

[The full list, with what each limit costs →](docs/status-and-limits.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md): small changes, real tests, no silent
golden updates, and never claim validation that did not happen.

## License

[MIT](LICENSE)
