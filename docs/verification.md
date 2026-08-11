# Verification Specification

## 1. Verification goal

What this project has to show about its output, for the subset it supports: that
the same input produces the same COBOL, that every generated construct can be
traced back to the source that asked for it, and that the COBOL means what the
BankTS meant.

None of that is established by the compiler agreeing with itself, which is the
reason this page is as long as it is.

Everything on this page is **vertical**: tests written for BankLang, run against
BankLang. That is most of the evidence this project has and it has one blind
spot — a misunderstanding shared between a test and the code it tests agrees
with itself perfectly. [Horizontal
validation](validation/horizontal-validation.md) is the other axis: the same
compiler measured against independent COBOL corpora, benchmarks and defect
suites that were not written for it, with the results in
[horizontal-validation-results.md](validation/horizontal-validation-results.md).

## 1a. Static analysis

```bash
pnpm lint          # eslint, with type information
pnpm format:check  # prettier
```

Until 2026-08-06 `pnpm lint` was `prettier --check`, and calling a formatter a
linter is how the gap stayed invisible: TypeScript caught types, Prettier caught
whitespace, and nothing looked at the space between them. A duplicate
`case "RaiseStatement"` sat in the formatter until esbuild happened to mention
it while bundling the language server — TypeScript does not report a duplicate
case, because the exhaustiveness check over `never` is satisfied by the first
one.

ESLint runs on `typescript-eslint`'s recommended type-checked set. Its first run
found ninety-eight problems, of which fifty-six were dead code: forty-two unused
imports, a 114-line table of COBOL statement verbs in the conformance linter
that had never been referenced since the commit that introduced it, a regex in a
test superseded by a comment three lines below it, a flag in the typechecker
written in three places and read in none, two unreachable functions in the
emitter, and a call passing the working directory into a parameter named
`commandName`. See the 2026-08-06 audit, §8.

`noUncheckedIndexedAccess` and `no-unnecessary-condition` are both on. The
compiler option makes an indexed read `T | undefined`, so the ESLint rule can
distinguish a guard that makes index access safe from one that is genuinely
dead. Enabling the compiler option first exposed 366 places whose types had
previously promised an element was present; correcting those was the
prerequisite for enabling the lint rule safely.

## 2. Test categories

### 2.1 Unit tests

One stage at a time, over the pipeline in
[architecture.md](architecture.md): lexer, parser, AST, typechecker, decimal
model, copybook parser, IR lowering, emitter, diagnostics. These are the tests
that say what a stage does with an input chosen to make a point.

They are also the tests §2.3a exists to distrust. A unit test that compiles a bad
program and asserts a diagnostic passes just as well when the rule it was written
for has been deleted and a different rule catches the same program.

### 2.2 Golden tests

The expected COBOL, copybook, source map, audit report and diagnostics are
committed, and a run that differs from them fails.

Updating a golden is a deliberate act: it takes an explicit command, the diff is
read rather than accepted, and a change that rewrites many fixtures at once needs
a reason written down. The failure mode a golden suite has is that a wrong output
is blessed because the diff was long, so the rule is about the diff, not about
the command.

### 2.3 Property-based tests

Where the answer is checkable without a fixture: decimal arithmetic, rounding,
overflow, copybook field layout, packed-decimal byte length, identifier name
conversion, source map ranges, deterministic ordering. Each is a claim with a
shape — that a byte length follows from precision, that two runs order output
the same way — rather than a case somebody chose.

#### Generated programs

`tests/generated-programs.test.ts` builds sixty random **valid** BankTS programs
from `tools/generate-programs.ts` and asserts three things of each: it compiles
with no errors, its COBOL and JCL pass the conformance linter, and `cobc`
accepts it under `tools/banklang-ibm.conf`.

The point is that every hand-written fixture is a shape somebody thought of, and
the 2026-08-05 audit's most serious finding — a
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

### 2.3d Mutation tests over the file-outcome rule

