# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the entry style follows [Common Changelog](https://common-changelog.org/): one
line per change, in the imperative, with the explanation in the document it
links to rather than here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is pre-1.0, so
the language and the CLI may still change between minor versions.

0.9.0 is the first version this file records. Everything before it is in the
commit history, which is where a working record belongs: `git log --reverse`
reads it in order. 0.10.0 is the first version actually published — nothing
earlier was tagged or released.

## [Unreleased]

### Added

- Publish the site to Cloudflare Pages on every push to `main`, from the same
  `pnpm build:site` a contributor runs — [deploy](.github/workflows/deploy.yml).
- Link back to the author's site from every page's navigation, and hold the
  four page shells to the same links.

## [0.10.0] — 2026-08-09

The release that measures this compiler against COBOL nobody wrote for it.

0.9.0 answered an audit of the compiler's own output. This one asks the harder
question — what does real COBOL actually contain, and how much of it can BankTS
represent — and answers it against four independent corpora, a semantic
benchmark whose expectations are somebody else's, and a defect suite. The
answers changed the language: `lineSequential` exists because 309 of 5,195 real
files needed it, and multi-record `INPUT` is still refused because the 143
occurrences turned out to be 51 distinct files and no application program among
them.

The compiler also grew a reference runtime that executes what it emits, so every
example is now run by two engines and compared rather than only compiled; six
diagnostics, including a flow-sensitive rule for file operations whose outcome a
program never looked at; and the reproducibility work that lets a stranger clone
this repository and regenerate every number on the validation page from pinned
inputs.

Native IBM Enterprise COBOL validation has still not been performed. There is
now a deterministic bundle ready for somebody who can perform it.

### Added

- Report the compiler's version, whether GnuCOBOL is installed and which one,
  and that native IBM Enterprise COBOL is not detected, from `bankc doctor` —
  [toolchain](docs/toolchain.md).
- Read and write text files with a `lineSequential` organisation, under the
  restrictions Enterprise COBOL puts on one — [files](docs/language/files.md).
- Measure this compiler against COBOL nobody wrote for it: independent corpora,
  their licences, and the rules that decide what BankTS can represent —
  [horizontal validation](docs/validation/horizontal-validation.md).
- Report which of COBOL's constructs a member contains, so an estate inventory
  says what a migration would have to cover — `bankc analyse`.
- Keep what a measurement said before a language change, and publish the
  before-and-after from those files rather than from memory —
  `pnpm horizontal:snapshot`.
- Compute every colour pair in both themes against WCAG AA on every build,
  rather than recording a measurement.
- Link the site from the top of the README, above the badges.
- Refuse a program that would abend on z/OS, with a rule-based pass over emitted
  COBOL — [target conformance](docs/target-conformance.md).
- Refuse a CICS transaction whose computed record never reaches `DFHCOMMAREA`
  (`BANK-CICS-005`) — [CICS](docs/language/cics.md).
- Refuse two names that abbreviate to one COBOL word, which the generated
  program declared twice and no COBOL compiler accepts (`BANK-NAME-001`) —
  [for mainframe engineers](docs/for-mainframe-engineers.md).
- Read a `checkpoint` as the commit it is, so a cursor loop that checkpoints
  needs `hold` (`BANK-SQL-008`) — [SQL](docs/language/sql.md).
- Supply the playground's Run tab with input: the entry record, the dataset, the
  PARM, and the rows a cursor answers — [playground](packages/playground/).
- Give reachable throws catalogue identifiers and locations, and print a stack
  only where the defect is the compiler's — [toolchain](docs/toolchain.md).
- Check the four page templates with `axe-core` on every build.
- Fail the build when the playground bundle grows past its budget, and split the
  runtime out of the first download — [playground](packages/playground/).
- Emit `_headers`: a content security policy, cache lifetimes, and `noindex` on
  the preview hostname.
- Publish `/blog/feed.xml`, linked from every page.
- Publish `/about/`, and a byline on every post, from `CITATION.cff`.
- Emit share metadata on documentation pages and the playground, which had none.
- Run the generated COBOL in the playground, against the same `runtime/*.cbl`
  programs CI compiles — [verification](docs/verification.md).
- Compare every example under `cobc` and under the interpreter and fail on any
  disagreement, which is what makes the interpreter's green mean something —
  `tests/cobol-runtime-differential.test.ts`.
- Publish the grammar as EBNF, held to the lexer's own keyword table in both
  directions — [grammar](docs/language/grammar.md).
- Say what is stable and what is not, rather than leaving "pre-1.0" to carry the
  whole answer — [stability](docs/language/stability.md).
- Record why a program is one module in one file —
  [ADR-0004](docs/adr/0004-one-module-one-program.md).
- Format COBOL with `bankc fmt program.cbl`, checked by executing the formatted
  program and requiring the same output as the one it came from.
- Highlight COBOL in the playground's output pane, which had none while every
  other page of the site did.
- Add a Format button to the playground, using the compiler's own formatter.
- Add `blog/`, rendered to `/blog/` with structured data and a sitemap entry.
- Execute emitted `SORT` and `MERGE` in the independent runtime, closing the
  last differential blind spot in locally executable output —
  [interpreter coverage](docs/validation/interpreter-coverage.md).
