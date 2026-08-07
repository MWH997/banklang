# Definitions

This file is the canonical glossary for BankLang.

Every important term used in the repository must be defined here before or during the change that introduces it.

Each entry must include:

1. the term,
2. a clear definition,
3. why it matters to BankLang,
4. reference links to primary documentation or the best available authoritative source.

Do not add unexplained jargon to README, specs, tickets, architecture docs, tester notes, or generated audit reports. If a new term appears in the project, add or update its definition here.

## Definition entry template

```md
### Term

**Definition:** Clear explanation.

**Why it matters to BankLang:** Explain how this affects the compiler, generated COBOL, validation, migration tooling, or audit evidence.

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

**Definition:** A named target configuration that controls how BankLang emits COBOL and related artifacts for a specific environment.

**Why it matters to BankLang:** IBM Enterprise COBOL for z/OS and GnuCOBOL are not identical targets. Backend profiles prevent local GnuCOBOL behaviour from being mistaken for IBM z/OS validation.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### BankLang

**Definition:** The project name for the deterministic compiler/toolchain that compiles BankTS into readable, auditable COBOL-oriented artifacts.

**Why it matters to BankLang:** The project must be positioned as a compiler/toolchain, not as an AI converter.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### BankTS

**Definition:** The restricted TypeScript-like source language designed for banking-safe programs that compile to COBOL.

**Why it matters to BankLang:** BankTS deliberately avoids arbitrary JavaScript semantics. It provides a modern syntax while keeping deterministic compilation, exact decimal semantics, fixed layouts, and auditability.

**References:**

- [TypeScript official site](https://www.typescriptlang.org/)
- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

### Bind

**Definition:** In Db2 application preparation, bind is the process that creates executable database access structures such as packages or plans from precompiled SQL artifacts.

**Why it matters to BankLang:** If BankLang emits embedded SQL for Db2, the build documentation and audit artifacts must record precompile and bind requirements.

**References:**

- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 13 for z/OS: processing SQL statements by using the Db2 precompiler](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=preparation-processing-sql-statements-by-using-db2-precompiler)

## C

### CICS

**Definition:** IBM CICS is a transaction-processing environment commonly used on IBM Z systems for high-volume online applications.

**Why it matters to BankLang:** A bank-grade COBOL transpiler must understand online transaction workloads, CICS command generation, response-code handling, syncpoint/rollback behaviour, and transaction boundaries.

**References:**

- [IBM Enterprise COBOL for z/OS 6.4 Programming Guide (SC27-8714-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/pgmvs.pdf)
- [CICS Transaction Server 6.x: fundamentals](https://www.ibm.com/docs/en/cics-ts/6.x?topic=fundamentals)

### CICS channel/container

**Definition:** CICS channels and containers provide a modern mechanism for passing structured data between CICS programs, avoiding some limitations of COMMAREA-based exchange.

**Why it matters to BankLang:** Channels and containers are a roadmap target for modern CICS integration. Backend profiles should distinguish COMMAREA support from channel/container support.

**References:**

- [CICS Transaction Server 6.x: sharing data in CICS applications](https://www.ibm.com/docs/en/cics-ts/6.x?topic=applications-sharing-data-in-cics)

### CICS COMMAREA

**Definition:** A communication area used by CICS programs to pass data between program invocations or transactions.

**Why it matters to BankLang:** COMMAREA support is important for generated transaction programs and compatibility with older CICS application styles.

**References:**

- [CICS Transaction Server 6.x: passing data to other programs by using COMMAREA](https://www.ibm.com/docs/en/cics-ts/6.x?topic=programs-commarea)

### COBOL

**Definition:** COBOL is a long-established business programming language used heavily in enterprise, government, banking, and mainframe systems.

**Why it matters to BankLang:** COBOL is the target language. Generated COBOL must be readable, deterministic, maintainable, and compatible with the chosen backend profile.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

### COBOL copybook

**Definition:** A COBOL source fragment, commonly included with the `COPY` statement, used to share record layouts, constants, or declarations across programs.

**Why it matters to BankLang:** Copybook import/export is non-negotiable for bank adoption because existing COBOL estates rely on shared record layouts and field definitions.

**References:**

- [IBM Enterprise COBOL 6.4: COPY statement](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=statements-copy-statement)

### COBOL division

**Definition:** A major structural part of a COBOL program, such as `IDENTIFICATION DIVISION`, `ENVIRONMENT DIVISION`, `DATA DIVISION`, and `PROCEDURE DIVISION`.

**Why it matters to BankLang:** Generated COBOL must follow recognisable COBOL structure so it can be reviewed and maintained by COBOL engineers.

**References:**

- [IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/lrmvs.pdf)
- [GnuCOBOL documentation](https://gnucobol.sourceforge.io/guides.html)

### COMP

**Definition:** In COBOL, `COMP` generally refers to computational binary storage, depending on dialect and usage.

**Why it matters to BankLang:** Numeric storage choices affect byte layout, performance, compatibility, and arithmetic behaviour. Backend profiles must define mappings precisely.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### COMP-3 / Packed decimal

**Definition:** `COMP-3` is IBM COBOL packed-decimal storage, where decimal digits are packed into bytes with sign information.

**Why it matters to BankLang:** Packed decimal is central to banking-style fixed-point arithmetic and copybook layouts. BankLang must model precision, scale, sign, and byte layout exactly.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### Copybook layout

**Definition:** The byte-level arrangement of fields defined by a COBOL copybook, including order, length, numeric representation, signedness, repetition, and overlapping definitions.

**Why it matters to BankLang:** Banking systems exchange fixed-layout records. A compiler that changes field offsets or numeric storage can break production integrations.

**References:**

- [IBM Enterprise COBOL 6.4: USAGE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-usage-clause)
- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## D

### Db2 for z/OS

**Definition:** IBM Db2 for z/OS is IBM's relational database system for z/OS environments.

**Why it matters to BankLang:** Bank-grade COBOL programs commonly access Db2 through embedded SQL, host variables, SQLCA handling, precompile, and bind processes.

**References:**

- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

### DD name

**Definition:** The data definition name that links a program's internal file reference to a dataset through JCL. On z/OS it is at most eight characters.

**Why it matters to BankLang:** A BankTS `file` declaration emits `SELECT ... ASSIGN TO <ddname>`, so BankLang folds the declared file name to a deterministic eight-character uppercase alphanumeric form. `accountInput` becomes `ACCOUNTI`.

**References:**

- [z/OS 3.1: DD statement](https://www.ibm.com/docs/en/zos/3.1.0?topic=reference-dd-statement)

### Decimal type

**Definition:** A fixed-precision, fixed-scale numeric type used for exact arithmetic.

**Why it matters to BankLang:** Money and ledger values must not use binary floating point. BankTS decimal types must compile to carefully defined COBOL numeric representations.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

### Double-entry bookkeeping

**Definition:** An accounting method in which every financial event is recorded as equal and opposite debit and credit entries, so total debits always equal total credits.

**Why it matters to BankLang:** `language-reference.md` section 10 requires debit and credit totals to balance for ledger-posting operations. BankLang checks this as `BANK-LED-001`. Because the compiler does not evaluate expressions, balance is proven structurally by comparing the multiset of debited and credited amount expressions. The check is conservative: it reports what it cannot prove rather than accepting it.

**References:**

- [Diagnostics](diagnostics.md)

## E

### EBCDIC

**Definition:** Extended Binary Coded Decimal Interchange Code, a character encoding historically and currently used on IBM mainframe systems.

**Why it matters to BankLang:** Character encoding affects file layouts, copybook fixtures, string comparison, and byte-level compatibility in z/OS contexts.

**References:**

- [z/OS 3.1: converting data to ASCII, EBCDIC and UTF-8](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-converting-data-ascii-ebcdic-utf-8)

### EIBRESP

**Definition:** `EIBRESP` is a CICS EXEC Interface Block field used after EXEC CICS commands to indicate the response condition.

**Why it matters to BankLang:** BankLang CICS generation must require response-code handling and should not emit CICS calls with ignored responses.

**References:**

- [Response codes of EXEC CICS commands](https://www.ibm.com/docs/en/cics-ts/6.x?topic=codes-response-exec-cics-commands)

### Embedded SQL

**Definition:** SQL statements written inside a host-language program, processed by a precompiler before normal compilation.

**Why it matters to BankLang:** Generated COBOL that accesses Db2 must model `EXEC SQL`, host variables, SQLCA, SQLCODE handling, and precompile/bind workflows.

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

**Definition:** A COBOL source format where specific columns have special meaning, historically used in many COBOL environments.

**Why it matters to BankLang:** Some target environments or style guides may require fixed-format output. The COBOL backend must be explicit about fixed versus free format.

**References:**

- [IBM Enterprise COBOL 6.4: Area A or Area B](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=format-area-area-b)

### Free-format COBOL

**Definition:** A COBOL source format with fewer column restrictions than traditional fixed format.

**Why it matters to BankLang:** Free-format output may be more readable in modern tooling, but backend profiles must define what is supported and accepted by the target compiler.

**References:**

- [IBM Enterprise COBOL 6.4: COBOL compiler options](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=options-cobol-compiler)

## G

### GnuCOBOL

**Definition:** A free/libre COBOL compiler that produces native executables from COBOL source and is available across several operating systems.

**Why it matters to BankLang:** GnuCOBOL is the practical local validation target when IBM Enterprise COBOL is unavailable. It must not be treated as full proof of IBM z/OS compatibility.

**References:**

- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)
- [GnuCOBOL guides](https://gnucobol.sourceforge.io/guides.html)

## H

### Host variable

**Definition:** A variable in a host language, such as COBOL, that is referenced by embedded SQL statements.

**Why it matters to BankLang:** Db2 code generation must correctly map BankTS values to COBOL host variables with compatible layouts.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

## I

### IBM Enterprise COBOL for z/OS

**Definition:** IBM's enterprise-class COBOL compiler for z/OS.

**Why it matters to BankLang:** This is the primary production target. Generated COBOL should be designed and validated against this compiler when access is available.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713-03)](https://www.ibm.com/docs/en/SS6SG3_6.4.0/pdf/lrmvs.pdf)

### Idempotency key

**Definition:** A caller-supplied value that uniquely identifies a request, so that repeating the request produces the same effect as performing it once.

**Why it matters to BankLang:** `language-reference.md` section 10 requires every transaction to have an idempotency key, because retries are routine in payment and messaging infrastructure and an unkeyed retry can post an amount twice. BankLang reports `BANK-TXN-001` when a transaction has no parameter named `idempotencyKey` and no record parameter declaring that field.

**References:**

- [Diagnostics](diagnostics.md)

### IMS

**Definition:** IBM Information Management System, a mainframe transaction and hierarchical database management system.

**Why it matters to BankLang:** IMS is part of the broader IBM mainframe application ecosystem. Initial support may be roadmap-only, but the architecture must not block future IMS integration.

**References:**

- [IMS 15.5: application programming](https://www.ibm.com/docs/en/ims/15.5.0?topic=ims-application-programming)

## J

### JCL / Job Control Language

**Definition:** Job Control Language is used on IBM mainframe systems to define and control batch jobs and their required resources.

**Why it matters to BankLang:** Batch COBOL output often requires JCL examples or generated job metadata for compilation, linking, file allocation, and execution.

**References:**

- [z/OS 3.1 MVS JCL Reference (SA23-1385-60)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab600_v3r1.pdf)
- [z/OS 3.1: JOB statement](https://www.ibm.com/docs/en/zos/3.1.0?topic=reference-job-statement)

## M

### Money type

**Definition:** A nominal type representing monetary values with currency, precision, scale, and rounding rules.

**Why it matters to BankLang:** Money values must be safer than plain decimals because currency mixing, rounding, and scale handling are common sources of financial bugs.

**References:**

- [IBM Enterprise COBOL 6.4: computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## O

### OCCURS

**Definition:** A COBOL clause used to define repeated data items, similar to fixed-size arrays.

**Why it matters to BankLang:** BankTS bounded arrays must map carefully to COBOL `OCCURS`, and layout reports must calculate repeated field offsets correctly.

**References:**

- [IBM Enterprise COBOL 6.4: OCCURS clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-occurs-clause)

### OCCURS DEPENDING ON

**Definition:** A COBOL construct for variable-occurrence tables whose effective number of elements depends on another data item.

**Why it matters to BankLang:** This affects dynamic record lengths and must be modelled explicitly. It is more complex than fixed `OCCURS` and requires careful backend support.

**References:**

- [IBM Enterprise COBOL 6.4: OCCURS DEPENDING ON clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-occurs-depending)

## P

### PIC / PICTURE clause

**Definition:** A COBOL clause that describes the format and size of a data item, including numeric and alphanumeric fields.

**Why it matters to BankLang:** BankTS types must map to precise COBOL `PIC` clauses. Wrong mappings can break data layout and arithmetic.

**References:**

- [IBM Enterprise COBOL 6.4: PICTURE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-picture-clause)

### Precompile

**Definition:** The process that scans source code containing embedded SQL and transforms it before normal compilation.

**Why it matters to BankLang:** Db2 embedded SQL requires build pipeline awareness. BankLang audit reports and generated build guidance must account for precompile steps.

**References:**

- [Db2 13 for z/OS: processing SQL statements by using the Db2 precompiler](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=preparation-processing-sql-statements-by-using-db2-precompiler)

## R

### REDEFINES

**Definition:** A COBOL clause that allows a data item to share storage with another data item, enabling different interpretations of the same bytes.

**Why it matters to BankLang:** `REDEFINES` is common in legacy layouts but dangerous for type-safe modelling. BankLang must parse, report, and support it carefully.

**References:**

- [IBM Enterprise COBOL 6.4: REDEFINES clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-redefines-clause)

## S

### Source map

**Definition:** A mapping between source-language locations and generated artifact locations.

**Why it matters to BankLang:** BankTS source must be traceable to generated COBOL paragraphs, copybooks, SQL/CICS sections, and audit output.

**References:**

- [ECMA-426: Source map format specification, 1st edition (December 2024)](https://ecma-international.org/publications-and-standards/standards/ecma-426/)

### Source map coverage

**Definition:** The proportion of source-language symbols that have a source map entry resolving to a real location in the generated artifact, together with the set of symbols that do not.

**Why it matters to BankLang:** Traceability is an audit claim, so it needs a measurement rather than an assumption. `bankc verify` reports coverage for every module, record, field, and function, and fails when an entry is missing or when an entry points at a line range that does not contain the generated COBOL name it describes. The corresponding diagnostics are `BANK-GEN-001` through `BANK-GEN-006` in `diagnostics.md`.

**References:**

- [ECMA-426: Source map format specification, 1st edition (December 2024)](https://ecma-international.org/publications-and-standards/standards/ecma-426/)

### SQLCA

**Definition:** SQL Communication Area; a data structure used by embedded SQL programs to receive status and diagnostic information from SQL operations.

**Why it matters to BankLang:** Generated COBOL with Db2 embedded SQL must handle SQLCA/SQLCODE correctly and report unhandled paths.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)
- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

### SQLCODE

**Definition:** A status code produced by SQL execution that indicates success, warning, not-found, or error conditions.

**Why it matters to BankLang:** BankLang must reject Db2 operations where SQLCODE paths are not handled.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)
- [Db2 13 for z/OS: glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

### SQLSTATE

**Definition:** SQLSTATE is a standard SQL status code value that can be used alongside or instead of SQLCODE for SQL diagnostics.

**Why it matters to BankLang:** Db2 integration should model SQL success/error infrastructure, including SQLCA or SQLCODE/SQLSTATE host variables.

**References:**

- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

### Syncpoint

**Definition:** In transaction processing, a syncpoint is a point where updates are committed or backed out as a consistent unit of work.

**Why it matters to BankLang:** CICS and Db2 transaction behaviour must be explicit. BankLang transaction blocks must map to safe commit/rollback behaviour.

**References:**

- [CICS Transaction Server 6.x: units of work](https://www.ibm.com/docs/en/cics-ts/6.x?topic=recovery-units-work)
- [Db2 13 for z/OS: embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=zos-embedded-sql-programming)

## T

### Transaction (BankTS)

**Definition:** A first-class BankTS declaration that groups the effects of one business operation: ledger postings and audit events.

**Why it matters to BankLang:** Transactions are the unit the banking safety rules apply to. Each must carry an [[idempotency-key]], emit at least one [[audit-event]], and balance its postings. A transaction lowers to a COBOL paragraph and must appear in the source map, which `BANK-GEN-007` enforces. Rollback and syncpoint behaviour are not modelled yet; those belong to the CICS profile on the roadmap.

**References:**

- [Language reference](language-reference.md)
- [ADR-0003](adr/0003-ledger-and-audit-calling-convention.md)

## V

### VSAM

**Definition:** Virtual Storage Access Method, an IBM mainframe data access method commonly used for record-oriented datasets.

**Why it matters to BankLang:** Many COBOL systems use VSAM files. BankLang must model file declarations, key access, file status handling, and record layouts.

**References:**

- [z/OS 3.1: introduction to VSAM programming](https://www.ibm.com/docs/en/zos/3.1.0?topic=instructions-introduction-vsam-programming)

## Z

### z/OS

**Definition:** IBM's mainframe operating system for IBM Z systems.

**Why it matters to BankLang:** IBM Enterprise COBOL, CICS, IMS, Db2 for z/OS, VSAM, and JCL all sit in the z/OS ecosystem that BankLang primarily targets.

**References:**

- [z/OS 3.1: introduction](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-introduction)
- [z/OS 3.1 MVS JCL Reference (SA23-1385-60)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab600_v3r1.pdf)

### ZUnit

**Definition:** ZUnit is IBM's z/OS automated unit testing framework, adapting xUnit concepts for Enterprise COBOL and PL/I testing.

**Why it matters to BankLang:** BankLang should eventually generate or align with unit-test artifacts suitable for IBM Z testing workflows.

**References:**

- [ZUnit overview](https://www.ibm.com/docs/en/developer-for-zos/15.0.x?topic=applications-zos-automated-unit-testing-framework-zunit)

## Numerals

### 88-level condition name

**Definition:** A COBOL condition name declared with level number 88 to associate meaningful names with specific values of a data item.

**Why it matters to BankLang:** 88-level names are useful for generated readable COBOL and copybook compatibility, especially for status fields and boolean-like values.

**References:**

- [IBM Enterprise COBOL 6.4: VALUE clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-value-clause)
