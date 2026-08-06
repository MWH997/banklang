# Changelog

Entries before the response to `docs/audit-2026-08-05.md` are in
[docs/changelog/before-2026-08-05.md](docs/changelog/before-2026-08-05.md). One
`Unreleased` section had reached 126 KB, which is a document nobody reads to the
end of.

## Unreleased

### Fixed — the target rejects it

- **`ROUNDED MODE IS` is not Enterprise COBOL, and `NEAREST-EVEN` is not a word it has ever heard of.** The phrase is COBOL 2002; Enterprise COBOL has one rounding phrase, `ROUNDED`, defined as half-up away from zero, and no `MODE` sub-phrase at all. It compiled for two years because GnuCOBOL's default dialect is a superset of every COBOL it knows. Five of the seven modes BankTS offers are now arithmetic the compiler writes out — a truncation, the excess that truncation discarded, and a conditional step of one unit in the last place — with a division rounding from `DIVIDE ... REMAINDER`, which is exact, because a quotient has no truncation to subtract from. `BANK-DEC-006` refuses a rounding whose work fields would not fit in the eighteen digits `ARITH(COMPAT)` allows.
- **A 31-character COBOL word.** `IS-ELIGIBLE-FOR-INTEREST-RESULT` was a base name already at the limit with a generated suffix on the end. Every generated name now goes through one function that fits it to 30 characters by abbreviating its longest segment, and every name in every artifact is checked.
- **The generated job described a build that could not succeed.** Dataset names were built by turning the build path into qualifiers, so `dist/cobol/BATCH-INTEREST-ACCRUAL.cbl` became `DIST.COBOL.BATCHINTERESTACCRUAL` — a 20-character qualifier, and a JCL error before the compiler was reached. The compile step had no `STEPLIB` and none of the sixteen work files, the link-edit ran `PGM=IEWL` with no LE libraries on `SYSLIB`, and the run step had no `STEPLIB` at all, so a job that compiled and linked perfectly ended S806. It now has two forms, both taken from `IGYWCL` as the Programming Guide prints it: the default `EXEC`s the cataloged procedure with only the DDs its own parameter list documents as the caller's, and the expanded form writes the same steps out for a site that has none installed.
- **A `PERFORM` of a paragraph that ended in `GOBACK`.** A failure ended where it was found, inside a range the caller had performed — so a transaction with an `on failure` handler ran it for a bounds violation and skipped it for an arithmetic overflow. There is one failure path now: set the return code, name the failure, leave through the enclosing routine's exit. `BANK-MAIN` is the only paragraph that ends the program.
- **The `PROGRAM-ID` was the module's full name.** Under the default `PGMNAME(COMPAT)` an external program-name is folded to uppercase, truncated to eight characters and has its hyphens translated to zero, so `PROGRAM-ID. ONLINE-ENQUIRY.` defined the entry point `ONLINE0E` while the job's `GOPGM=` and `EXEC PGM=` both said `ONLINEEN`. The program-name, the member name, the artifact file name and the `EXEC PGM=` are now one string from one rule.
- **`EXEC SQL DECLARE CURSOR` was written in Area A**, alongside the level 01 entries it sits among, where only a header or a level indicator belongs.

### Fixed — it compiled, ran, and gave the wrong answer