- Carry several record layouts on one output file, `record Head, Detail` —
  [files](docs/language/files.md).
- Diagnose a file operation whose outcome the program never handled,
  flow-sensitively — `BANK-FILE-017`.
- Gate the runtime on every locally executable verb the backend emits, so a new
  one cannot reopen the blind spot silently.

### Fixed

- Say what a mistyped project path was expected to name, rather than Node's
  `ENOENT … open '/…/src/main.bank.ts'` — [toolchain](docs/toolchain.md).
- Refuse `--watch` on a command that reads no project, rather than watching a
  path built from a diagnostic identifier — [toolchain](docs/toolchain.md).
- Tell the release checklist to run `pnpm examples:verify` rather than a loop
  over `examples/*/`, which fails on the example that is a job of four —
  [releasing](docs/releasing.md).
- Count every way a program reads the record an operation filled, not only a
  field read out of it: a write, a release, a queue put and eight more were not
  uses (`BANK-FILE-017`) — [files](docs/language/files.md).
- Walk the `on page` block of a write and a transaction's `on failure` handler,
  neither of which the file-outcome check entered — `BANK-FILE-017`.
- Stop a successful sort reporting failure: GnuCOBOL sets no file status on a
  `USING` or `GIVING` file — [D27](docs/divergences.md).
- Emit `WITH DUPLICATES IN ORDER`, since the order of equal sort keys is
  otherwise undefined — [D26](docs/divergences.md).
- Refuse a DD name that is also a data item, which takes the file name from that
  item's contents on both compilers — `BANK-FILE-016`.
- Diagnose a value-building call nested in an expression rather than raising an
  internal invariant — `BANK-TYPE-030`.
- Write the named record's own length rather than the record area's, which a
  file with one layout could not distinguish.
- Measure a fixed record through the interpreter's parser rather than a regex
  that missed a `zoned` field's `SIGN IS TRAILING SEPARATE`.
- Allow a branch inside a loop body in a function, which was refused while a
  `switch` in the same position compiled.
- Name the syntax the author wrote in three diagnostics that printed an internal
  node kind: "A IfStatement is not allowed inside a loop body."
- Allow each inline script by its sha256 rather than by `'unsafe-inline'`, and
  drop the inline `onsubmit` a hash cannot cover.
- Write the response headers as request paths, so the cache rules match the
  pages Cloudflare serves rather than the redirects to them.
- Exclude per-build preview hostnames from search indexing, which one
  placeholder never reached.
- Raise three light-theme colours and the edge of every control to WCAG AA,
  including the documentation search box under SC 1.4.11.
- Install the `--watch` watcher before the first build, so a change saved during
  it is not lost — [toolchain](docs/toolchain.md).
- Issue one `MQCONN` per queue manager rather than per queue, and forgive
  `MQRC_ALREADY_CONNECTED` — [MQ](docs/language/mq.md).
- Return the CICS reply through the commarea, on the failure path as well —
  [error handling](docs/error-handling.md).
- Count the banking safety rules for the sentence about banking safety rules,
  rather than the whole catalogue.
- Keep a `--watch` session alive when a rebuild throws, and watch the right
  directory for a job — [toolchain](docs/toolchain.md).
- Size an item with a `SIGN` clause a byte wider, and read `IS NUMERIC` from the
  bytes rather than from the decoded value, in the interpreter.
- Alias an 01 `REDEFINES` onto the record it names instead of giving it storage
  of its own, in the interpreter.
- Name the playground's two editors, its panes and its theme toggle, and put a
  real space in a summary chip.
- Put the documentation's `h1` before the sidebar's group labels, which were
  headings and are not any more.
- Declare the URL the host serves as canonical, and derive the sitemap from what
  the build writes.
- Give a figure holding generated COBOL the page's width, since a column clipped
  the arithmetic it exists to show.
- Exclude working papers from the site by the directory they are in rather than
  by a list of names nobody updates.
- Answer `bankc --version` with a version. It printed the help text and exited
  0, so nothing shelling out to the compiler could report which one it used.
- Link `CBLTDLI` and `BANKMQ` into the reference runtime, which
  `runtime/README.md` has documented and `RUNTIME_PROGRAMS` did not list.
- Set `COB_PRE_LOAD`, so a runtime file holding several programs is reachable by
  every name it exports. `examples/mq-request-reply` had never been executed.
- Execute the examples that take a PARM, by supplying the driver a job step
  would. `cobc -x` refuses a main program with a `USING` clause, and nothing
  supplied one, so four examples had never been run.
- Honour `SELECT OPTIONAL`: a missing dataset opens with file status 05 rather
  than 35, which is the difference between "no checkpoint, start from the top"
  and a failure — [files](docs/language/files.md).
- Cap the playground's output pane on a narrow screen, where 1227px of COBOL
  painted over the trace bar and the footer at 390px.
- Stop the site scrolling sideways at 360px. `overflow-x: hidden` was on `body`,
  which cannot suppress a scrollbar on the root element.
