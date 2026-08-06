# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the entry style follows [Common Changelog](https://common-changelog.org/): one
line per change, in the imperative, with the explanation in the document it
links to rather than here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is pre-1.0, so
the language and the CLI may still change between minor versions.

0.9.0 is the first versioned release. Everything before it is in the commit
history, which is where a working record belongs: `git log --reverse` reads it
in order.

## [Unreleased]

### Changed

- Type every index access as possibly absent (`noUncheckedIndexedAccess`), and
  turn `no-unnecessary-condition` back on now that it can tell a dead guard from
  a live one — [verification](docs/verification.md).
- Declare a runtime interface group only where the program calls its module, so
  a program that audits carries no ledger storage.
- Declare the bounds status and copy index only where a check or a table copy is
  generated, rather than wherever a record declares an array.

### Added

- Add ESLint on `typescript-eslint`'s recommended type-checked set as
  `pnpm lint`, with Prettier moving to `pnpm format:check` —
  [verification](docs/verification.md).
- Run the mutation lanes and the citation check on a weekly schedule, opening an
  issue when a score drops or a source stops resolving.
- Say in the README that validation is GnuCOBOL and not IBM, and hold all three
  places that claim to it.
- Add `pnpm docs:citations`, checking every source the documentation cites
  against the live page rather than against its status code.
- Add `pnpm test:mutation:lint`, running Stryker over the conformance linter —
  [verification](docs/verification.md).
- Hold the language server to a whole editing session over stdio, against the
  bundle the VS Code extension loads.
- Require every test that reads the corpus to state how much it expected to
  find.
- Add the `unreferenced-item` conformance rule, refusing an elementary
  working-storage item nothing names —
  [target conformance](docs/target-conformance.md).
- Add `pnpm test:mutation:emitter`, running Stryker over the code that decides
  what emitted text looks like — [verification](docs/verification.md).
- Add [launch-tickets.md](docs/launch-tickets.md), scoping the site at
  `banklang.mwhassan.com` and everything else before the repository is public.
- Hold every fenced COBOL block in every document to what the compiler emits,
  rather than the README alone.
- State how much each corpus assertion looked at, so one that stops finding
  anything fails instead of passing.
- Require every path the VS Code extension resolves at run time to be written by
  one of its build scripts.

### Fixed

- Report a failed clipboard write in the playground, rather than leaving the
  Copy button silent.
- Move the zUnit integration page out of `docs/integrations/` and drop the
  directory — [zunit.md](docs/zunit.md).
- Frame LSP messages by byte count throughout, so a message carrying a
  non-ASCII character no longer takes the rest of the session with it.
- Cite a versioned IBM topic that resolves, rather than a product root, a
  retired slug or Db2 for Linux, UNIX and Windows —
  [glossary](docs/glossary.md).
- Test the two conformance rules the last release added, one of which had no
  test at all.
- Print the rounding modes the compiler actually emits in the language
  reference, rather than a `ROUNDED MODE IS` phrase Enterprise COBOL has never
  had — [numeric model](docs/numeric-model.md).
- Correct the bool mapping, program structure and unsupported-feature list in
  the COBOL backend specification, none of which matched the emitter.
- Build the language server the VS Code extension loads, so the extension can
  start without the server path being set by hand.
- Remove a duplicate `case "RaiseStatement"` in the formatter.
- Stop the playground scrolling sideways on a 390px viewport, and give its
  header links a 24px target.
- Give the playground's tab strip the rest of its ARIA pattern: `role="tab"`,
  `aria-selected`, a `tabpanel`, a roving tabindex and arrow keys.

### Removed

- Remove fifty-six pieces of dead code the new linter found, including a
  114-line table of COBOL statement verbs the conformance linter never
  referenced.
- Cut the glossary from 98 entries to 47, leaving the terms a reader of the
  generated COBOL, the JCL or the diagnostics meets — [glossary](docs/glossary.md).
- Remove the AI model settings from `.env.example`, none of which anything read.
- Remove the glossary's seven AI-model entries, which defined this project's
  own model delegation rather than any term it uses.
- Remove the pre-0.9.0 development log. `git log --reverse` is where a working
  record belongs.

## [0.9.0] — 2026-08-06

The response to the external audit in
[docs/audit-2026-08-05.md](docs/audit-2026-08-05.md). It found a rounding phrase
Enterprise COBOL does not have, a JCL stream that could not be submitted, and a
COBOL word past the 30-character limit — each of them behind a green test suite,
because the local validator was weaker than the target and every feature was
represented by exactly one benign example. Both causes are addressed here, and
the checking added for them is the larger half of this release.

### Changed

- Generate the five rounding modes Enterprise COBOL has no phrase for, instead
  of emitting `ROUNDED MODE IS`, which is COBOL 2002 —
  [numeric model](docs/numeric-model.md).
- Build the job from IBM's `IGYWCL` cataloged procedure, with an expanded form
  for a site that has none installed — [JCL model](docs/jcl-model.md).
- Route every failure through one exit convention, leaving `BANK-MAIN` the only
  paragraph that ends the program.
- Fit every generated name to 30 characters through one function, abbreviating
  its longest segment.
- Derive the `PROGRAM-ID`, the member name, the artifact file name and the job's
  `EXEC PGM=` from one rule, so `PGMNAME(COMPAT)` cannot fold them apart.
- Emit a program prologue naming the entry point, each file under its DD name,
  the modules called, what each return code means, and whether a rerun is safe.