```bash
pnpm test:mutation:safety
```

`BANK-FILE-017` is a published guarantee about what this compiler proves, and a
guarantee whose logic nobody has mutated is a claim. It sits in the rules lane's
`mutate` glob, and the aggregate hid it: the lane reported a healthy number
while `packages/semantic-analyzer/src/file-outcomes.ts` scored **63.73** inside
it, behind two files above 80. So it has a lane of its own, with
`packages/migration-analysis/src/record-usage.ts` — which produces the numbers
that decide what goes into the language — and `tools/interpreter-coverage.ts`,
the gate that decides whether emitted COBOL has been executed by two engines.

#### What it found

Three holes in the rule itself, rather than tests that were merely weak.

A `write` from the record a pending read filled was **not a use** — the stale
record posted straight back out, which is the defect the whole rule exists for.
Nor was a `release` into a sort, a queue `put`, a `checkpoint`, a `for each`
over a table inside the record, a `call ... using`, a `json` generate, a CICS
`link commarea`, a DL/I `insertSegment`, or an SQL or cursor argument taken
from it. The walk read _expressions_, and COBOL hands whole records to things by
naming them.

The `on page` block of a write was never entered, and neither was a
transaction's `on failure` handler.

A fourth, found on the second pass: a **`rewrite` naming another file's record**
was not a use. The arm was there and a test covered it, but the test could not
tell whether the arm did anything — `BANK-FILE-010` makes a `rewrite` follow a
read of the same file, so that read is already reported by the "another
operation on this file" rule and the diagnostic list is the same either way. The
comment above the test said as much, and said it was therefore
undistinguishable. It is not. Read one file and test it, read a second, then
`rewrite` the first _from the second's record_: the use is real, the later test
discharges the second file only after it, and dropping the arm reports nothing
at all. Both cases are now in `tests/file-outcomes.test.ts`, the second labelled
as the one that makes the arm load-bearing.

That is the shape worth remembering: a test that covers a branch is not a test
that constrains it.

All three came from the same shape: the walk found nested blocks by looking up
seven property names on the statement object, and decided what a statement read
for the nine kinds that had come up. It now uses `childBlocks` — the IR's own
exhaustive accounting, which `tests/nested-block-walkers.test.ts` already held
the backend to — and two exhaustive switches with no `default`, so a statement
kind added to the language does not compile until somebody has classified it.

#### The twenty-eight that remain in the rule

`file-outcomes.ts` scores **87.83%**, with 231 killed, 28 surviving and four
uncovered. Each survivor was reproduced by hand and the suite re-run, because a
reason nobody checked is a guess:

| Where                                                                                                                                                                                                   | Count | Why it cannot be killed                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `case` arms in `expressionsOf` and `namesUsedBy`                                                                                                                                                        | 7     | Stryker deletes a case _body_, so the arm falls through to the next case — and each of these falls onto one with an identical body. `ReturnStatement` onto `ExpressionStatement`, `ReleaseStatement` onto `CheckpointStatement`, four `[]` arms onto the `[]` group below them, and `SqlStatement` onto `CursorLoopStatement`, whose extra `start` an SQL statement has not got. Grouping cases by shared body is what makes them equivalent. |
| `[]` replaced by `["Stryker was here"]`                                                                                                                                                                 | 12    | Both consumers reject a bare string. `namesIn` switches on `expression.kind`, which a string has not got; and a name is matched by `Set.has` against record names, which are identifiers, so no injected literal can match one.                                                                                                                                                                                                               |
| the guards around `tested.has(...)` and `read.has(...)` — `used.length > 0`, `statusName !== undefined`, `outcome.kind === "pending"`, `outcome.recordName !== null`, and the `&&` between the last two | 6     | Every one only stops the lookup being _made_ with `null` or `undefined`, and the lookup already answers false for both: `CLEAN` is `{ kind: "clean" }` with no `recordName`, and both sets are `Set<string>`. Verified for each by applying it and running the suite.                                                                                                                                                                         |
| the `NullableCheck` arm of `comparedNames`                                                                                                                                                              | 2     | Unreachable by typing. The only consumer of the set it feeds is the file-status comparison, and a status is a fixed-width string — `feedInStatus?` is `BANK-SYN-001`, so no nullable check can ever name one.                                                                                                                                                                                                                                 |
| `if (statuses.size === 0) return []`                                                                                                                                                                    | 1     | A program with no file status creates no outcome, so the walk finds nothing with or without the early return. Speed, not answers.                                                                                                                                                                                                                                                                                                             |

