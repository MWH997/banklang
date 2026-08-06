# Status and honest limits

The most credibility-building page in this repository, which is why it is a page
rather than the last section of a README nobody scrolls to.

Everything here is a limit that is true today. Where one has a plan attached,
the plan is named; where it does not, it says so.

This is a working compiler for a **deliberately narrow subset**, not a
production mainframe toolchain. Being precise about that matters more than
sounding impressive:

- **Validated with GnuCOBOL, not IBM.** Every example compiles with GnuCOBOL in
  CI. No IBM Enterprise COBOL validation has been performed, and none is
  claimed. [`zos/`](../zos/README.md) makes that a bounded task rather than an open
  question: `pnpm tsx tools/zos-kit.ts` writes every program, copybook, and job
  in the member names the JCL expects, with a procedure and a results template.
  Nothing there has been run either, and the README says so.
- **Not production-ready.** It has never run against a real ledger, and no
  institution's money has moved through it.
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
- **The VS Code extension is unpublished.** It builds and typechecks in CI, but
  it has not been through marketplace review.
- **No zUnit case has been run.** `bankc zunit` writes the three artifacts and
  the driver compiles under GnuCOBOL in both dialects, which is narrower
  evidence than it sounds: `COPY EQAITERC` resolves to a stand-in declaring the
  two fields the driver names, because IBM's copybook is not here. Two values in
  the configuration are inferred rather than observed and are named as such
  (D20, D21). What a case can assert is also narrow by construction — the PARM
  the step is started with, and the calls the program makes — because those are
  what a driver running in its own program can see.
- **Db2's depth is now there, and three of the five were never missing.**
  BankLang does not parse SQL, so isolation levels, savepoints and `LOCK TABLE`
  always worked — what was missing was a test, a rule, and a page saying so.
  `WITH HOLD` and multi-row `FETCH` are real additions (`cursor ... hold`,
  `cursor ... rowset n`). What remains genuinely absent is scrollable cursors,
  `GET DIAGNOSTICS`, and dynamic SQL — the last on purpose (`BANK-SQL-002`).
- **`bankc analyse` reads rather than compiles.** It is a count of what is in
  the source, not an estimate of what a conversion costs, and
  [migration-analysis.md](migration-analysis.md) lists what it cannot see.

## The two lists that matter more than this page

- [divergences.md](divergences.md) — every place GnuCOBOL and Enterprise COBOL
  are known or suspected to disagree, numbered so they can be cited. A finding
  there is a real defect in this compiler.
- [comparison.md](comparison.md) — what BankLang is worse at than an AI
  converter, than Micro Focus, and than hand-writing COBOL.

## Closing the biggest one

`pnpm zos:kit` writes every generated program, copybook and job into
`dist/zos/`, in the eight-character member names the JCL already expects, with
`MANIFEST.txt` saying which dataset each folder belongs in.
[zos/README.md](../zos/README.md) is the procedure and `RESULTS-TEMPLATE.md` is
what to fill in.

Until `RESULTS.md` exists, every claim in this repository stops at GnuCOBOL, and
every page says so.
