# BankLang

**A deterministic compiler from a restricted TypeScript-like language to
readable IBM Enterprise COBOL — with banking safety rules enforced at compile
time.**

[![CI](https://github.com/MWH997/banklang/actions/workflows/ci.yml/badge.svg)](https://github.com/MWH997/banklang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg)](https://nodejs.org)

BankLang compiles **BankTS**, a deliberately small TypeScript-like language,
into COBOL that a mainframe engineer can read and review. It is a compiler, not
an AI converter: no model decides what code is generated, and the same input
always produces byte-identical output.

The interesting part is not the translation. It is that the compiler **refuses
to compile financially unsafe programs**.

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

Retries that post twice, money movement with no audit trail, and unbalanced
ledger postings become compile errors instead of production incidents.

**Validated with GnuCOBOL, not IBM.** Every example compiles in CI under a
GnuCOBOL configuration shaped to Enterprise COBOL 6.4 and under GnuCOBOL's own
default. No IBM Enterprise COBOL validation has been performed, and none is
claimed.

**[Read this first →](docs/getting-started.md)** ·
**[If you have to accept the output →](docs/for-mainframe-engineers.md)** ·
**[What it does not do →](docs/status-and-limits.md)**

---

## Try it

```bash
pnpm install && pnpm playground:dev
```

The **[playground](packages/playground/)** runs the entire compiler in your
browser — no server, no network call. Click any line of BankTS and the COBOL it
produced lights up, straight from the emitted source map: traceability you can
click rather than a claim in the documentation.

## What it generates

From one BankTS module, `bankc build` emits a COBOL program, a copybook per
record, the JCL to build and run it, a source map covering every module, record,
field, function and transaction, and an audit bundle.

Interest accrual, in full:

```ts
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}
```

`MoneyBDT` is `decimal<18, 2>` and `Rate` is `decimal<9, 4>`, so the product has
scale 6. Storing it as money discards four digits, and the compiler will not do
that silently: `round` with an explicit mode is required.

Enterprise COBOL has **one** rounding phrase, and `ROUNDED` is half-up away from
zero. Banker's rounding is arithmetic this compiler writes out:

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

That sequence is executed and compared against exact arithmetic over every
boundary case, for a product and for a quotient, in all seven modes. See
[the numeric model](docs/numeric-model.md) and
[`rounding-conformance`](examples/rounding-conformance/).

## Safety rules the compiler enforces

| Diagnostic      | Rule                                                          |
| --------------- | ------------------------------------------------------------- |
| `BANK-TXN-001`  | A transaction must carry an idempotency key                   |
| `BANK-AUD-001`  | A transaction must emit at least one audit event              |
| `BANK-LED-001`  | Debits and credits must balance                               |
| `BANK-DEC-003`  | A division must state its rounding mode                       |
| `BANK-SQL-007`  | A `SQLCODE` test must separate an error from a missing row    |
| `BANK-SQL-008`  | A commit inside a cursor loop needs a `hold` cursor           |
| `BANK-CICS-004` | A CICS response must be tested against its condition name     |
| `BANK-AUD-002`  | A `sensitive` field must not reach an audit event or a ledger |

`bankc explain BANK-LED-001` prints any of them, and no diagnostic can be
emitted without a catalogue entry. [The full catalogue →](docs/diagnostics.md)

## Quick start

Requires **Node.js 24+** and pnpm 11.7.0. GnuCOBOL is optional locally.

```bash
pnpm bankc init    my-service                 # scaffold a project
pnpm bankc check   examples/account-posting   # diagnostics only
pnpm bankc build   examples/account-posting   # full artifact bundle
pnpm bankc verify  examples/account-posting   # determinism + coverage
pnpm bankc test    examples/account-posting   # the above, plus cobc
pnpm bankc job     examples/end-of-day-settlement  # several programs, one job
pnpm bankc explain BANK-LED-001               # explain a diagnostic

pnpm bankc analyse  legacy/                   # what your COBOL contains
pnpm bankc copybook import ACCTMAST.cpy       # your record, as BankTS
pnpm bankc dclgen   import ACCOUNT.cpy        # your table, as BankTS
```

Add `--watch` to any command to rerun on save.
[The whole toolchain →](docs/toolchain.md)

## Examples

Each with a checked-in [evidence bundle](evidence/) holding its generated
artifacts and verification report.

**The language**

| Example                                                          | Demonstrates                                    |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| [`account-transfer`](examples/account-transfer/)                 | Records, decimal aliases, a validation function |
| [`account-posting`](examples/account-posting/)                   | Transactions, ledger postings, audit events     |
| [`account-file-batch`](examples/account-file-batch/)             | Sequential files, `FILE-CONTROL` and `FD`       |
| [`batch-interest-accrual`](examples/batch-interest-accrual/)     | Locals, exact decimal arithmetic, `if`/`else`   |
| [`withdrawal-with-recovery`](examples/withdrawal-with-recovery/) | Inheritance, `raise` / `on failure`, **run**    |
| [`statement-generation`](examples/statement-generation/)         | Indexed files, enums, tables, nullables         |
| [`interest-posting-batch`](examples/interest-posting-batch/)     | Rounding, tiered rates, a fee that can refuse   |
| [`amortisation-schedule`](examples/amortisation-schedule/)       | Recursion as a `RECURSIVE` program              |
| [`rounding-conformance`](examples/rounding-conformance/)         | All seven rounding modes, both signs            |

**The subsystems**

| Example                                                    | Demonstrates                                |
| ---------------------------------------------------------- | ------------------------------------------- |
| [`online-enquiry`](examples/online-enquiry/)               | CICS, commarea, Db2, three-outcome SQL      |
| [`branch-accrual-cursor`](examples/branch-accrual-cursor/) | Db2 cursors, bounded row loops, **run**     |
| [`vsam-browse`](examples/vsam-browse/)                     | `START` / `READ NEXT` on an alternate index |
| [`mq-request-reply`](examples/mq-request-reply/)           | A queue drained under syncpoint             |
| [`report-with-controls`](examples/report-with-controls/)   | Report Writer: control breaks and totals    |

**When it goes wrong**

| Example                                              | Demonstrates                              |
| ---------------------------------------------------- | ----------------------------------------- |
| [`failed-open`](examples/failed-open/)               | File status 35, 37 and 39 named apart     |
| [`full-disk`](examples/full-disk/)                   | A `WRITE` out of extents, halfway through |
| [`deadlock-retry`](examples/deadlock-retry/)         | Db2 -911 and -913, bounded retry          |
| [`high-volume-master`](examples/high-volume-master/) | A file bigger than the loop bound         |

**A night**

| Example                                                    | Demonstrates                                   |
| ---------------------------------------------------------- | ---------------------------------------------- |
| [`parm-driven-batch`](examples/parm-driven-batch/)         | The PARM convention, restart and checkpoint    |
| [`end-of-day-settlement`](examples/end-of-day-settlement/) | Four programs and a sort in **one JCL stream** |

**And five conversions** — [`conversions/`](conversions/) — existing COBOL on one
side, the BankTS it becomes on the other, and what the compiler produced from
that BankTS underneath: a sequential master update, a CICS enquiry, a Db2 cursor
batch, hand-written banker's rounding, and a copybook with `REDEFINES`, `FILLER`
and `OCCURS DEPENDING ON`. Each page says what the conversion changed.

`withdrawal-with-recovery` is **run**, against the reference runtime in
[`runtime/`](runtime/README.md), and the test asserts on the balances the ledger
ends up holding. That is what catches a defect that compiles — the bounds guard
once clamped an out-of-range subscript instead of refusing it, and every static
check passed.

## Documentation

**Start here**

| Document                                                   | Contents                                     |
| ---------------------------------------------------------- | -------------------------------------------- |
| [Getting started](docs/getting-started.md)                 | Thirty minutes from clone to reading COBOL   |
| [For mainframe engineers](docs/for-mainframe-engineers.md) | The generated COBOL, construct by construct  |
| [Status and honest limits](docs/status-and-limits.md)      | What this is not                             |
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
| [Language reference](docs/language-reference.md) | The BankTS subset               |
| [Diagnostics](docs/diagnostics.md)               | The full catalogue              |
| [Architecture](docs/architecture.md)             | Pipeline, packages, `compile()` |
| [Verification](docs/verification.md)             | Testing and evidence strategy   |
| [Security and data](docs/security-and-data.md)   | `sensitive`, PII, dumps         |
| [Toolchain](docs/toolchain.md)                   | CLI, formatter, CI, editors     |
| [Migration analysis](docs/migration-analysis.md) | Reading COBOL you already have  |
| [Glossary](docs/glossary.md)                     | Compiler and mainframe terms    |
| [Roadmap](docs/roadmap.md)                       | What is planned                 |
| [ADRs](docs/adr/)                                | Architectural decisions         |

## Status

A working compiler for a **deliberately narrow subset**, not a production
mainframe toolchain. It has been validated with GnuCOBOL and **not** with IBM
Enterprise COBOL; it has never run against a real ledger; and no institution's
money has moved through it.

[The full list, with what each limit costs →](docs/status-and-limits.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: small changes, real
tests, no silent golden updates, and never claim validation that did not happen.

## License

[MIT](LICENSE)