- Give the glossary one level-one heading instead of twenty, and the playground
  one instead of none.
- Count the executed examples on the landing page rather than writing the number
  in it.
- Say which GnuCOBOL to install. Ubuntu ships 3.1.2 and this project measures
  everything against 3.2 — [getting started](docs/getting-started.md).
- Point the `$schema` in a generated `banklang.json` at a URL that resolves,
  rather than at a domain this project does not own —
  [toolchain](docs/toolchain.md).
- Compile the reference runtime once per machine rather than six modules per
  test, so the executed conformance tests stop timing out on a loaded runner —
  [verification](docs/verification.md).
- Remove the claim of Docker-based verification from `CONTRIBUTING.md`; there is
  no Dockerfile in this repository.

### Security

- Upgrade Vitest to 4 and pin `vite` and `qs`, clearing eight advisories in the
  build and test tooling, one of them critical. `pnpm audit` now reports none.

### Changed

- Count distinct file contents rather than occurrences: 143 multi-record
  `INPUT` descriptions are 51 files and 130 `TALLYING` statements are 7 —
  [horizontal validation](docs/validation/horizontal-validation.md).
- Type a conformance finding's `rule` as the union of valid rule ids rather than
  `string`, so a misspelled id cannot be reported.
- Declare the project's licence, repository, description and version in
  `package.json`, which is where a licence scanner and an SBOM generator look.
- Split the language reference into thirteen topic pages under
  [docs/language/](docs/language/), and point every diagnostic at a page rather
  than at a section number two sections shared.
- Type every index access as possibly absent (`noUncheckedIndexedAccess`), and
  turn `no-unnecessary-condition` back on now that it can tell a dead guard from
  a live one — [verification](docs/verification.md).
- Declare a runtime interface group only where the program calls its module, so
  a program that audits carries no ledger storage.
- Declare the bounds status and copy index only where a check or a table copy is
  generated, rather than wherever a record declares an array.

### Added

- Add scrollable cursors: `cursor ... scroll` and
  `for each ... from <n> backward`, the last Db2 depth the roadmap named and the
  one that needed syntax rather than pass-through —
  [SQL](docs/language/sql.md).
- Add `pnpm sbom:release`, producing a CycloneDX 1.7 bill of materials with a
  licence for every component, and attach it to the release.
- Add `pnpm build:vsix`, packaging the VS Code extension and reading the archive
  back to check what is in it.
- Add a release workflow that runs the whole of CI, refuses an unsigned tag,
  attests what it built through Sigstore, and publishes the changelog's own
  section as the release notes.
- Give the playground the site's header, a one-line explanation of the panes,
  and a versioned share link.
- Link every example README and every runnable documentation block into the
  playground, by name where an example has one.
- Render every document under `docs/` as part of the site, with the sidebar
  grouped as the README groups it and a search index the browser scans.
- Add a weekly `advisories` job, opening an issue when a dependency picks up a
  published advisory.
- Add a JSON Schema for `banklang.json`, built from the constants the loader
  validates against and served by `pnpm build:site`.
- Add `pnpm build:site`, producing the landing page, the playground and the
  site's assets in one tree.
- Add a landing page whose every code block, diagnostic and count is generated
  from the compiler, and a test that fails when the page prints a line the
  compiler does not emit.
- Add an Open Graph card at 1200×630, rendered from real generated COBOL.
- Add [for-decision-makers.md](docs/for-decision-makers.md), for whoever has to
  accept the risk rather than the COBOL.
- Add a conformance-finding issue template, for a divergence from what
  Enterprise COBOL, CICS, Db2 or z/OS would accept.
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
- Scope the site and the pre-public checklist at
  `banklang.mwhassan.com` and everything else before the repository is public.
- Hold every fenced COBOL block in every document to what the compiler emits,
  rather than the README alone.
- State how much each corpus assertion looked at, so one that stops finding
  anything fails instead of passing.
- Require every path the VS Code extension resolves at run time to be written by
  one of its build scripts.

### Fixed

- Verify the examples in CI through the one enumeration every other tool uses,
  rather than walking the directory and running `bankc test` on the job of four
  programs.
- Report a cited source that redirects to a front page, which answers 200 and
  reads as alive. NIST's COBOL-85 test suite page had already become one.
- Find a program name written on the line after `PROGRAM-ID.`, which is legal
  COBOL and which nine of CardDemo's thirty-one programs do — all nine were
  inventoried with no name — [migration analysis](docs/migration-analysis.md).
- Stop `bankc analyse` reporting a file for every data name ending `-SELECT` and
  every message containing the word.
- Write a licence into the bill of materials for the ten proprietary components
  pnpm's generator drops, which were the only ten it said nothing about.
- Number the VS Code extension `0.9.0` rather than `0.1.0`. It bundles the
  compiler, and two versions moving apart let the editor report a diagnostic the
  command line does not.
- Report the project's version from the language server, which had answered
  `0.1.0` on every `initialize` since it was written.
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
an external audit on 5 August 2026. It found a rounding phrase
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