- **A loop stopped by its own bound reported success.** A five-million-record master processed the first million, closed its files, wrote its audit event and ended RC=0 — indistinguishable from a clean night, in an example whose own comment said the bound was what stopped a corrupt file spinning the job. The two exits are now told apart exactly, by re-evaluating the loop's condition, and the bound stopping unfinished work fails the step. A cursor loop is keyed on `SQLCODE = 0` for the same reason.
- **`read into` copied out of the record area outside the `AT END` guard.** After `AT END` the record area is undefined; GnuCOBOL leaves the last record in the buffer, so locally it read the previous record and every test passed. The copy is now the READ's own `NOT AT END` phrase.
- **Db2 errors collapsed into "not found".** A `-911` deadlock, a `-904` resource that was not available or a `-805` package that was never bound became a successful reply saying the account does not exist, and `online-enquiry` then committed it. The example has a fourth outcome, and `BANK-SQL-007` refuses a body whose tests cannot separate an error from an absent row — `!= 0` does not, putting `+100` and `-911` on the same side.
- **CICS responses were compared against numbers.** The API Reference names one value a program may write — a normal return is `DFHRESP(NORMAL)` — and says the rest are tested "by means of DFHRESP". Zero now generates the condition name and `BANK-CICS-004` refuses any other number.
- **A batch entry transaction's scalar parameters were never populated.** The idempotency key satisfying `BANK-TXN-001` was uninitialised working storage, moved straight into the audit correlation. They now arrive in the job's PARM behind the halfword length z/OS puts there, and a PARM of the wrong length ends the step rather than being read past.
- **An IMS program was given a PARM area it had no parameter list to receive.** The region enters it with its PCBs, so the program read a linkage group whose address nothing had set and then ended the step with return code 12.
- **`EXEC CICS RETURN` was not followed by `GOBACK`**, so under a run time where RETURN is an ordinary call the transaction ran its whole body a second time.

### Added — reading an existing estate

- **`bankc copybook import`.** A production copybook read into a BankTS record: banner comments, two-digit repeat counts, groups inside groups, tables, level-88 condition names and level-66 renames. The record is emitted back to a copybook and compared field by field — same names, same order, same offsets, same lengths, same pictures — and an import that does not survive that is refused rather than written, because a field read at the wrong length moves every field after it. A copybook this compiler generated round-trips byte for byte.
- **`bankc dclgen import`.** A DCLGEN member read into a BankTS record, with each column's real SQL type and its nullability from the catalogue — so a column that may be null becomes `nullable<T>` and the compiler requires a presence check. Every type is turned back into a picture and compared against DCLGEN's own COBOL declaration for the same column, so a disagreement is this compiler being wrong about Db2.
- **`unsigned<p,s>`**, which is `PIC 9(n)` — the most common numeric picture in a copybook, and a byte narrower than `zoned`.

### Added — checking

- **A conformance linter**, `packages/conformance-lint`, that reads a `.cbl`, `.cpy` or `.jcl` as text and knows nothing about how it was produced. Thirty characters, column 72, Area A, eighteen digits under `ARITH(COMPAT)`, reserved words, resolvable `CALL`s; and for JCL, card length, name fields, dataset qualifiers, continuations and the DDs each step type cannot run without. Every rule cites its manual.
- **The vocabulary rule**, which is the one that would have caught `NEAREST-EVEN`: every word in a generated program is either a name it declares or a word Enterprise COBOL reserves. The list is extracted from Appendix E's own table by `tools/extract-ibm-words.ts` rather than typed from memory.
- **The linter reads the checked-in fixtures and the evidence bundles too.** Two of the audit's findings were sitting in `tests/fixtures/`, where every run of the suite compared each against itself and agreed.
- **`pnpm fixtures:refresh` and `pnpm evidence:refresh`.** Both sets are generated now rather than maintained by hand, and `tests/golden-fixtures.test.ts` compares every one — including the fixture no test had ever named.
- **The rounding sequences are executed and compared against exact arithmetic.** An oracle holds the value as a rational in two BigInts and rounds it by the rule each mode names; the generated program computes the same case and logs its answer. Both shapes, seven modes, cases chosen to land on and around every boundary rather than at random.
- **The GnuCOBOL gate compiles under `tools/banklang-ibm.conf`**, a dialect configuration shaped to Enterprise COBOL 6.4 with every departure from `ibm-strict` carrying the manual it comes from, and again under the default dialect — treating a difference between them as a finding rather than as noise.

### Added — the generated program reads like one somebody wrote