Four mutants are uncovered rather than surviving, in the diagnostic's own
message construction, which `tests/diagnostics.test.ts` holds instead.

#### What it found in the corpus analyser

`record-usage.ts` is measurement rather than compilation: it reads other
people's COBOL and produces `evidence/horizontal/xcobol-v2/record-usage.json`,
which is the evidence `BANK-FILE-015` rests on. A number that decides what goes
into a language is worth the same scrutiny as the language, and this lane scored
it at **78.02%** with 67 surviving mutants.

The largest cause was not a missing assertion. Two `describe` bodies read their
fixture once and shared it:

```ts
describe("reading an FD's records", () => {
  const [shape] = fileRecordShapes(VARIANTS); // runs at collection
  it("stops the FD's clauses at their period", () => {
    expect(shape?.varyingLength).toBe(true);
  });
});
```

A `describe` body runs when the file is collected, before Stryker activates a
mutant, so the analyser those assertions ran against was always the unmutated
one. Fourteen mutants survived assertions that fail the moment the same mutation
is applied by hand — the check was reported green, and it was not being made.
Reading the fixture inside each `it` is the whole fix, and it is worth knowing
about anywhere a mutation score is taken seriously.

Under assertions that then bound, the analyser had real holes, all of them in
paths that move a published count:

- A record with a **nested group** measured as a length rather than as
  unmeasured. A group entry has no picture, so the running sum met `null`, and
  `null + 4` is `4` in JavaScript — the arithmetic did not fail, it reported a
  short record. That is what moves an FD out of `unmeasuredLength` and into
  `sameLength` or `differentLength`.
- A **picture symbol with no rule** — `PIC G(n)` is DBCS — was never exercised,
  so nothing held the analyser to refusing rather than guessing.
- `COMP` widths were asserted at nine digits only, so **both boundaries** of
  `2 / 4 / 8` bytes were free to move.
- `I-O` was measured by no test at all, and `openedIo` is a published row.
- `varyingLength`, the `5+` bucket boundary, the forty-shape example cap, the
  "every variant written" total and the per-file multi-record flag were all
  counted by code no assertion constrained.

The lane now scores **94.74%**, with 306 killed, 17 surviving and none
uncovered.

#### The seventeen that remain

Every one is written down rather than tolerated, because "some survivors are
equivalent" is the sentence that hides the ones that are not.

