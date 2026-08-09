# Glossary

The mainframe and compiler terms the rest of the documentation uses without
stopping to explain them. A term earns a place here when somebody reading the
generated COBOL, the JCL or a diagnostic would otherwise have to look it up.

Every entry cites primary documentation — IBM, GnuCOBOL, TypeScript, Ecma — so
the terminology can be checked against the source rather than against this
page's wording. `pnpm docs:citations` fetches all of them; `citations.json`
records what each one resolved to.

## Entry template

```md
### Term

**Definition:** What it is.

**Why it matters to BankLang:** What the compiler does about it, named
concretely — a diagnostic, a generated construct, an example that runs it.

**References:**

- [Reference title](https://example.com)
```

---

## A

### Audit event

**Definition:** A durable, named record that a business-significant action occurred, carrying a correlation value that ties it to the originating request.

**Why it matters to BankLang:** `language-reference.md` section 11 requires every transaction to emit at least one audit event with a compile-time constant name. BankLang enforces this with `BANK-AUD-001` and `BANK-AUD-003`, and lowers the event to a call against the audit interface described in [ADR-0003](adr/0003-ledger-and-audit-calling-convention.md). A statically known event name keeps audit trails greppable and stable across releases.

**References:**

- [Diagnostics](diagnostics.md)
- [Language reference](language-reference.md)

## B

### Backend profile

**Definition:** A named target configuration that controls how BankLang emits
COBOL and related artifacts for a specific environment.

**Why it matters to BankLang:** Enterprise COBOL and GnuCOBOL are not the same
target, and the whole point of naming the profile is that a green `cobc` run
locally cannot be reported as an IBM result.
[divergences.md](divergences.md) lists where the two compilers actually
disagree.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### BankLang

**Definition:** This project: the compiler and toolchain that turn BankTS into
COBOL, copybooks, JCL, a source map and an audit bundle.

**Why it matters to BankLang:** Everything it emits is decided by code somebody
can read, and the same input produces byte-identical output — which is what
`bankc verify` checks, and what makes a review of the output worth doing at all.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### BankTS

**Definition:** The source language BankLang compiles. A small banking language:
its type syntax is TypeScript's, and its statements — `transaction`, `file`,
`cursor`, `queue`, `on error` — are its own.

**Why it matters to BankLang:** BankTS is not a TypeScript dialect: `tsc` cannot
read a BankTS module. Borrowing the type syntax makes it approachable to read;
keeping the statements bespoke is what leaves the compiler able to prove things
about a program, which is what the `BANK-*` diagnostics are.

**References:**

- [TypeScript official site](https://www.typescriptlang.org/)
- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

### Bind

**Definition:** In Db2 application preparation, the step that turns the output of
the precompiler into the packages or plans Db2 executes against.

**Why it matters to BankLang:** A module that declares a `cursor` or runs `sql`
emits `EXEC SQL`, so the generated JCL carries the precompile and bind steps
rather than leaving somebody to add them.
[jcl-model.md](jcl-model.md) is the job it writes.

**References:**

- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 13 for z/OS: processing SQL statements by using the Db2 precompiler](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=preparation-processing-sql-statements-by-using-db2-precompiler)

## C

### CICS

**Definition:** IBM's transaction-processing environment on z/OS, under which
online programs run: the screen or service call arrives as a transaction, and
the program is given a working storage and a commarea rather than a job step.

**Why it matters to BankLang:** CICS is one of the two shapes a BankTS module
compiles to, the other being batch. A `cics transaction` takes its commarea as
the first record parameter and emits `EXEC CICS` commands, and `BANK-CICS-004`
refuses one whose response is never tested against a condition name.
[cics.md](language/cics.md) has the rules; `examples/online-enquiry` runs one.

**References:**

