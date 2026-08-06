# Verification Specification

## 1. Verification goal

The project must prove that compiler output is deterministic, traceable, and semantically faithful for the supported subset.

Verification is not optional. It is the difference between a toy transpiler and a bank-grade toolchain.

## 2. Test categories

### 2.1 Unit tests

Cover:

- lexer
- parser
- AST
- typechecker
- decimal model
- copybook parser
- IR lowering
- COBOL emitter
- diagnostics

### 2.2 Golden tests

Given a BankTS input, expected generated output is committed.

Golden outputs:

- COBOL source
- copybook
- source map
- audit report
- diagnostics

Rules:

- generated output must be deterministic
- golden updates require explicit command
- golden diffs must be reviewed
- no broad snapshot rewrite without explanation

### 2.3 Property-based tests

Important areas:

- decimal arithmetic
- rounding
- overflow
- copybook field layout
- packed-decimal byte length
- identifier name conversion
- source map ranges
- deterministic ordering

### 2.4 Fuzz tests

Fuzz:

- BankTS parser
- copybook parser
- COBOL emitter input validation
- SQL declaration parser
- diagnostic rendering

Fuzzing should not require mainframe access.

### 2.5 Differential tests

Run a reference evaluator for the supported BankTS subset and compare with generated COBOL behaviour where possible.

Initial focus:

- pure functions
- decimal calculations
- validation logic
- record transformations

### 2.6 Integration tests

Integration examples:

- account transfer
- batch interest accrual
- copybook import/export
- Db2 declaration emission
- CICS declaration emission
- VSAM file declaration emission

### 2.6a Executed conformance tests

Every other category inspects the generated program. This one runs it.

`tests/conformance.test.ts` compiles a BankTS program, links it against the
reference runtime in `runtime/`, seeds a packed-decimal input record built from
the compiler's own layout report, executes the program, and asserts on:

- the ledger journal, in call order
- the closing balance per account
- the audit events emitted
- the bytes of each output record
- the SQL and CICS calls made, each with the outcome it reported

This catches the class of defect that compiles. The bounds guard once clamped an
out-of-range subscript instead of refusing it; a recursive function returned `5`
for `5!` because `WORKING-STORAGE` is shared across invocations; and every
non-failing function paragraph ended with `GOBACK.`, so performing one ended the
whole program at the first call — a program that exited 0 having posted nothing.
All three passed every static check and every golden fixture.

Outcomes the program branches on can be scripted, because the reference Db2 and
CICS runtimes decide nothing on their own. Seeding `SQLCODE 100` for a statement,
or `PGMIDERR` for a command, executes the branch the generated program guards
with `sqlcode == 0` or a `resp` test rather than reading it out of the emitted
COBOL. A scripted count of successful fetches does the same for a cursor: the
loop's own decisions — when it stops, whether it closes, and whether the declared
bound holds when the rows never run out — are executed rather than inspected. See
`runtime/README.md` for the file format.

The suite skips when `cobc` is unavailable, and CI installs GnuCOBOL so it does
not skip there.

Scope limit: the runtime is a set of small COBOL programs in this repository.
`BANKLEDG` is not a bank ledger; `DSNHLI` parses no SQL and every `SQLCODE` it
reports was either the default or written down by a test; `DFHEI1` provides no
task, no syncpoint, and no recovery. A conformance pass establishes that the
generated program executes, computes correctly, and takes the branch its own
tests select. It establishes nothing about Db2, CICS, or any real ledger. See
`runtime/README.md`.

### 2.7 Mainframe smoke tests

Roadmap only for public repo unless access exists.

Smoke test should validate:

- generated COBOL compiles with IBM Enterprise COBOL
- Db2 precompile path is documented
- CICS translator path is documented
- generated JCL is structurally sane

## 3. Determinism tests

For every fixture:

1. Build once.
2. Delete output.
3. Build again.
4. Compare byte-for-byte.

No generated timestamp. No random symbol names. No filesystem-order dependence.

## 4. Audit artifact tests

Audit output must validate against JSON schemas.

Required audit files:

```txt
audit/source-map.json
audit/decimal-analysis.json
audit/transaction-analysis.json
audit/copybook-layout.json
audit/diagnostics.json
audit/generated-artifacts.json
```

## 5. Example verification flow

```txt
bankc check examples/account-transfer
bankc build examples/account-transfer
bankc verify examples/account-transfer
bankc audit-report examples/account-transfer --out dist/audit
```

Expected:

- no errors
- deterministic output
- generated COBOL exists
- generated copybook exists
- source map exists
- audit report exists
- golden tests pass

## 6. CI expectations

CI should run:

- format check
- lint
- typecheck
- unit tests
- golden tests
- determinism tests
- parser fuzz smoke
- dependency audit
- SBOM generation

## 7. Failure policy

A verification failure must be explicit.

Bad:

```txt
Something went wrong.
```

Good:

```txt
BANK-GEN-004 error
Generated COBOL source map is missing entry for function validateAmount.
Artifact: dist/cobol/ACCOUNTT.cbl
```

## 8. Tester notes as verification evidence

Tester notes are part of the verification system.

For substantial changes, especially compiler semantics, COBOL generation, copybook layout, Db2/CICS/VSAM/JCL support, security, and generated-output changes, create a tester note under `tester-notes/`.

A tester note must record:

- change summary
- why the change was needed
- research notes
- validation commands
- automated tests
- manual checks
- backend validation using GnuCOBOL or IBM Enterprise COBOL when available
- known gaps
- follow-up tickets

Do not claim IBM compiler validation unless it was actually performed.

## 9. Backend compiler validation

The primary validation target is IBM Enterprise COBOL for z/OS when available.

When IBM tooling is unavailable, use GnuCOBOL or another documented open-source COBOL compiler for local validation, but mark this clearly as local validation only.

Validation reports should distinguish:

```txt
validated-with-ibm-enterprise-cobol: yes/no
validated-with-gnucobol: yes/no
backend-profile: ibm-enterprise-cobol-zos | gnucobol-local
known-backend-gaps: [...]
```

## 10. Documentation and definitions validation

Documentation changes must validate terminology.

Checks:

- New important terms are added to `definitions.md`.
- Each definition includes reference links.
- Definitions prefer primary sources.
- README/spec/ticket terminology matches `definitions.md`.
- Tester notes mention whether definitions were updated.

A future CI check should scan Markdown files for configured glossary terms and report terms that appear in docs but are missing from `definitions.md`.