| Where                                                     | Why it cannot be killed                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leading = []`, `inClauses = false` (×3 initialisers)     | `close()` runs at the head of every `FD`, and reassigns both before a record is read. The initial value is never the one used.                                                                                             |
| `sharedLeadingField`/`leadingFiller`/`modes` initialisers | `close()` assigns all three unconditionally on the way out. A shape is only ever pushed by `close()`.                                                                                                                      |
| `leading[0] !== null` and `name !== null`                 | A mutually protective pair: `every` already rejects a null name, and the explicit test already rejects a null first element. Neither can be removed while the other stands, so neither can be killed alone.                |
| `leading[at] === undefined`, `running === undefined`      | `noUncheckedIndexedAccess` is on, so the type of an indexed read includes `undefined` and the compiler requires the test. The array is filled with `null`, so it is unreachable at run time and mandatory at compile time. |
| the blank-line skip, the `OPEN` short-circuit             | Both are shortcuts. A blank line matches no pattern downstream, and a line without `OPEN` yields no words to scan. Removing either changes speed, not answers.                                                             |
| `(expanded.match(/9/g) ?? [])`                            | Reachable only for a picture with no `9` that also carries `COMP` or `COMP-3`, which is not a picture-and-usage combination COBOL admits.                                                                                  |
| `const targets: string[] = []`                            | Consumed only by `records.filter((r) => targets.includes(r))`, and the entry regex admits `[A-Z0-9][A-Z0-9-]*`, so no injected string can ever match a record name.                                                        |

### 2.4 Fuzz tests

There are none, and the generator in §2.3 is the reason rather than an
oversight. Fuzzing a parser asks whether invalid input crashes it; what this
compiler claims is about the output it produces from _valid_ input, and a
rejected program produces none. So `tools/generate-programs.ts` generates
programs that compile clean by construction, and the assertions are on the
COBOL that comes out.

The parsers are still reached by malformed input — every diagnostic in
`diagnostics.md` has a test that provokes it — but from fixtures written to name
a specific error, not from random bytes.

### 2.5 Differential tests

Every example is executed twice, by two implementations that share no code: by
`cobc`, and by the COBOL interpreter in `packages/cobol-runtime`, written
against the same emitted output. A test fails on any disagreement between them.

This is the lane that catches a defect which compiles. Static checks all passed
on a bounds guard that clamped an out-of-range subscript instead of refusing it;
running the program is what found it. `tests/cobol-runtime-differential.test.ts`
is the main one, with `sort-differential`, `unstring-differential` and
`interpreter-gaps-differential` beside it for the constructs whose disagreements
are worth isolating.

What it cannot catch is a misunderstanding shared by both sides. Three examples
carry expected balances somebody worked out by hand, which is the only part of
this lane that does not depend on the two implementations agreeing.

### 2.6 Integration tests

A whole project through the whole pipeline, rather than a stage in isolation:
account transfer, batch interest accrual, copybook import and export, and the
declaration emission for Db2, CICS and VSAM. The examples in `examples/` are
these tests — each is a real project `bankc` builds, so a break in the seam
between two stages fails here rather than in nothing.

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

### 2.6b Target semantics

```bash
pnpm lint:zos
```

The category the 2026-08-07 audit added, because it found two programs that
passed every category above and could not do what they claimed on z/OS.

`examples/mq-request-reply` issued two `MQCONN` calls to one queue manager and
abended the step with RC 12 on IBM's `MQRC_ALREADY_CONNECTED` warning before it
read a message. `examples/online-enquiry` computed a balance into a second
record and returned the caller its own request. Both compiled. Both bound. Both
passed the conformance linter, `cobc` under the IBM-shaped dialect, the golden
fixtures, `pnpm examples:verify` and the executed conformance suite — because
every one of those asks whether the toolchain accepts the program, and neither
program had anything wrong with it that a toolchain can see.

`packages/zos-lint` reads the emitted artifacts and asks what the platform will
do with them, citing the MQ and CICS manuals the way the conformance linter
cites the Language Reference. `tests/zos-lint.test.ts` runs it over the whole
corpus, and holds each rule against the program this compiler actually shipped —
the emitter no longer produces either shape, and a rule whose failing case is
hypothetical is a rule that might be inert.

Three rules today. The lane is meant to grow: a rule arrives when something is
found that runs, and is wrong. See
[target-conformance.md](target-conformance.md#zos-semantics).

### 2.6c Accessibility

`tests/accessibility.test.ts` runs `axe-core` over all four page templates —
home, a documentation page, a blog post, and the playground — at WCAG 2.2 AA
plus axe's best-practice set.

The 2026-08-07 audit found five defects by hand (F15–F19): two unlabelled
editors, an `h1` outside `<main>`, a docs sidebar whose group labels came before
the page heading, stat chips reading `1records`, and a theme toggle with no
state. Fixing five defects fixes five defects. This is what makes the sixth fail
a build.

jsdom rather than a browser, which is a deliberate narrowing: Playwright in
`devDependencies` means a browser download in CI and an install script, and
`pnpm-workspace.yaml` takes those one decision at a time. Every defect the audit
found is structural — a name, a role, a heading order, a state — and jsdom sees
all of them. What it cannot see is `color-contrast`, which is switched off
explicitly rather than left to report nothing, and the two CodeMirror editors,
which do not exist until the page runs.

### 2.7 Mainframe smoke tests

These have never been run, because nobody on this project has z/OS access. What
exists instead is a kit somebody who does have it can submit: `zos/` holds the
copybooks, the JCL and the result expected from each, and
`zos/RESULTS-TEMPLATE.md` is the form the answers come back in.

Until one of those comes back, every claim on this page about Enterprise COBOL
is read out of IBM's manuals — cited rule by rule in
[target-conformance.md](target-conformance.md) — rather than observed.

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

All four succeed, the COBOL, copybook, source map and audit report are written,
a second run produces the same bytes, and the golden fixtures still match. Any
one of those failing fails the example.

## 6. What CI runs

`.github/workflows/ci.yml`, in order: `pnpm lint`, `pnpm format:check`,
`pnpm fmt:check` over the examples, `pnpm typecheck` for the workspace and again
for the VS Code extension, `pnpm test`, and `pnpm examples:verify`. It then
builds the site, packages the extension and builds the z/OS conformance bundle,
so a break in any of those is a red build rather than something found at release
time.

GnuCOBOL is built from source and cached, and the job prints which `cobc` it put
on the path. That matters more than it looks: a compile lane that silently
skipped would turn `pnpm test` green while proving nothing about the COBOL, so
which compiler ran is part of the record.

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

## 8. Recording what was validated

The record of what a change was checked against goes in the commit body, which
is where somebody reading the history will find it attached to the change it
describes. [CONTRIBUTING.md](../CONTRIBUTING.md) has the format: why the change
was made, and what was validated.

For compiler semantics, COBOL generation, copybook layout, Db2, CICS, VSAM or
JCL support, security, and any change to generated output, say which commands
were run and what they reported — including what was not covered. A change that
went in with a compile lane skipped is an unverified change, and the commit is
where that has to be legible.

Do not claim IBM compiler validation unless it was actually performed. Local
GnuCOBOL validation is real and worth recording; it is not the same claim.

## 9. Backend compiler validation

The target is IBM Enterprise COBOL for z/OS. The compiler that has actually run
is GnuCOBOL, and the two are never reported as one thing.

Each evidence bundle carries a `gnucobol-validation.md` recording which compiler
ran and what it was given: the `cobc` version, the exact command including
`-conf=tools/banklang-ibm.conf`, the exit code, and whether the IBM-shaped
dialect and GnuCOBOL's own default agreed. It names the SHA-256 of the source
and of every artifact, so the report can be checked against the files rather
than believed.

`backend-profile` is `gnucobol-local` in those reports. It reads
`ibm-enterprise-cobol-zos` only where the artifact was generated for that target,
never as a claim that IBM's compiler accepted it.

## 10. Documentation and definitions validation

A term a reader has to look up elsewhere belongs in
[glossary.md](glossary.md), with a citation to primary documentation rather than
to this project's own wording.

That is held rather than asked for. `tests/citations.test.ts` fails when a
glossary entry has no reference, when an entry is missing one of its three
parts, when the alphabetical order breaks, or when the file is trimmed past the
terms a reader of the generated COBOL needs. `pnpm docs:citations` fetches every
cited URL and records what it resolved to; the test then refuses a citation that
has not been through that check, one that landed on a product shell rather than
a topic, and one naming a release this project does not support. Nine dead links
and seven citations to an out-of-service Db2 were what prompted it.

`tests/prose.test.ts` holds the house style over the same surfaces, and
`tests/documentation.test.ts` fails on a link to a document that does not exist.
