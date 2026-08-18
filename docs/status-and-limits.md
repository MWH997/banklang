# Status and limits

Every limit on this page is true of BankLang 0.10.0. Where one has a plan
attached the plan is named; where it does not, it says so. Four states are kept
apart throughout, because each one closes in a different way:

| State               | What it means                                          |
| ------------------- | ------------------------------------------------------ |
| Design decision     | BankTS will not grow this. The exclusion is the point. |
| Not implemented     | It belongs in the language and is not written yet.     |
| Not validated       | It is implemented, and nothing has confirmed it works. |
| Environment missing | It can only be confirmed on hardware nobody here has.  |

This is a working compiler for a **deliberately narrow subset**, not a
production mainframe toolchain.

## Target and validation

- **Validated with GnuCOBOL, not IBM.** Every example compiles with GnuCOBOL in
  CI. No IBM Enterprise COBOL validation has been performed, and none is
  claimed. [`zos/`](../zos/README.md) makes that a bounded task rather than an open
  question: `pnpm tsx tools/zos-kit.ts` writes every program, copybook, and job
  in the member names the JCL expects, with a procedure and a results template.
  Nothing there has been run either, and the README says so.
- **Not production-ready.** It has never run against a real ledger, and no
  institution's money has moved through it.
- **The full mutation suite was not run for this release.** The current
  scheduled matrix has ten lanes; the targeted safety lane is the one 0.10.0
  ran, at 90.03% total and 92.67% of covered code, with every surviving mutant
  in it classified individually in [verification](verification.md). The other
  nine lanes are scheduled current-development measurements, not
  release-0.10.0 claims.

## Runtime validation

- **SQL and CICS are checked structurally, not semantically.** BankLang ships a
  precompiler that translates `EXEC SQL` and `EXEC CICS` the way `DSNHPC` and
  the CICS translator do, so every example compiles with GnuCOBOL. That proves
  the surrounding COBOL and every host variable resolve; it does not validate
  SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- **Executed only against a reference runtime, never IBM software.** The
  programs in [`runtime/`](../runtime/README.md) satisfy the ledger, audit, SQL,
  and CICS interfaces well enough to run a generated program end to end and
  check its arithmetic. `BANKLEDG` is not a bank ledger. `DSNHLI` parses no SQL
  and `DFHEI1` provides no task or syncpoint: a test can script what they report,
  so a `SQLCODE 100` or a `PGMIDERR` branch is executed rather than assumed, but
  every such value was written down by the test, not decided by a database or a
  region. Nothing has run on z/OS, against Db2, or in a CICS region.
- **Four of the 31 emitted COBOL verbs are not executed locally.** `ENTRY`,
  `INITIATE`, `GENERATE` and `TERMINATE` (a generated zUnit case's entry points
  and a Report Writer section) have nowhere local to run, so 27 of 31 is the
  denominator the differential lane reports. It is not 31 of 31.
  [Interpreter coverage](validation/interpreter-coverage.md).

## Language boundaries

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

## Character and file model

- **No UTF-8 character model.** `string<n>` is n bytes in the host code page.
  `USAGE NATIONAL` is emitted at the Enterprise COBOL width, but the character
  model behind it is not implemented: there is no encoding conversion, and
  length is counted in bytes rather than in characters. A design decision for
  now, with the reasoning in
  [ADR-0006](adr/0006-single-byte-character-model.md).
- **Multi-record `INPUT` is refused** (`BANK-FILE-015`). A file may carry
  several record layouts on output (`settlement-bill-file` writes a header, a
  detail and a trailer), but a program may not read one. The recommended
  alternative is one record, a type field and `REDEFINES`, and it has a hole in
  it: nothing forces the programmer to test the discriminator before using the
  overlay. Refused on evidence rather than on taste: the 143
  occurrences in X-COBOL deduplicated to 51 distinct files, none of them an
  application program.
- **Bounded split counting is refused.** `UNSTRING … TALLYING` has no BankTS
  spelling, for the same reason: 126 of the 130 statements in the corpus came
  from one NIST conformance file vendored into several repositories.
- **`lineSequential` files are read or written, never updated in place**
  (`BANK-FILE-013`). Enterprise COBOL does not allow `OPEN I-O` on one, and
  neither does BankTS. Records are printable characters only, so a packed
  decimal in a `lineSequential` record is a compile error rather than bytes that
  do not survive the format (`BANK-FILE-014`). [Files](language/files.md).

## Tooling

- **The VS Code extension is unpublished.** Its language server is built by
  `pnpm --filter banklang-vscode build:server` and driven over stdio by
  `tests/language-server-session.test.ts`,
  which holds a whole session (initialize, open, hover, symbols, format, change,
  close, shutdown) against the bundle the extension loads. It has not been
  through marketplace review, and it has not been run inside VS Code itself.
- **No zUnit case has been run.** `bankc zunit` writes the three artifacts and
  the driver compiles under GnuCOBOL in both dialects, which is narrower
  evidence than it sounds: `COPY EQAITERC` resolves to a stand-in declaring the
  two fields the driver names, because IBM's copybook is not here. Two values in
  the configuration are inferred rather than observed and are named as such
  (D20, D21). What a case can assert is also narrow by construction (the PARM
  the step is started with, and the calls the program makes), because those are
  what a driver running in its own program can see.
- **Dynamic SQL is refused, by design** (`BANK-SQL-002`). BankLang does not
  parse SQL (a `sql` declaration reaches the precompiler as written), so
  isolation levels, savepoints, `LOCK TABLE` and `GET DIAGNOSTICS` need nothing
  from the compiler and have always worked. Cursors are the part it does model,
  because their `OPEN`, `FETCH` and `CLOSE` are generated: `hold`, `rowset n`
  and `scroll` are spelled in the language. A statement assembled at run time is
  the one shape that cannot be checked before it exists, so it is not accepted.
- **`bankc analyse` reads rather than compiles.** It is a count of what is in
  the source, not an estimate of what a conversion costs, and
  [migration-analysis.md](migration-analysis.md) lists what it cannot see.

## What may be claimed, and what may not

The wording is fixed in advance, so that the question "is this overstated?" has
an answer written before there is any incentive to answer it loosely.

Allowed while no IBM compiler has run this output:

> BankLang emits artifacts targeting IBM Enterprise COBOL for z/OS 6.4.

Not allowed:

> Validated with IBM Enterprise COBOL. IBM-compatible. Production-ready on z/OS.

Allowed once a real validation exists, and only for what it covered:

> Selected generated artifacts were validated with IBM Enterprise COBOL for
> z/OS under the documented environment, compiler version, and compiler
> options.

The target line is 6.4 throughout: that is the Language Reference and
Programming Guide every citation in [target-conformance.md](target-conformance.md)
comes from, the level `tools/banklang-ibm.conf` is shaped to, and the version
named in the generated `CBL` statement's options.

## Two lists that go further

- [divergences.md](divergences.md): every place GnuCOBOL and Enterprise COBOL
  are known or suspected to disagree, numbered so they can be cited. A finding
  there is a real defect in this compiler.
- [comparison.md](comparison.md): what BankLang is worse at than an AI
  converter, than Micro Focus, and than hand-writing COBOL.

## Closing the biggest one

`pnpm zos:kit` writes every generated program, copybook and job into
`dist/zos/`, in the eight-character member names the JCL already expects, with
`MANIFEST.txt` saying which dataset each folder belongs in.
[zos/README.md](../zos/README.md) is the procedure and `RESULTS-TEMPLATE.md` is
what to fill in.

Until `RESULTS.md` exists, every claim in this repository stops at GnuCOBOL.