- Emit a `CBL` statement stating the compiler options the program's behaviour
  depends on — [target conformance](docs/target-conformance.md).
- Read file status through condition names rather than reference modification,
  with `"00" THRU "09"` for IBM's successful-completion class.
- Emit `BLOCK CONTAINS 0 RECORDS` and `RECORDING MODE` on a QSAM `FD`.
- Emit `MOVE` rather than `COMPUTE` for a copy that has no arithmetic in it.
- Write every alphanumeric literal with the delimiter `QUOTE` names.
- Name a generated field for its routine and an ordinal rather than for a source
  position, so adding a blank line no longer renames working storage.
- Qualify an index-name shared by two records by its record.
- Close the SQL declare section after the host variables, rather than running it
  to the end of working storage.
- Set an enum field with `SET <condition> TO TRUE` rather than `MOVE`.
- Emit `EXEC CICS ABEND` rather than a return code in a CICS program.

### Added

- `bankc copybook import` — read a production copybook into a BankTS record,
  refusing an import that does not round-trip field for field.
- `bankc dclgen import` — read a DCLGEN member into a BankTS record, taking each
  column's nullability from the catalogue.
- `bankc analyse` — report the programs, paragraphs, `PERFORM` graph, files, SQL,
  CICS commands and calls in COBOL that already exists, and what it cannot see —
  [migration analysis](docs/migration-analysis.md).
- `bankc job` — several programs and a sort in one JCL stream, chained by the
  datasets they already agree on and stopped by `COND`.
- `bankc zunit` — generate a zUnit test case, its configuration and its job from
  `test <name> for <entry transaction>` declarations —
  [zUnit integration](docs/zunit.md).
- `packages/conformance-lint` — read an emitted `.cbl`, `.cpy` or `.jcl` as text
  and hold it to rules that each cite a manual —
  [target conformance](docs/target-conformance.md).
- Add a vocabulary rule refusing any word Enterprise COBOL does not have, with
  the word list extracted from the Language Reference's own Appendix E.
- Compile every example under `tools/banklang-ibm.conf`, a dialect shaped to
  Enterprise COBOL 6.4, as well as under GnuCOBOL's default, and treat a
  difference between them as a finding — [divergences](docs/divergences.md).
- Check the generated rounding sequences against an exact-arithmetic oracle over
  every boundary case, in both shapes and all seven modes.
- Generate random valid programs on boundaries nobody chooses, and require each
  to compile clean, pass the conformance linter and be accepted by `cobc`.
- Run Stryker against the typechecker and the semantic analyser, the two packages
  that decide whether a program is refused — [verification](docs/verification.md).
- Lint the checked-in fixtures and evidence bundles, not only fresh output.
- Add `pnpm fixtures:refresh` and `pnpm evidence:refresh`, so neither set is
  maintained by hand.
- Add meta-tests requiring every statement kind, diagnostic and emission branch
  to be reached by more than one test.
- Support `cursor ... hold` and `cursor ... rowset n`, with `BANK-SQL-008`
  refusing a unit of work ended inside the loop over the cursor it closes.
- Add `BANK-SQL-007`, refusing a `SQLCODE` test that cannot separate an error
  from an absent row, and `BANK-SQL-009`, refusing a commit written as raw SQL.
- Add `BANK-CICS-004`, requiring a CICS response to be tested against its
  condition name.
- Add `BANK-DEC-006`, refusing a rounding whose work fields would not fit the
  eighteen digits `ARITH(COMPAT)` allows.
- Add `runtimeOptions` in `banklang.json`, written onto the job's `CEEOPTS` DD.
- Add `unsigned<p,s>`, `reserved <n>;`, and an alternate key on `start`.
- Add nine examples covering scale, failure and a night's work, and
  `conversions/`, which puts existing COBOL, the BankTS it becomes and the
  regenerated COBOL side by side.
- Add ten documentation pages, including
  [getting started](docs/getting-started.md),
  [for mainframe engineers](docs/for-mainframe-engineers.md) and
  [status and honest limits](docs/status-and-limits.md).

### Fixed

- Report a loop stopped by its own bound as a failure rather than ending the step
  with return code 0.
- Copy a record read `into` a target inside the READ's own `NOT AT END` phrase,
  the record area being undefined after `AT END`.
- Populate a batch entry transaction's parameters from the job's PARM, behind the
  halfword length z/OS puts there, rather than leaving them uninitialised.
- Enter an IMS program with its PCBs rather than with a PARM area it has no
  parameter list to receive.
- Follow `EXEC CICS RETURN` with `GOBACK`.
- Write `EXEC SQL DECLARE CURSOR` in Area B.
- Print the statements the formatter had no case for, instead of deleting them.
- Walk `QueueStatement` in the six IR walkers that each missed it.
- Refuse two files whose names agree in eight characters (`BANK-FILE-012`), and
  two programs in one job whose module names do.
- Write evidence bundles without this machine's absolute paths, so they can be
  reproduced byte for byte anywhere.
- Build the z/OS upload bundle at all: `pnpm zos:kit` threw every time, because
  one flat copybook library would ship one program's record under another's name.
- Emit `SPACES` for `""`, Enterprise COBOL having no zero-length literal.
- Start a word at a digit in a generated name, giving `CM-ADDR-LINE-1` rather
  than `CM-ADDR-LINE1`.
- Give a PARM field for an `unsigned` type no separate sign.

[unreleased]: https://github.com/MWH997/banklang/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/MWH997/banklang/releases/tag/v0.9.0
