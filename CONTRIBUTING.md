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
pnpm format:check  # prettier, over the repository
pnpm fmt:check     # bankc fmt, over the BankTS in examples and conversions
pnpm typecheck
pnpm test

# every example must build, verify, and compile
pnpm examples:verify
```

`format:check` and `fmt:check` are different checks over different files.
Prettier does not know BankTS, so the example programs are formatted by the
compiler's own printer; CI runs both, and a change that touches an example can
pass the first and fail the second.

Run `pnpm examples:verify` rather than a loop over `examples/`. Not every entry
there is one program (`end-of-day-settlement` is four and a sort in one job)
and the loop CI used to run failed on it with a stack trace.

`tests/cobol-compiles.test.ts` compiles every example with `cobc` and **skips**
when GnuCOBOL is absent. Treat a skipped run as unverified rather than as
passing.

## Hard rules

These exist because the project's entire claim is that output is deterministic
and explainable:

1. Do not use AI output as compiler truth. Nothing a model produces reaches an
   artifact: every byte comes from deterministic code, and a change that cannot
   be justified by the specifications and proven by tests does not land.
2. Do not implement arbitrary TypeScript-to-COBOL conversion, and do not support
   JavaScript's dynamic semantics. BankTS is a deliberately small language, and
   the restriction is the product.
3. Do not use binary floating point for money.
4. Do not generate unreadable COBOL.
5. Do not silently update golden outputs. A golden change must be explained in
   the commit body and reviewed as a behaviour change.
6. Do not weaken a type check to make an example pass.
7. Do not remove a diagnostic without a test proving the case is handled.
8. Do not add network calls to the compiler core.
9. Do not leave placeholders in committed code, documentation, or examples.
10. Do not claim IBM Enterprise COBOL validation. Local GnuCOBOL validation is
    real and worth recording, but it is not IBM validation, and the two must
    never be blurred.

## AI-assisted contributions

Accepted. Much of this repository was written that way. The README says so on
its front page, and [SECURITY.md](SECURITY.md#ai-policy) sets out the boundary.
A patch drafted with a coding assistant is read against the same hard rules,
local checks and commit style as one typed by hand, and it stands or falls on
those.

Rule 1 above governs what reaches an artifact rather than what produces a patch.
A model may draft code, tests and prose; the reasoning behind a change has to be
somebody's. Every byte of generated COBOL comes from deterministic compiler
code, and a change still needs its justification from the specifications and a
test that fails without it.

Two conventions follow, and both sit with the contributor rather than the tool:

- **Read the whole patch before sending it.** Review here covers the parts a
  model wrote as closely as the rest. A confident sentence about an IBM
  convention counts for nothing without the citation beside it, and the entries
  in [docs/glossary.md](docs/glossary.md) show the form those take.
- **Keep the assistant out of the trailers.** No `Co-Authored-By` naming a
  model, and no "generated with" line. Attribution belongs to the people
  answerable for the change.

## Adding a diagnostic

A new diagnostic needs all four of these, or the build fails:

1. An entry in `packages/diagnostics/src/index.ts`.
2. An entry in [docs/diagnostics.md](docs/diagnostics.md).
3. A test that triggers it.
4. An identifier in the right namespace.

`tests/diagnostic-catalogue.test.ts` enforces it: it scans the compiler source
for identifier literals and fails on any that is undocumented.

## Generated files, and terminology

Generated files carry this banner and no timestamp, because a timestamp is the
one thing that makes two identical builds differ:

```txt
Generated by bankc.
Do not edit this file directly.
```

Before introducing a term in documentation or in a diagnostic, check
[docs/glossary.md](docs/glossary.md), and add it there if it is missing, with a
definition, why it matters here, and a reference to a primary source.

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
