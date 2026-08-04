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

## Try it

The **[playground](packages/playground/)** runs the entire compiler in your
browser — no server, no network call.

```bash
pnpm install && pnpm playground:dev
```

Click any line of BankTS and the COBOL it produced lights up, and vice versa.
That cross-link is read straight from the emitted source map, so traceability is
something you can click rather than something the documentation asserts.

## What it generates

From one BankTS module, `bankc build` emits:

| Artifact            | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| COBOL program       | Readable, stable names, no timestamps                       |
| Copybooks           | `PIC X(n)` and `COMP-3` layouts for every record            |
| Source map          | Every module, record, field, function, and transaction      |
| JCL skeleton        | A structurally sane job for the generated program           |
| Audit bundle        | Diagnostics, decimal analysis, transaction analysis, layout |
| Verification report | Determinism, source-map coverage, local compile results     |

Generated COBOL for the transaction example:

```cobol
       POST-TRANSFER.
           MOVE "DEBIT" TO BANK-LEDGER-OPERATION
           MOVE DEBIT-ACCOUNT OF TRANSFER-REQUEST TO BANK-LEDGER-ACCOUNT
           MOVE AMOUNT OF TRANSFER-REQUEST TO BANK-LEDGER-AMOUNT
           CALL "BANKLEDG" USING BANK-LEDGER-INTERFACE
```

Ledger and audit operations stop at a documented call boundary
([ADR-0003](docs/adr/0003-ledger-and-audit-calling-convention.md)). BankLang
does not own your ledger, so it does not invent posting logic.

## Safety rules the compiler enforces

| Diagnostic      | Rule                                                    |
| --------------- | ------------------------------------------------------- |
| `BANK-TXN-001`  | A transaction must carry an idempotency key             |
| `BANK-AUD-001`  | A transaction must emit at least one audit event        |
| `BANK-AUD-003`  | Audit event names must be compile-time constants        |
| `BANK-LED-001`  | Debits and credits must balance                         |
| `BANK-FILE-001` | A file declaration must bind a `FILE STATUS` field      |
| `BANK-GEN-00x`  | Every symbol must be traceable into the generated COBOL |

`BANK-LED-001` proves balance structurally, comparing posting expressions as
multisets. The compiler does not evaluate expressions, so the check is
deliberately conservative: it reports what it cannot prove rather than accepting
it.

Run `bankc explain BANK-LED-001` for any diagnostic. A test asserts that no
diagnostic can be emitted without a catalogue entry.

## The language

BankTS is small on purpose, but it covers what a posting or batch program
actually needs:

| Feature      | Surface                                                        |
| ------------ | -------------------------------------------------------------- |
| Comparison   | `<` `<=` `>` `>=` `==` `!=`                                    |
| Logic        | `&&` `\|\|` `!`                                                |
| Arithmetic   | `+` `-` `*`, and `divide(a, b, "HALF_EVEN")`                   |
| Rounding     | `round(expr, "MODE")` across seven COBOL rounding modes        |
| Control flow | `if` / `else`, `while ... limit <n>`, `for each`, `switch`     |
| Functions    | Declared, called, callable before declaration, recursive       |
| Types        | Records with `extends`, generics, enums, arrays, nullable      |
| Failures     | `raise "CODE"` with an `on failure` handler                    |
| Transactions | `debit`, `credit`, `audit`, field assignment, `entry`          |
| Files        | `open`, `read into`, `write from`, `close`, with status checks |

Interest accrual, in full:

```ts
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}
```

`MoneyBDT` is `decimal<18, 2>` and `Rate` is `decimal<9, 4>`, so the product has
scale 6. Storing it as money discards four digits, and the compiler will not let
that happen silently — `round` with an explicit mode is required. Bare division
is rejected outright for the same reason.

```cobol
       ACCRUE.
           COMPUTE ACCRUE-RESULT ROUNDED MODE IS NEAREST-EVEN = (ACCRUE-P1 * ACCRUE-P2)
           GOBACK.
```

Loops must declare a bound. An unbounded loop in a transaction is
`BANK-TXN-004`, and the limit becomes a real guard counter in the generated
COBOL, so a loop whose condition never goes false still terminates.

## Design constraints

Because money is involved, several ordinary conveniences are removed on purpose:

- **No binary floating point.** Money is `decimal<precision, scale>`, mapped to
  packed decimal (`COMP-3`).
- **No implicit coercion.** `decimal<18,2>` and `decimal<18,4>` do not mix
  without an explicit decision.
- **No dynamic semantics.** No `any`, no dynamic property access, no runtime
  mutation, no closures.
- **Deterministic output.** No timestamps, no random names, no
  filesystem-ordering dependence. `bankc verify` re-emits every artifact and
  fails if a single byte differs.

## Quick start

Requires **Node.js 24+** and pnpm 11.7.0. GnuCOBOL is optional locally and
installed in CI.

```bash
pnpm install
pnpm bankc init    my-service                 # scaffold a project
pnpm bankc check   examples/account-posting   # diagnostics only
pnpm bankc build   examples/account-posting   # full artifact bundle
pnpm bankc verify  examples/account-posting   # determinism + coverage
pnpm bankc test    examples/account-posting   # the above, plus cobc
pnpm bankc fmt     examples/account-posting   # format (--check for CI)
pnpm bankc explain BANK-LED-001               # explain a diagnostic
```

Add `--watch` to any command to rerun on save.

## Toolchain

Beyond the compiler, the things that make it usable day to day:

| Capability            | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| **Language server**   | Diagnostics as you type, hover, formatting, outline — over LSP |
| **VS Code extension** | Language client, TextMate grammar, editor configuration        |
| **Formatter**         | AST-printed, idempotent, comment-preserving                    |
| **SARIF output**      | `--format sarif` puts diagnostics inline on a pull request     |
| **Project config**    | `banklang.json` for entry, output, and backend profile         |
| **Scaffolding**       | `bankc init` produces a project that compiles first try        |
| **Watch mode**        | `--watch` on any command                                       |

Hover on a clean line reports which COBOL lines it generates, reading the same
source map the playground uses.

See [docs/toolchain.md](docs/toolchain.md).

## Examples

| Example                                                          | Demonstrates                                       |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| [`account-transfer`](examples/account-transfer/)                 | Records, decimal aliases, a validation function    |
| [`batch-interest-accrual`](examples/batch-interest-accrual/)     | Locals, exact decimal arithmetic, `if`/`else`      |
| [`account-posting`](examples/account-posting/)                   | Transactions, ledger postings, audit events        |
| [`account-file-batch`](examples/account-file-batch/)             | Sequential files, `FILE-CONTROL` and `FD` sections |
| [`withdrawal-with-recovery`](examples/withdrawal-with-recovery/) | Inheritance, `raise` / `on failure`, **executed**  |
| [`branch-accrual-cursor`](examples/branch-accrual-cursor/)       | Db2 cursors, bounded row loops, **executed**       |

Every example is compiled with GnuCOBOL in CI, and each has a checked-in
[evidence bundle](evidence/) holding its generated artifacts and verification
report.

`withdrawal-with-recovery` goes further: it is **run**, against the reference
runtime in [`runtime/`](runtime/README.md), and the test asserts on the balances
the ledger ends up holding. That is what catches a defect that compiles — the
bounds guard once clamped an out-of-range subscript instead of refusing it, and
every static check passed.

## Architecture

```txt
BankTS source
    ↓  parser              hand-written lexer and recursive-descent parser
    ↓  typechecker         type resolution, decimal rules
    ↓  ir                  typed representation carrying source spans
    ↓  semantic-analyzer   banking safety rules
    ↓  cobol-backend       COBOL, copybooks, JCL, source map
    ↓  verifier            determinism, source-map coverage
COBOL + audit bundle
```

| Package             | Role                                    |
| ------------------- | --------------------------------------- |
| `ast`, `parser`     | Tokens, nodes, source spans             |
| `typechecker`       | Type resolution and decimal rules       |
| `ir`, `cobol-ir`    | Lowered representation, COBOL naming    |
| `semantic-analyzer` | Banking safety diagnostics              |
| `cobol-backend`     | COBOL, JCL, and source-map emission     |
| `copybook`          | Layout, rendering, inspection, diffing  |
| `verifier`          | Determinism and source-map coverage     |
| `diagnostics`       | The diagnostic catalogue                |
| `compiler`          | One-call programmatic API, browser-safe |
| `bankc-cli`         | The `bankc` command                     |
| `playground`        | Browser playground                      |