- **A prologue**: what the program is entered at, how and with what, every file under its DD name with its record length, the modules it calls, the copybooks it needs, what each return code means, and whether a rerun is safe. Derived from the program rather than maintained by editing.
- **A `CBL` statement** naming the compiler options the program's behaviour depends on. Every one is IBM's default; stating them is the point, because an installation's options module can change any of them and several change what the program computes rather than how it is compiled.
- **File status through condition names** rather than reference modification on the first character, with `"00" THRU "09"` for IBM's successful-completion class.
- **`BLOCK CONTAINS 0 RECORDS` and `RECORDING MODE`** on a QSAM `FD`.
- **A copy is a `MOVE`**, not a `COMPUTE` with no arithmetic in it.
- **One literal delimiter**, the one the `CBL` statement's `QUOTE` names.
- **Names carry a routine and an ordinal**, not a source position. Adding a blank line used to rename working storage.
- **An index-name shared by two records is qualified by its record**, two `INDEXED BY LINES-FLD-IDX` clauses being two definitions of one name.
- **The SQL declare section holds host variables and closes**, rather than running to the end of working storage with the ledger and audit interface groups inside it.

### Added — configuration

- **`runtimeOptions`** in `banklang.json`, written onto the job's `CEEOPTS` DD, one card each. A long-running batch's heap and stack depend on the region and the data, so the compiler provides the place rather than the numbers.

### Added — examples, a job, and conversions

- **Nine examples** the audit named: `parm-driven-batch`, `high-volume-master`, `rounding-conformance`, `failed-open`, `full-disk`, `deadlock-retry`, `vsam-browse`, `mq-request-reply`, `report-with-controls`. Nothing showed scale, nothing showed failure, and nothing showed a night; these do.
- **`bankc job`** — a job directory of several programs and a sort in one JCL stream, chained by the datasets the programs already agree on and stopped by `COND` when a step fails. `end-of-day-settlement` is extract → sort → post → report, and only the posting step keeps a restart position, because only it cannot simply be rerun.
- **`conversions/`** — existing COBOL on one side, the BankTS it becomes on the other, and what the compiler produced from that BankTS underneath. Five of them, with generated measurements on each page and a statement of what each conversion changes about what the program does. Every original was written for this repository in period style, and the index says so.
- **`start` may name an alternate key**, which is nearly always why the alternate exists.
- **`reserved <n>;`** — `FILLER PIC X(n)`. The copybook importer refused a `FILLER` outright, which is the right answer to "can this be laid out short?" and a useless answer to "can this copybook be imported?"

### Added — the tests that find what nobody thought of

- **Sixty random valid programs**, generated on boundaries a person does not choose: names at 29, 30 and 31 characters, every rounding mode, precisions and scales at the `ARITH(COMPAT)` edge, tables at one occurrence and at five hundred. Each has to compile clean, pass the conformance linter and be accepted by `cobc`. It found `PIC S9(0)V99` for a `decimal<2, 2>`, and a function name long enough to give its paragraph, its parameter cell, its result field and its exit paragraph one thirty-character word.
- **`duplicate-name`** in the conformance linter: two things in one program declared under the same name, compared under the path that qualifies them. What `IGYCRCTL` reports as "redefinition of X", read off the text rather than derived from the emitter's intentions.
- **Meta-tests.** No statement kind may be written once in the whole suite; every diagnostic catalogued as implemented must be named by a test; the evidence grades are counted into `evidence/GRADES.md`. They found five catalogued rules nothing provoked, two CICS commands with one test each, and a key on a `rewriteFile` accepted silently.
- **`pnpm test:mutation`** — Stryker against the typechecker and the semantic analyser, the two packages that decide whether a program is refused. 4,585 mutants, 69.88% overall and 78.59% of what the tests reach, with the counts and what they are worth in `docs/verification.md`. It found a defect in a rule written an hour before it ran: `BANK-SQL-008` tested for a commit, and mutating that test to `true` survived the whole suite, which meant nothing distinguished a commit in a cursor loop from a rollback.

