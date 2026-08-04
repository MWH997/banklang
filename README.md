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
pnpm bankc check   examples/account-posting   # diagnostics only
pnpm bankc build   examples/account-posting   # full artifact bundle
pnpm bankc verify  examples/account-posting   # determinism + coverage
pnpm bankc test    examples/account-posting   # the above, plus cobc
pnpm bankc explain BANK-LED-001               # explain a diagnostic
```

## Examples

| Example                                                      | Demonstrates                                       |
| ------------------------------------------------------------ | -------------------------------------------------- |
| [`account-transfer`](examples/account-transfer/)             | Records, decimal aliases, a validation function    |
| [`batch-interest-accrual`](examples/batch-interest-accrual/) | Locals, exact decimal arithmetic, `if`/`else`      |
| [`account-posting`](examples/account-posting/)               | Transactions, ledger postings, audit events        |
| [`account-file-batch`](examples/account-file-batch/)         | Sequential files, `FILE-CONTROL` and `FD` sections |

Every example is compiled with GnuCOBOL in CI, and each has a checked-in
[evidence bundle](evidence/) holding its generated artifacts and verification
report.

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
| [Roadmap](docs/roadmap.md)                       | What is planned                 |
| [ADRs](docs/adr/)                                | Architectural decisions         |

## Status and honest limits

This is a working compiler for a **deliberately narrow subset**, not a
production mainframe toolchain. Being precise about that matters more than
sounding impressive:

- **Validated with GnuCOBOL, not IBM.** Every example compiles with GnuCOBOL in
  CI. No IBM Enterprise COBOL validation has been performed, and none is
  claimed.
- **Not production-ready**, and never run against a real ledger.
- **The subset is small.** No loops, no SQL, no CICS, no VSAM. Db2 and CICS
  profiles are on the roadmap, not in the box.
- **File I/O is declaration-only.** Files produce `FILE-CONTROL` and `FD`
  sections; read and write statements are not in the subset yet.
- **Ledger balance is structural.** Two different expressions that evaluate to
  the same amount are reported as unbalanced.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: small changes, real
tests, no silent golden updates, and never claim validation that did not happen.

## License

[MIT](LICENSE)
