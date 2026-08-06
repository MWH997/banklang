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

#### Generated programs

`tests/generated-programs.test.ts` builds sixty random **valid** BankTS programs
from `tools/generate-programs.ts` and asserts three things of each: it compiles
with no errors, its COBOL and JCL pass the conformance linter, and `cobc`
accepts it under `tools/banklang-ibm.conf`.

The point is not to fuzz the parser. It is that every hand-written fixture is a
shape somebody thought of, and the 2026-08-05 audit's most serious finding — a
COBOL word one character over the limit — lived in a shape nobody had, because
every fixture used short names. So the generator spends most of its budget on
boundaries: names at 29, 30 and 31 characters, every rounding mode, precisions
and scales at the edge of what `ARITH(COMPAT)` allows, tables at one occurrence
and at five hundred.

It is deterministic. The seed is the program, and a failure names the seed that
reproduces it.

It found two defects on its first run, both unreachable from any example:
`decimal<2, 2>` — a value entirely below the decimal point, which is what a rate
is — emitted `PIC S9(0)V99`, and a function name long enough to need
abbreviating gave its paragraph, its parameter cell, its result field and its
exit paragraph the same thirty-character word.

### 2.3a Mutation tests

The diagnostics are the product. A safety rule with no test that fails when you
invert it is not a rule, it is a comment — and reading the suite cannot tell the
two apart, because a test that compiles a bad program and asserts the right
diagnostic passes just as well when the rule is deleted and another rule catches
the same program.

```bash
pnpm test:mutation
```

Stryker, against `packages/typechecker` and `packages/semantic-analyzer` — the
two packages that decide whether a program is refused.

There is a second run, `pnpm test:mutation:emitter`, against the code that
decides what the emitted text looks like. It exists because the reason
originally given for leaving the emitter out — that golden fixtures, the
conformance linter and `cobc` already hold it — turned out to be wrong in a way
worth recording. See §2.3b.

Three configuration decisions are worth knowing, because each changes what the
number means:

- **`vitest.mutation.config.ts`** narrows the suite Stryker runs. Left out is
  everything that cannot answer the question — the repository-hygiene tests,
  which read files rather than compile programs, and the ones that spawn `cobc`,
  which are minutes each and prove things about the emitter.
- **`ignoreStatic`** skips mutants in module-level initialisers. Over half the
  mutants are in the diagnostic catalogue and the reserved-word tables, and
  measuring one of those means rerunning the entire suite for it.
- **`excludedMutations: ["StringLiteral", "Regex"]`** leaves diagnostic message
  text alone. A changed message is a test failure that says nothing about
  whether the rule works.

It takes roughly an hour on eight cores, so it is not in the default
`pnpm test`. `incremental` is on, and the second run over unchanged code is
quick.

#### What it scored, and what that is worth

Run on 2026-08-06, 4,585 mutants, 56 minutes:

| Package           | Score | Covered | Killed | Survived | No coverage |
| ----------------- | ----- | ------- | ------ | -------- | ----------- |
| typechecker       | 70.24 | 79.18   | 3,003  | 792      | 484         |
| semantic-analyzer | 64.65 | 70.33   | 192    | 81       | 24          |
| **All**           | 69.88 | 78.59   | 3,195  | 873      | 508         |

Two numbers, because they answer different questions. **Covered** is the share
of mutants some test reached and killed — how good the tests are at what they
look at. **Total** counts the 508 mutants no test in
`vitest.mutation.config.ts` reaches at all, which is the more useful number and
the lower one.

The survivors cluster: 483 conditional expressions, 99 logical operators, 74
block statements. A large share of those are in diagnostic construction —
message text, hint text, `span` selection — where an inverted condition changes
what a message says rather than whether the program is refused. That is a real
limit of the measurement here rather than an excuse: it means the number
understates how well the _rules_ are tested and overstates how much of the
remainder is worth chasing.

**It found a defect in a rule written an hour before it ran.** `BANK-SQL-008`
tested `operation === "commit"`, and mutating that to `true` survived the entire
suite — nothing distinguished a commit in a cursor loop from a rollback. The
manual settles which is right: "A ROLLBACK statement closes all open cursors. A
COMMIT statement ... closes cursors that are not declared WITH HOLD." So the
rule was too narrow, not the test, and `hold` saves a commit and saves nothing
from a rollback. That is the whole argument for running this.