- [IBM Enterprise COBOL for z/OS 6.4 Programming Guide (SC27-8714-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/pgmvs.pdf)
- [CICS Transaction Server 6.x: fundamentals](https://www.ibm.com/docs/en/cics-ts/6.x?topic=fundamentals)

### CICS channel/container

**Definition:** The later CICS mechanism for passing data between programs. A
channel carries named containers, and neither is bounded by the 32 KB a commarea
is.

**Why it matters to BankLang:** Neither generated nor planned. BankLang passes a
commarea, which is what [cics.md](language/cics.md) describes, so a program
needing more than a commarea holds cannot be written in BankTS today.

**References:**

- [CICS Transaction Server 6.x: sharing data in CICS applications](https://www.ibm.com/docs/en/cics-ts/6.x?topic=applications-sharing-data-in-cics)

### CICS COMMAREA

**Definition:** The caller's own storage, addressed by a CICS program through
`DFHCOMMAREA` in the `LINKAGE SECTION`, and how one CICS program passes data to
the next.

**Why it matters to BankLang:** It is the first record parameter of a `cics
transaction`, and it carries the reply as well as the request, because the
caller reads back the same bytes it passed. The generated program tests
`EIBCALEN` before touching it — reading a commarea shorter than the record
claims is IBM's own rule, not a nicety.

**References:**

- [CICS Transaction Server 6.x: passing data to other programs by using COMMAREA](https://www.ibm.com/docs/en/cics-ts/6.x?topic=programs-commarea)

### COBOL

**Definition:** The business programming language a bank's core systems are
written in, standardised since 1960 and still the language the overnight batch
runs.

**Why it matters to BankLang:** It is the output, and it stays the output. The
generated program is meant to be read and reviewed by the engineers who own the
estate, which is why the house style is written down as a contract in
[generated-code-standards.md](generated-code-standards.md) rather than left to
the emitter.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### COBOL copybook

**Definition:** A COBOL source fragment pulled in by `COPY`, holding a record
layout that several programs share.

**Why it matters to BankLang:** It is the interface between a generated program
and everything already running. `bankc build` writes one copybook per record;
`bankc copybook import` reads an existing one back into BankTS, and refuses a
layout it cannot reproduce byte for byte rather than importing it at the wrong
offsets.

**References:**

- [IBM Enterprise COBOL 6.4: COPY statement](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=statements-copy-statement)

### COBOL division

**Definition:** One of the four top-level parts of a COBOL program:
`IDENTIFICATION`, `ENVIRONMENT`, `DATA` and `PROCEDURE`, always in that order.

**Why it matters to BankLang:** The emitter writes all four in order, with
division and section headers in Area A, because a reviewer finds their way
around a generated program the same way they find their way around one somebody
wrote.

**References:**

- [IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/lrmvs.pdf)
- [GnuCOBOL documentation](https://gnucobol.sourceforge.io/guides.html)

### COMP

**Definition:** The COBOL `USAGE` for binary storage — two, four or eight bytes
holding a whole number, rather than one byte per digit.

**Why it matters to BankLang:** `binary<n>` emits `PIC S9(n) COMP`, and money
never does — an amount is `COMP-3`. Binary is what a counter, a sequence number
or a code is held in, and BankLang keeps `COMP-5` separate as `native<n>` for
the cases where the value really is whatever the platform put there.
[types.md](language/types.md) has the whole mapping, byte counts included.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### COMP-3 / Packed decimal

**Definition:** IBM COBOL packed-decimal storage: two decimal digits to a byte,
with the sign in the low half of the last one.

**Why it matters to BankLang:** It is how every amount is stored. `decimal<p, s>`
emits `PIC S9(p-s)V9(s) COMP-3` and occupies `ceil((p+1)/2)` bytes, so a
`decimal<18, 2>` is ten bytes and a copybook BankLang writes lines up with one
it did not. Arithmetic stays exact, which is the reason not to use binary
floating point for money.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### Copybook layout

**Definition:** Where each field of a copybook record actually starts and how
many bytes it takes: order, picture, usage, sign, repetition and any overlap.

**Why it matters to BankLang:** A dataset is bytes at offsets, and nothing in it
records what those bytes mean. Move a field by one and every program reading
that file is wrong without failing. `bankc build` writes the layout it computed
into the audit bundle as `copybook-layout.json`, so the offsets can be compared
against the copybook they have to match.

**References:**

- [IBM Enterprise COBOL 6.4: USAGE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-usage-clause)
- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## D

### Db2 for z/OS

**Definition:** IBM's relational database on z/OS, reached from COBOL through
embedded SQL rather than a driver.

**Why it matters to BankLang:** It is the database BankTS `sql` statements and
`cursor` declarations compile against. The program gets host variables, an
`SQLCA` and `SQLCODE` tests it cannot skip, and the job gets the precompile and
bind steps that make any of it run. [sql.md](language/sql.md) is the reference.

**References:**

- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

### DD name

**Definition:** The data definition name that links a program's internal file reference to a dataset through JCL. On z/OS it is at most eight characters.

**Why it matters to BankLang:** A BankTS `file` declaration emits `SELECT ... ASSIGN TO <ddname>`, so BankLang folds the declared file name to a deterministic eight-character uppercase alphanumeric form. `accountInput` becomes `ACCOUNTI`.

**References:**

- [z/OS 3.1: DD statement](https://www.ibm.com/docs/en/zos/3.1.0?topic=reference-dd-statement)

### Decimal type

**Definition:** A number with a fixed count of digits and a fixed count of them
after the point, computed exactly rather than approximated.

**Why it matters to BankLang:** `decimal<18, 2>` is a number of taka, not a
float that is usually right. Precision and scale are part of the type, so the
compiler knows the scale of every intermediate: multiplying `decimal<18, 2>` by
`decimal<9, 4>` gives scale 6, and storing that back as money would drop four
digits, so `BANK-DEC-002` refuses it until you round explicitly.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### Double-entry bookkeeping

**Definition:** An accounting method in which every financial event is recorded as equal and opposite debit and credit entries, so total debits always equal total credits.

**Why it matters to BankLang:** `language-reference.md` section 10 requires debit and credit totals to balance for ledger-posting operations. BankLang checks this as `BANK-LED-001`. Because the compiler does not evaluate expressions, balance is proven structurally by comparing the multiset of debited and credited amount expressions. The check is conservative: it reports what it cannot prove rather than accepting it.

**References:**

- [Diagnostics](diagnostics.md)

## E

### EBCDIC

**Definition:** Extended Binary Coded Decimal Interchange Code, the character
encoding z/OS uses. Not ASCII, and not a permutation of it: the letters are not
contiguous, and digits sort above letters rather than below them.

**Why it matters to BankLang:** A comparison that holds in ASCII can fail in
EBCDIC, so a string comparison is one of the things that cannot be settled by
running the program locally. [ADR-0006](adr/0006-single-byte-character-model.md)
records why the character model is single-byte, and
[divergences.md](divergences.md) lists what the encoding changes.

**References:**

- [z/OS 3.1: converting data to ASCII, EBCDIC and UTF-8](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-converting-data-ascii-ebcdic-utf-8)

### EIBRESP

**Definition:** The field in the CICS EXEC Interface Block holding the outcome of
the last command, when it was issued with `RESP`.

**Why it matters to BankLang:** A CICS command whose `RESP` nothing reads
succeeds silently when it failed. `BANK-CICS-004` refuses that: the response has
to be tested against a condition name such as `DFHRESP(NORMAL)`, not against a
bare number.

**References:**

- [Response codes of EXEC CICS commands](https://www.ibm.com/docs/en/cics-ts/6.x?topic=codes-response-exec-cics-commands)

### Embedded SQL

**Definition:** SQL written inline in a host language between `EXEC SQL` and
`END-EXEC`, replaced by a precompiler with calls before the COBOL compiler sees
it.

**Why it matters to BankLang:** It is how a generated program talks to Db2. The
SQL text itself is passed through rather than parsed and rebuilt, so what runs
is what was written; what BankLang adds around it is the host variables, the
`SQLCA`, and the `SQLCODE` tests `BANK-SQL-007` will not let you skip.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)
- [Db2 13 for z/OS: processing SQL statements by using the Db2 precompiler](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=preparation-processing-sql-statements-by-using-db2-precompiler)

## F

### File status

**Definition:** A two-character COBOL data item that receives the outcome of each I/O operation on a file, set through the `FILE STATUS` clause of a `SELECT` entry.

**Why it matters to BankLang:** `language-reference.md` section 13 requires file status to be checked. A BankTS `file` declaration binds a status field with its `status` clause, and BankLang reports `BANK-FILE-001` when one is missing, because without it the generated program has nowhere to observe an I/O result.

**References:**

- [IBM Enterprise COBOL 6.4: FILE STATUS clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=section-file-status-clause)

### Fixed-format COBOL

**Definition:** The COBOL source format in which columns carry meaning: 1–6 the
sequence area, 7 the indicator, 8–11 Area A, 12–72 Area B, and nothing past 72.

**Why it matters to BankLang:** It is what BankLang emits, always. Division,
section and paragraph headers, `FD` entries and level 01 and 77 items go in
Area A and everything else in Area B, and the conformance linter's
`line-length`, `sequence-area`, `indicator-area` and `area-a` rules fail the
build rather than trusting the emitter about it.

**References:**

- [IBM Enterprise COBOL 6.4: Area A or Area B](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=format-area-area-b)

### Free-format COBOL

**Definition:** The later COBOL source format that drops the column rules and
lets a statement start anywhere on the line.

**Why it matters to BankLang:** Never emitted, because the reader is the point.
A mainframe engineer reviewing the output reads fixed format, and so does every
existing program on the estate. A generated program that looked different from
its neighbours would be harder to accept.

**References:**

- [IBM Enterprise COBOL 6.4: COBOL compiler options](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=options-cobol-compiler)

## G

### GnuCOBOL

**Definition:** A free COBOL compiler that translates COBOL to C and builds a
native executable, on Linux, macOS and Windows.

**Why it matters to BankLang:** It is the only compiler this project has ever
run. Every example is compiled under a dialect configuration shaped towards
Enterprise COBOL 6.4 and again under GnuCOBOL's own default, which is what makes
the examples runnable in CI — and it is not IBM's compiler. A green `cobc` run
is evidence about GnuCOBOL. [divergences.md](divergences.md) is the list of
places the two are known to differ.

**References:**

- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)
- [GnuCOBOL guides](https://gnucobol.sourceforge.io/guides.html)

## H

### Host variable

**Definition:** A COBOL data item named inside an `EXEC SQL` statement, prefixed
with a colon, through which values pass in and out of Db2.

**Why it matters to BankLang:** The picture of a host variable has to match the
column it is bound to, and getting it wrong is a truncation nobody sees. The
declarations are generated from the record, not written by hand, so the
`PIC` clause and the column agree by construction.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

## I

### IBM Enterprise COBOL for z/OS

**Definition:** IBM's COBOL compiler for z/OS, currently at 6.4, and the compiler
a bank's programs are actually built with.

**Why it matters to BankLang:** It is the target the output is written for and
the compiler the output has never been run through.
[ADR-0002](adr/0002-primary-target-ibm-enterprise-cobol.md) records why it is
the primary target; [target-conformance.md](target-conformance.md) cites the
manual rule by rule for what the emitter does. Everything the project claims
about it is read out of that manual, not observed.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/lrmvs.pdf)

### Idempotency key

**Definition:** A caller-supplied value that uniquely identifies a request, so that repeating the request produces the same effect as performing it once.

**Why it matters to BankLang:** `language-reference.md` section 10 requires every transaction to have an idempotency key, because retries are routine in payment and messaging infrastructure and an unkeyed retry can post an amount twice. BankLang reports `BANK-TXN-001` when a transaction has no parameter named `idempotencyKey` and no record parameter declaring that field.

**References:**

- [Diagnostics](diagnostics.md)

### IMS

**Definition:** IBM Information Management System: a hierarchical database and a
transaction manager, older than Db2 and still underneath a great deal of banking.

**Why it matters to BankLang:** DL/I calls are generated. A BankTS `database`
declares its PCB, segment and key, and `getUnique`, `getNext` and
`getHoldUnique` read through it with a status field that has to be checked the
way a file status does. [ims.md](language/ims.md) is the reference.

**References:**

- [IMS 15.5: application programming](https://www.ibm.com/docs/en/ims/15.5.0?topic=ims-application-programming)

## J

### JCL / Job Control Language

**Definition:** The language that tells z/OS what to run and what to run it
against: a job, its steps, and a `DD` statement binding every file the program
opens to a real dataset.

**Why it matters to BankLang:** A COBOL program with no JCL cannot be run, so
`bankc build` writes the job as well — compile, link, and the steps a program
needs because of what is in it, such as `PRECOMP` and `BIND` for embedded SQL.
It is meant to be submittable rather than a skeleton, and
[jcl-model.md](jcl-model.md) says which parts a site is expected to change.

**References:**

- [z/OS 3.1 MVS JCL Reference (SA23-1385-60)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab600_v3r1.pdf)
- [z/OS 3.1: JOB statement](https://www.ibm.com/docs/en/zos/3.1.0?topic=reference-job-statement)

## M

### Money type

**Definition:** A decimal that also carries which currency it is in, declared as
`currency<"BDT", 18, 2>`.

**Why it matters to BankLang:** Two amounts in different currencies are the same
shape and are not the same thing. Naming the currency in the type lets
`BANK-DEC-005` refuse an expression that adds taka to dollars, which is
otherwise a bug that only shows up in a reconciliation.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## O

### OCCURS

**Definition:** The COBOL clause that repeats a data item a fixed number of
times, which is as close as COBOL gets to an array.

**Why it matters to BankLang:** A BankTS array is bounded, and the bound becomes
the `OCCURS` count. Bounded is the whole point: the table's size is part of the
record's length, and a subscript outside it is refused rather than clamped —
which is a defect this project shipped once and found by running the program.

**References:**

- [IBM Enterprise COBOL 6.4: OCCURS clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-occurs-clause)

### OCCURS DEPENDING ON

**Definition:** An `OCCURS` whose live element count is read from another field,
which is what makes a record variable-length.

**Why it matters to BankLang:** BankTS spells it `depending on`, and emits
`OCCURS 1 TO 100 TIMES DEPENDING ON LINE-COUNT OF BATCH` — the fixed bound stays
as the maximum, because the storage is still reserved. The count must be a whole
number declared before the table, since COBOL reads it to work out the record's
length and cannot read a field it has not reached; `BANK-COPY-004` is what says
so when it is not.

**References:**

- [IBM Enterprise COBOL 6.4: OCCURS DEPENDING ON clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-occurs-depending)

## P

### PIC / PICTURE clause

**Definition:** The COBOL clause describing a data item's shape — how many
digits or characters, where the decimal point sits, whether there is a sign.
With `USAGE`, it decides how many bytes the item takes.

**Why it matters to BankLang:** Every BankTS type has one picture it compiles
to, listed in [types.md](language/types.md), and the picture is what a copybook
reader sees. `PIC 9(8)` and `PIC S9(8)` differ by a byte and by whether a
negative can be held at all, so the mapping is a table rather than a judgement.

**References:**

- [IBM Enterprise COBOL 6.4: PICTURE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-picture-clause)

### Precompile

**Definition:** The Db2 step that reads `EXEC SQL` out of a program, replaces it
with calls, and writes the SQL to a DBRM for binding.

**Why it matters to BankLang:** It runs before the COBOL compiler, so a program
with embedded SQL cannot be built by the ordinary two steps. The generated job
puts `PRECOMP` ahead of the compile whatever the caller asked for, which is why
the JCL is generated from what the program contains rather than from a template.

**References:**

- [Db2 13 for z/OS: processing SQL statements by using the Db2 precompiler](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=preparation-processing-sql-statements-by-using-db2-precompiler)

## R

### REDEFINES

**Definition:** A COBOL clause laying a second set of fields over the same bytes
as the first, so one record can be read two ways.

**Why it matters to BankLang:** Real copybooks are full of it — a party record
that is a person or a company depending on a type byte — so a compiler that
cannot read `REDEFINES` cannot read the estate. BankTS has a `redefines` clause,
and the copybook importer refuses a shape it cannot lay out
(`BANK-COPY-002`) instead of importing it at the wrong offsets.
`conversions/05-redefines-and-odo` is one that survived the trip.

**References:**

- [IBM Enterprise COBOL 6.4: REDEFINES clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-redefines-clause)

## S

### Source map

**Definition:** A machine-readable record of which span of source produced which
span of generated output.

**Why it matters to BankLang:** It is what makes a review of the COBOL possible
without reading it as a whole: click a line of BankTS in the playground and the
COBOL it produced lights up. It is also what an auditor needs to ask why a
particular paragraph exists. `bankc build` writes one per module.

**References:**

- [ECMA-426: Source map format specification, 1st edition (December 2024)](https://ecma-international.org/publications-and-standards/standards/ecma-426/)

### Source map coverage

**Definition:** The proportion of source-language symbols that have a source map entry resolving to a real location in the generated artifact, together with the set of symbols that do not.

**Why it matters to BankLang:** Traceability is an audit claim, so it needs a measurement rather than an assumption. `bankc verify` reports coverage for every module, record, field, and function, and fails when an entry is missing or when an entry points at a line range that does not contain the generated COBOL name it describes. The corresponding diagnostics are `BANK-GEN-001` through `BANK-GEN-006` in `diagnostics.md`.

**References:**

- [ECMA-426: Source map format specification, 1st edition (December 2024)](https://ecma-international.org/publications-and-standards/standards/ecma-426/)

### SQLCA

**Definition:** The SQL Communication Area: the structure Db2 writes the outcome
of each statement into, `SQLCODE` among its fields.

**Why it matters to BankLang:** It is the only place a program learns whether an
SQL statement worked, so a generated program that talks to Db2 always includes
it. Nothing is inferred from a statement appearing to succeed.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)
- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

### SQLCODE

**Definition:** The integer Db2 sets after every statement: `0` for success,
`+100` for no row found, and a negative number for an error.

**Why it matters to BankLang:** Those are three outcomes, and treating them as
two is the bug. A `SELECT` that finds nothing is not a failure, and a `-911`
deadlock is not an empty result — `BANK-SQL-007` refuses a test that cannot tell
them apart. [sql.md](language/sql.md) has the shape it expects.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)
- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

### SQLSTATE

**Definition:** The five-character status the SQL standard defines, set alongside
`SQLCODE` and portable across databases in a way `SQLCODE` is not.

**Why it matters to BankLang:** BankLang tests `SQLCODE`. The distinction is not
academic: a cursor loop that ends on `SQLSTATE` instead of the `SQLCODE` the
`FETCH` sets never sees the end of the rows, which is a real defect in the
OpenCBS suite and one this compiler refuses to emit.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

### Syncpoint

**Definition:** The point at which every update since the last one is committed
together, or backed out together. What lies between two of them is a unit of
work.

**Why it matters to BankLang:** A BankTS `transaction` is a compile-time
grouping — idempotency, audit and balance — and is not a syncpoint. Commit and
rollback are not generated from it; where a syncpoint matters, as in the queue
drained in `examples/mq-request-reply`, it is written out. Do not read the
keyword as a promise the runtime is making.

**References:**

- [CICS Transaction Server 6.x: units of work](https://www.ibm.com/docs/en/cics-ts/6.x?topic=recovery-units-work)
- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

## T

### Transaction (BankTS)

**Definition:** A first-class BankTS declaration that groups the effects of one business operation: ledger postings and audit events.

**Why it matters to BankLang:** Transactions are the unit the banking safety
rules apply to. Each must carry an idempotency key, emit at least one audit
event, and balance its postings. A transaction lowers to a COBOL paragraph and
must appear in the source map, which `BANK-GEN-007` enforces. Rollback and
syncpoint behaviour are not modelled; a transaction is a compile-time grouping,
not a unit of work.

**References:**

- [Language reference](language-reference.md)
- [ADR-0003](adr/0003-ledger-and-audit-calling-convention.md)

## V

### VSAM

**Definition:** Virtual Storage Access Method: z/OS's record-oriented file
organisations, the useful one here being KSDS, a dataset keyed on a field in the
record and readable in key order.

**Why it matters to BankLang:** It is where a master file lives. A BankTS `file`
declared `indexed` becomes a KSDS with `RECORD KEY` and any alternate keys, and
`examples/vsam-browse` walks one with `START` and `READ NEXT` on an alternate
index. Every operation on it sets a file status, and `BANK-FILE-001` refuses a
declaration with nowhere to observe one.

**References:**

- [z/OS 3.1: introduction to VSAM programming](https://www.ibm.com/docs/en/zos/3.1.0?topic=instructions-introduction-vsam-programming)

## Z

### z/OS

**Definition:** IBM's operating system for IBM Z, and where the Enterprise COBOL
compiler, CICS, IMS, Db2, VSAM and JCL all live.

**Why it matters to BankLang:** It is the platform everything generated here is
meant to run on, and the platform none of it has run on. `zos/` holds a
conformance kit — programs, JCL and expected results — for somebody with access
to submit; [RESULTS-TEMPLATE.md](../zos/RESULTS-TEMPLATE.md) is what comes back.

**References:**

- [z/OS 3.1: introduction](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-introduction)
- [z/OS 3.1 MVS JCL Reference (SA23-1385-60)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab600_v3r1.pdf)

### ZUnit

**Definition:** IBM's automated unit testing framework for z/OS, bringing xUnit
to Enterprise COBOL and PL/I.

**Why it matters to BankLang:** It is generated. A BankTS `test <name> for
<entry transaction>` produces a test case, a configuration and the JCL to run
it, and `examples/zunit-tested-posting` carries all three. No generated case has
been run, because running one needs z/OS — every shape in the artifacts is
copied from a case IBM's own generator produced, and cited in
[zunit.md](zunit.md).

**References:**

- [ZUnit overview](https://www.ibm.com/docs/en/developer-for-zos/15.0.x?topic=applications-zos-automated-unit-testing-framework-zunit)

## Numerals

### 88-level condition name

**Definition:** A name declared at level 88 under a data item, true when the item
holds one of the values it lists. It occupies no storage of its own.

**Why it matters to BankLang:** It is how generated COBOL says what a value
means. Each member of a BankTS enum emits one 88-level, so the program tests
`IF ACCOUNT-DORMANT` rather than `IF STATUS = "D"` — the same comparison, with
the meaning written down where a reviewer reads it.
`tests/enum-conditions.test.ts` holds the rule.

**References:**

- [IBM Enterprise COBOL 6.4: VALUE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-value-clause)
