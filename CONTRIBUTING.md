# Contributing

BankLang changes should be small, deterministic, and reviewable.

## Toolchain

- **Node.js 24 or newer.** This is the supported runtime for both local
  development and CI.
- **pnpm 11.7.0**, pinned by the `packageManager` field.
- **GnuCOBOL** (optional locally, installed in CI). Without `cobc`, the
  compile-verification tests skip rather than fail.

```bash
node --version   # must be v24 or newer
pnpm install
pnpm test
```

## Before changing the compiler

Read the document that covers the area you are touching:

| Area                       | Document                                                 |
| -------------------------- | -------------------------------------------------------- |
| Language surface           | [docs/language-reference.md](docs/language-reference.md) |
| Pipeline and package roles | [docs/architecture.md](docs/architecture.md)             |
| Diagnostics                | [docs/diagnostics.md](docs/diagnostics.md)               |
| COBOL emission             | [docs/cobol-backend.md](docs/cobol-backend.md)           |
| Tests and evidence         | [docs/verification.md](docs/verification.md)             |
| Terminology                | [docs/glossary.md](docs/glossary.md)                     |

## Workflow

1. Make the smallest coherent change.
2. Add or update tests. Every compiler feature needs at least one unit, golden,
   property, or integration test. Decimal, copybook layout, and COBOL output
   changes need stronger coverage than that minimum.
3. Update documentation when behaviour changes.
4. Add a `CHANGELOG.md` entry unless the change is typo- or formatting-only.
5. Run the checks below.

## Local checks

```bash
pnpm lint          # eslint
pnpm format:check  # prettier
pnpm typecheck
pnpm test

# every example must build, verify, and compile
for example in examples/*/; do pnpm bankc test "$example"; done
```

## Hard rules

These exist because the project's entire claim is that output is deterministic
and explainable:

1. Do not use AI output as compiler truth.
2. Do not use binary floating point for money.
3. Do not generate unreadable COBOL.
4. Do not silently update golden outputs. A golden change must be explained in
   the commit body and reviewed as a behaviour change.
5. Do not weaken a type check to make an example pass.
6. Do not remove a diagnostic without a test proving the case is handled.
7. Do not add network calls to the compiler core.
8. Do not claim IBM Enterprise COBOL validation. Local GnuCOBOL validation is
   real and worth recording, but it is not IBM validation, and the two must
   never be blurred.

## Changes needing extra review

Decimal arithmetic, copybook layout, COBOL emission, transaction semantics,
diagnostic severity, source-map generation, and anything that changes generated
bytes.

For these, include the reasoning in the commit body and state what validation
ran.

## Commit style

Conventional commits, with a body explaining **why** and **what was validated**.

```txt
feat(parser): parse decimal type declarations
fix(cobol): keep GOBACK out of IF branches
docs(diagnostics): document the BANK-LED namespace
```

Avoid: `misc changes`, `update stuff`.

## Determinism

Generated output must not contain timestamps, random names, or
filesystem-order-dependent ordering. `pnpm test` includes a determinism test
that builds twice and compares bytes.