Use the compiler programmatically:

```ts
import { compile } from "@banklang/compiler";

const result = compile(source);
result.diagnostics; // typed diagnostics with spans and hints
result.cobol; // the generated program
result.sourceMap; // every traced symbol
```

## Documentation

| Document                                         | Contents                        |
| ------------------------------------------------ | ------------------------------- |
| [Language reference](docs/language-reference.md) | The BankTS subset               |
| [Architecture](docs/architecture.md)             | Pipeline and package boundaries |
| [Diagnostics](docs/diagnostics.md)               | The full catalogue              |
| [COBOL backend](docs/cobol-backend.md)           | Emission rules                  |
| [Verification](docs/verification.md)             | Testing and evidence strategy   |
| [Glossary](docs/glossary.md)                     | Compiler and mainframe terms    |
| [Toolchain](docs/toolchain.md)                   | CLI, formatter, CI, editors     |
| [Roadmap](docs/roadmap.md)                       | What is planned                 |
| [ADRs](docs/adr/)                                | Architectural decisions         |

## Status and honest limits

This is a working compiler for a **deliberately narrow subset**, not a
production mainframe toolchain. Being precise about that matters more than
sounding impressive:

- **Validated with GnuCOBOL, not IBM.** Every example compiles with GnuCOBOL in
  CI. No IBM Enterprise COBOL validation has been performed, and none is
  claimed.
- **Not production-ready.** It has never run against a real ledger, and no
  institution's money has moved through it.
- **SQL and CICS are checked structurally, not semantically.** BankLang ships a
  precompiler that translates `EXEC SQL` and `EXEC CICS` the way `DSNHPC` and
  the CICS translator do, so every example compiles with GnuCOBOL. That proves
  the surrounding COBOL and every host variable resolve; it does not validate
  SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- **Executed only against a reference runtime, never IBM software.** The
  programs in [`runtime/`](runtime/README.md) satisfy the ledger, audit, SQL,
  and CICS interfaces well enough to run a generated program end to end and
  check its arithmetic. `BANKLEDG` is not a bank ledger. `DSNHLI` parses no SQL
  and `DFHEI1` provides no task or syncpoint: a test can script what they report,
  so a `SQLCODE 100` or a `PGMIDERR` branch is executed rather than assumed, but
  every such value was written down by the test, not decided by a database or a
  region. Nothing has run on z/OS, against Db2, or in a CICS region.
- **Generics are monomorphised, not polymorphic.** Every instantiation is
  expanded into a concrete record or paragraph, because COBOL has no boxing.
  Instantiated functions that lower to identical COBOL share one paragraph, so
  two currencies of the same precision cost one copy rather than two; anything
  that lowers differently, and every instantiated record, still costs its own.
- **Inheritance is layout first.** `extends` guarantees a derived record starts
  with the base record's exact bytes, which is what lets a copybook cut for the
  base read a derived record. Substitutability follows from that layout: a
  function's record parameter is a `LINKAGE` cell the caller points at the actual
  record, so passing a derived record where the base is expected reads the right
  storage. A transaction is a program entry point rather than something called
  with varying arguments, so its records stay in working storage and take no
  part in this.
- **Failure is an abandoned unit of work, not a thrown value.** `raise` sets
  `BANK-FAILURE-CODE` and jumps to the body's exit; the caller must test it.
  There is no unwinding, no stack trace, and no `catch` that resumes. A failure
  crossing a `CALL` boundary relies on an `EXTERNAL` field rather than on
  anything the language runtime enforces.
- **Rollback is delegated, not performed.** The failure path calls the ledger
  with `ROLLBK`. What that undoes is the institution's program's decision;
  BankLang generates no compensating postings of its own.
- **No user-defined operators, interfaces, or variance.** Generics are
  unconstrained: a type parameter's body is checked per instantiation, so an
  uninstantiated generic is never checked at all (`BANK-TYPE-015`).
- **Ledger balance is structural.** Two different expressions that evaluate to
  the same amount are reported as unbalanced.
- **The VS Code extension is unpublished.** It builds and typechecks in CI, but
  it has not been through marketplace review.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: small changes, real
tests, no silent golden updates, and never claim validation that did not happen.

## License

[MIT](LICENSE)