### Added — reading COBOL that already exists

- **`bankc analyse`**: programs, paragraphs, the `PERFORM` and `GO TO` graph as Mermaid, files and whether each binds a `FILE STATUS`, every `EXEC SQL` and `EXEC CICS` with what it names and whether it captures `RESP`, calls, copybooks, `ALTER`. It compiles nothing, which is what lets it read a member whose copybooks nobody has — and every report prints what that costs.

### Fixed — found while building the above

- **The formatter deleted code.** It printed nothing at all for seventeen of the thirty statement kinds, so `pnpm fmt` silently removed every `log`, `commit`, `rollback`, `checkpoint`, `restart`, `getMessage`, `initiate` and `on error` handler from a program — and the round-trip test compared the list of declaration kinds, which survives having every statement removed. Both switches are exhaustive over `never` now, and the test compares the whole tree.
- **Six IR walkers each enumerated the block-carrying statement kinds** and every one missed `QueueStatement`, so a transaction whose only audit event was inside an MQ get was reported as having none.
- **Two files whose names agree in eight characters share a DD name** (`BANK-FILE-012`), so one step's output is written over the dataset the next step reads. Two programs in one job whose module names agree in eight are one load module, which `bankc job` refuses.
- **Every checked-in evidence bundle carried this machine's absolute paths**, so none of it could be reproduced byte for byte anywhere else — in a project whose first claim is that the same input always produces the same output.
- **A PARM field for an `unsigned` type was given a separate sign**, so a date declared `unsigned<8,0>` cost nine characters and had to be keyed `+20260805`.
- **`""` is a zero-length literal**, which Enterprise COBOL does not have.
- **A digit now starts a word** in a generated name: `CM-ADDR-LINE-1`, which is what a copybook holds, rather than `CM-ADDR-LINE1`.

### Added — Db2

- **`cursor ... hold`** emits `DECLARE ... CURSOR WITH HOLD FOR`, and **`cursor ... rowset n`** emits `WITH ROWSET POSITIONING` with a `FETCH ... FOR n ROWS` into a host-variable array per column — processing the last partial rowset before acting on the `+100` that arrives with it.
- **`BANK-SQL-008`** refuses a unit of work ended inside the loop over the cursor it closes. The manual draws the line: a `ROLLBACK` closes every open cursor, a `COMMIT` closes the ones that are not held. So `hold` saves a commit and saves nothing from a rollback, and either way the next `FETCH` answers `-501` having already committed part of the result set.
- **`BANK-SQL-009`** refuses a raw `COMMIT` or `ROLLBACK` written as SQL, which routes around `BANK-SQL-004` and the restart rules. `ROLLBACK TO SAVEPOINT` is left alone, because IMS and CICS allow it.

### Documentation

- Ten new pages, and the README split. `docs/getting-started.md` is the read-this-first path; `docs/for-mainframe-engineers.md` reads the generated COBOL construct by construct with the person who has to accept it; `docs/status-and-limits.md` promotes the honest-limits section out of the bottom of the README; and `docs/divergences.md` promotes the GnuCOBOL-against-IBM list out of `zos/README.md` into a numbered, citable one. `generated-code-standards.md`, `target-conformance.md`, `error-handling.md`, `numeric-model.md`, `jcl-model.md`, `security-and-data.md` and `comparison.md` are the rest.
- The README's flagship example printed `COMPUTE … ROUNDED MODE IS NEAREST-EVEN`. It now prints what the compiler emits.
- `docs/migration-analysis.md`, and the example table split four ways so nineteen examples are still findable.
- `docs/status-and-limits.md` names what is still missing rather than implying it: no zUnit generation, and four Db2 depths. zUnit is blocked on IBM's schema, which is not in `vendor-docs/` — inventing one from a published example is how this project came to emit a rounding phrase Enterprise COBOL has never had.