### 2.3b Mutation tests over the emitter's formatting

```bash
pnpm test:mutation:emitter
```

A separate run, because it asks a different question of different tests.

The emitter was out of scope on the grounds that its output is already held by
golden fixtures, the conformance linter and `cobc`. The 2026-08-05 audit's F13 —
`MOVE 'Y'` two lines under a `VALUE "N"` — shipped through all three: the golden
fixture _contained_ the defect, the linter had no rule for it, and `cobc`
accepts both delimiters. Three controls, named as sufficient, all passing.

So the scope is the files that decide what emitted text looks like rather than
what it says: `reference-format.ts`, `prologue.ts`, and the name and picture
builders in `cobol-ir`. A surviving mutant in those is a house-style rule that
nothing enforces, which is exactly F13's class. The 8,700-line backend index
stays out — mutating it produces five figures of mutants, most about semantics,
which the corpus assertions and `cobc` already answer.

`vitest.mutation-emitter.config.ts` is an allowlist of the ten suites that read
generated COBOL, rather than a blocklist. The rule suites would cost a full run
each and kill nothing here.

#### What it scored

Run on 2026-08-06, 667 mutants, 2 minutes 30 seconds:

| File                  | Score | Covered | Killed | Survived | No coverage |
| --------------------- | ----- | ------- | ------ | -------- | ----------- |
| `prologue.ts`         | 71.78 | 74.05   | 114    | 41       | 5           |
| `reference-format.ts` | 66.78 | 72.36   | 179    | 76       | 23          |
| `cobol-ir/index.ts`   | 43.90 | 52.63   | 86     | 81       | 34          |
| **All**               | 60.96 | 67.22   | 379    | 198      | 62          |

Read this as a finding rather than as a pass. It clears the 60 threshold by
under a point, and **198 survivors means 198 places where the emitted text can
change and nothing complains.** `cobol-ir` at 43.90 is the weakest: that file
holds the name abbreviation and the picture builders, which is where F13's
sibling defects — two spellings of one picture, a 31-character word — came from.

The honest reading is that the emitter's _semantics_ are well covered by the
corpus assertions, `cobc` and the oracle, and its _presentation_ is not. That is
the same gap the audit found by hand, now with a number on it and a way to watch
it move.

### 2.3c Mutation tests over the conformance linter

```bash
pnpm test:mutation:lint
```

The third lane, and the one that asks the uncomfortable question. Every claim in
this repository of the form "the generated COBOL does not do X" is a claim about
a rule in `packages/conformance-lint`. Nothing was checking the checker.

`vitest.mutation-lint.config.ts` runs the linter's own suites plus the corpus
checks that point it at every example and every checked-in artifact, because a
rule is only as good as the text it is aimed at.

#### What it scored

Run on 2026-08-06. First run, before any test was written for it:

| Run                           | Score | Covered | Killed | Survived | No coverage |
| ----------------------------- | ----- | ------- | ------ | -------- | ----------- |
| First                         | 61.10 | 63.02   | 418    | 247      | 21          |
| After eleven tests were added | 68.65 | 70.70   | 470    | 196      | 20          |

**It found a rule with no test at all.** `unreferenced-item` was added in the
previous pass of the 2026-08-06 audit and shipped with none: every mutant
survived, including replacing its collection condition with `if (true)` and
emptying the loop that reports its findings. The rule works — it found six dead
storage items the day it was written — and nothing in the suite would have
noticed if it stopped.

It also found that `literal-delimiter`, the rule written to close F13, could stop
reading at the first `EXEC SQL` and go on passing, because emptying
`if (/END-EXEC/) { inExec = false }` survived. Most programs in this corpus have
an `EXEC SQL` block near the top.

Read the remaining 196 as a finding, in the same terms as §2.3b's 198.

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

- New important terms are added to [glossary.md](glossary.md).
- Each definition includes reference links.
- Definitions prefer primary sources.
- README and reference-page terminology matches [glossary.md](glossary.md).
- Tester notes mention whether definitions were updated.

A future CI check should scan Markdown files for configured glossary terms and report terms that appear in the documentation but are missing from [glossary.md](glossary.md).
