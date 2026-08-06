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

# A

## ADR / Architecture Decision Record

**Definition:** An Architecture Decision Record is a written record of an important technical or architectural decision, including the context, decision, and consequences.

**Why it matters to BankLang:** BankLang decisions around BankTS semantics, COBOL generation, decimal arithmetic, copybook layout, and backend validation must not be hidden in commit diffs. ADRs make high-impact decisions reviewable and auditable.

**References:**

- [Documenting architecture decisions — Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

## Audit artifact

**Definition:** A file or report generated during build or verification that records evidence about compiler behaviour, generated output, diagnostics, mappings, validation, or risks.

**Why it matters to BankLang:** Banking adoption requires evidence. Audit artifacts show how BankTS source maps to COBOL, which diagnostics were raised, what decimal checks were performed, which copybooks were used, and what validation was run.

**References:**

- [SPDX SBOM definition](https://spdx.github.io/spdx-spec/v3.0.1/model/Software/Classes/Sbom/)
- [OpenSSF Scorecard](https://scorecard.dev/)

## Audit event

**Definition:** A durable, named record that a business-significant action occurred, carrying a correlation value that ties it to the originating request.

**Why it matters to BankLang:** `language-reference.md` section 11 requires every transaction to emit at least one audit event with a compile-time constant name. BankLang enforces this with `BANK-AUD-001` and `BANK-AUD-003`, and lowers the event to a call against the audit interface described in [ADR-0003](adr/0003-ledger-and-audit-calling-convention.md). A statically known event name keeps audit trails greppable and stable across releases.

**References:**

- [Diagnostics](diagnostics.md)
- [Language reference](language-reference.md)

## AST / Abstract Syntax Tree

**Definition:** A tree representation of parsed source code where each node represents a language construct such as a module, type alias, record, function, expression, or statement.

**Why it matters to BankLang:** The AST is the first structured representation of BankTS source. It must preserve source spans so diagnostics and source maps can point back to the original code.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

---

# B

## Backend profile

**Definition:** A named target configuration that controls how BankLang emits COBOL and related artifacts for a specific environment.

**Why it matters to BankLang:** IBM Enterprise COBOL for z/OS and GnuCOBOL are not identical targets. Backend profiles prevent local GnuCOBOL behaviour from being mistaken for IBM z/OS validation.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

## BankLang

**Definition:** The project name for the deterministic compiler/toolchain that compiles BankTS into readable, auditable COBOL-oriented artifacts.

**Why it matters to BankLang:** The project must be positioned as a compiler/toolchain, not as an AI converter.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

## BankTS

**Definition:** The restricted TypeScript-like source language designed for banking-safe programs that compile to COBOL.

**Why it matters to BankLang:** BankTS deliberately avoids arbitrary JavaScript semantics. It provides a modern syntax while keeping deterministic compilation, exact decimal semantics, fixed layouts, and auditability.

**References:**

- [TypeScript official site](https://www.typescriptlang.org/)
- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## Batch job

**Definition:** A non-interactive workload that processes data in scheduled or controlled runs, often reading input files, producing output files, and returning status codes.

**Why it matters to BankLang:** Many banking COBOL workloads are batch-style jobs such as interest accrual, settlement, reconciliation, statement generation, and file processing.

**References:**

- [IBM z/OS basic skills: JCL](https://www.ibm.com/docs/en/zos-basic-skills)

## Bind

**Definition:** In Db2 application preparation, bind is the process that creates executable database access structures such as packages or plans from precompiled SQL artifacts.

**Why it matters to BankLang:** If BankLang emits embedded SQL for Db2, the build documentation and audit artifacts must record precompile and bind requirements.

**References:**

- [Db2 for z/OS glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 PRECOMPILE command](https://www.ibm.com/docs/en/db2/11.1.0?topic=commands-precompile)

---

# C

## Changelog

**Definition:** A maintained record of meaningful changes grouped by release or unreleased status.

**Why it matters to BankLang:** Every meaningful compiler, documentation, testing, security, or generated-output change must be traceable. Changelog entries prevent undocumented behaviour drift.

**References:**

- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## CICS

**Definition:** IBM CICS is a transaction-processing environment commonly used on IBM Z systems for high-volume online applications.

**Why it matters to BankLang:** A bank-grade COBOL transpiler must understand online transaction workloads, CICS command generation, response-code handling, syncpoint/rollback behaviour, and transaction boundaries.

**References:**

- [IBM z/OS basic skills: Introduction to CICS](https://www.ibm.com/docs/en/zos-basic-skills?topic=zos-introduction-cics)
- [IBM CICS Transaction Server documentation](https://www.ibm.com/docs/en/cics-ts)

## CICS COMMAREA

**Definition:** A communication area used by CICS programs to pass data between program invocations or transactions.

**Why it matters to BankLang:** COMMAREA support is important for generated transaction programs and compatibility with older CICS application styles.

**References:**

- [IBM CICS Transaction Server documentation](https://www.ibm.com/docs/en/cics-ts)

## CICS channel/container

**Definition:** CICS channels and containers provide a modern mechanism for passing structured data between CICS programs, avoiding some limitations of COMMAREA-based exchange.

**Why it matters to BankLang:** Channels and containers are a roadmap target for modern CICS integration. Backend profiles should distinguish COMMAREA support from channel/container support.

**References:**

- [IBM CICS Transaction Server documentation](https://www.ibm.com/docs/en/cics-ts)

## CLI / Command-Line Interface

**Definition:** A terminal-based interface for invoking project commands.

**Why it matters to BankLang:** The `bankc` CLI is the user-facing entry point for checking, building, emitting COBOL, inspecting copybooks, generating audit reports, and running verification.

**References:**

- [GitHub CLI manual](https://cli.github.com/manual/)

## COBOL

**Definition:** COBOL is a long-established business programming language used heavily in enterprise, government, banking, and mainframe systems.

**Why it matters to BankLang:** COBOL is the target language. Generated COBOL must be readable, deterministic, maintainable, and compatible with the chosen backend profile.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)

## COBOL backend

**Definition:** The compiler component that converts BankLang IR or COBOL-oriented IR into COBOL source and related artifacts.

**Why it matters to BankLang:** The backend controls generated divisions, data declarations, paragraphs, copybooks, SQL/CICS blocks, source maps, and formatting.

**References:**

- [IBM Enterprise COBOL for z/OS documentation](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL documentation](https://gnucobol.sourceforge.io/guides.html)

## COBOL copybook

**Definition:** A COBOL source fragment, commonly included with the `COPY` statement, used to share record layouts, constants, or declarations across programs.

**Why it matters to BankLang:** Copybook import/export is non-negotiable for bank adoption because existing COBOL estates rely on shared record layouts and field definitions.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## COBOL division

**Definition:** A major structural part of a COBOL program, such as `IDENTIFICATION DIVISION`, `ENVIRONMENT DIVISION`, `DATA DIVISION`, and `PROCEDURE DIVISION`.

**Why it matters to BankLang:** Generated COBOL must follow recognisable COBOL structure so it can be reviewed and maintained by COBOL engineers.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL documentation](https://gnucobol.sourceforge.io/guides.html)

## Code generation

**Definition:** The process of producing target-language artifacts from compiler representations such as AST, IR, or backend-specific IR.

**Why it matters to BankLang:** BankLang code generation must be deterministic, readable, source-mapped, and validated by golden tests.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## COMP

**Definition:** In COBOL, `COMP` generally refers to computational binary storage, depending on dialect and usage.

**Why it matters to BankLang:** Numeric storage choices affect byte layout, performance, compatibility, and arithmetic behaviour. Backend profiles must define mappings precisely.

**References:**

- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## COMP-3 / Packed decimal

**Definition:** `COMP-3` is IBM COBOL packed-decimal storage, where decimal digits are packed into bytes with sign information.

**Why it matters to BankLang:** Packed decimal is central to banking-style fixed-point arithmetic and copybook layouts. BankLang must model precision, scale, sign, and byte layout exactly.

**References:**

- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## Compiler

**Definition:** A tool that translates source code from one language or representation into another while enforcing syntax, type, and semantic rules.

**Why it matters to BankLang:** BankLang must be a compiler, not an AI text converter. Correctness must come from deterministic parsing, checking, lowering, generation, and validation.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## Copybook layout

**Definition:** The byte-level arrangement of fields defined by a COBOL copybook, including order, length, numeric representation, signedness, repetition, and overlapping definitions.

**Why it matters to BankLang:** Banking systems exchange fixed-layout records. A compiler that changes field offsets or numeric storage can break production integrations.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)
- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

---

# D

## Db2 for z/OS

**Definition:** IBM Db2 for z/OS is IBM's relational database system for z/OS environments.

**Why it matters to BankLang:** Bank-grade COBOL programs commonly access Db2 through embedded SQL, host variables, SQLCA handling, precompile, and bind processes.

**References:**

- [Db2 for z/OS glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)
- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)

## Decimal type

**Definition:** A fixed-precision, fixed-scale numeric type used for exact arithmetic.

**Why it matters to BankLang:** Money and ledger values must not use binary floating point. BankTS decimal types must compile to carefully defined COBOL numeric representations.

**References:**

- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

## Deterministic compiler

**Definition:** A compiler that produces identical outputs for the same source, configuration, and compiler version.

**Why it matters to BankLang:** Deterministic output is required for auditability, reproducible builds, stable golden tests, and reviewable generated COBOL diffs.

**References:**

- [Reproducible Builds project](https://reproducible-builds.org/)

## Differential testing

**Definition:** A testing method that compares the behaviour of two implementations or execution paths using the same inputs.

**Why it matters to BankLang:** BankLang can compare a BankTS reference evaluator against generated COBOL behaviour for supported subsets.

**References:**

- [Fuzzing book: differential testing](https://www.fuzzingbook.org/html/Reducer.html)

---

## DD name

**Definition:** The data definition name that links a program's internal file reference to a dataset through JCL. On z/OS it is at most eight characters.

**Why it matters to BankLang:** A BankTS `file` declaration emits `SELECT ... ASSIGN TO <ddname>`, so BankLang folds the declared file name to a deterministic eight-character uppercase alphanumeric form. `accountInput` becomes `ACCOUNTI`.

**References:**

- [IBM z/OS DD statement](https://www.ibm.com/docs/en/zos/3.1.0?topic=statements-dd-statement)

## Double-entry bookkeeping

**Definition:** An accounting method in which every financial event is recorded as equal and opposite debit and credit entries, so total debits always equal total credits.

**Why it matters to BankLang:** `language-reference.md` section 10 requires debit and credit totals to balance for ledger-posting operations. BankLang checks this as `BANK-LED-001`. Because the compiler does not evaluate expressions, balance is proven structurally by comparing the multiset of debited and credited amount expressions. The check is conservative: it reports what it cannot prove rather than accepting it.

**References:**

- [Diagnostics](diagnostics.md)

---

# E

## EBCDIC

**Definition:** Extended Binary Coded Decimal Interchange Code, a character encoding historically and currently used on IBM mainframe systems.

**Why it matters to BankLang:** Character encoding affects file layouts, copybook fixtures, string comparison, and byte-level compatibility in z/OS contexts.

**References:**

- [IBM z/OS Unicode Services User's Guide and Reference](https://www.ibm.com/docs/en/zos)

## Embedded SQL

**Definition:** SQL statements written inside a host-language program, processed by a precompiler before normal compilation.

**Why it matters to BankLang:** Generated COBOL that accesses Db2 must model `EXEC SQL`, host variables, SQLCA, SQLCODE handling, and precompile/bind workflows.

**References:**

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)
- [Db2 PRECOMPILE command](https://www.ibm.com/docs/en/db2/11.1.0?topic=commands-precompile)

---

# F

## Feature scrutiny

**Definition:** A required pre-implementation review that explains a feature's problem, non-goals, language impact, IR impact, COBOL impact, layout impact, security impact, tests, and documentation updates.

**Why it matters to BankLang:** A bank-grade compiler should not accumulate features casually. Feature scrutiny prevents unsafe, vague, or credibility-damaging additions.

**References:**

- [Architecture Decision Records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

## Fixed-format COBOL

**Definition:** A COBOL source format where specific columns have special meaning, historically used in many COBOL environments.

**Why it matters to BankLang:** Some target environments or style guides may require fixed-format output. The COBOL backend must be explicit about fixed versus free format.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## Free-format COBOL

**Definition:** A COBOL source format with fewer column restrictions than traditional fixed format.

**Why it matters to BankLang:** Free-format output may be more readable in modern tooling, but backend profiles must define what is supported and accepted by the target compiler.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## Fuzz testing

**Definition:** A testing method that feeds generated or mutated inputs into a program to find crashes, hangs, or unexpected behaviour.

**Why it matters to BankLang:** The BankTS parser, copybook parser, SQL declaration parser, and emitters should be fuzzed because malformed source should produce diagnostics, not crashes.

**References:**

- [OSS-Fuzz documentation](https://google.github.io/oss-fuzz/)

---

## File status

**Definition:** A two-character COBOL data item that receives the outcome of each I/O operation on a file, set through the `FILE STATUS` clause of a `SELECT` entry.

**Why it matters to BankLang:** `language-reference.md` section 13 requires file status to be checked. A BankTS `file` declaration binds a status field with its `status` clause, and BankLang reports `BANK-FILE-001` when one is missing, because without it the generated program has nowhere to observe an I/O result.

**References:**

- [IBM Enterprise COBOL FILE STATUS clause](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=entry-file-status-clause)

---

# G

## gh / GitHub CLI

**Definition:** GitHub's official command-line tool for working with repositories, pull requests, issues, workflows, and related GitHub resources.

**Why it matters to BankLang:** The initial repository should be created as private using `gh`, and future workflows can use `gh` for repository and PR operations.

**References:**

- [GitHub CLI manual](https://cli.github.com/manual/)
- [gh repo create manual](https://cli.github.com/manual/gh_repo_create)

## GitHub Actions

**Definition:** GitHub's workflow automation system for CI/CD and repository automation.

**Why it matters to BankLang:** CI should run linting, typechecking, tests, determinism checks, security checks, and later SBOM generation.

**References:**

- [GitHub Actions documentation](https://docs.github.com/en/actions)

## GnuCOBOL

**Definition:** A free/libre COBOL compiler that produces native executables from COBOL source and is available across several operating systems.

**Why it matters to BankLang:** GnuCOBOL is the practical local validation target when IBM Enterprise COBOL is unavailable. It must not be treated as full proof of IBM z/OS compatibility.

**References:**

- [GnuCOBOL official site](https://gnucobol.sourceforge.io/)
- [GnuCOBOL guides](https://gnucobol.sourceforge.io/guides.html)

## Golden test

**Definition:** A test that compares current generated output against a committed expected output file.

**Why it matters to BankLang:** COBOL generation must be stable and reviewable. Golden tests catch accidental formatting, naming, source-map, and code-generation drift.

**References:**

- [Jest snapshot testing concept](https://jestjs.io/docs/snapshot-testing)

---

# H

## Host variable

**Definition:** A variable in a host language, such as COBOL, that is referenced by embedded SQL statements.

**Why it matters to BankLang:** Db2 code generation must correctly map BankTS values to COBOL host variables with compatible layouts.

**References:**

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)

---

# I

## IBM Enterprise COBOL for z/OS

**Definition:** IBM's enterprise-class COBOL compiler for z/OS.

**Why it matters to BankLang:** This is the primary production target. Generated COBOL should be designed and validated against this compiler when access is available.

**References:**

- [IBM Enterprise COBOL for z/OS product page](https://www.ibm.com/products/cobol-compiler-zos)
- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## IMS

**Definition:** IBM Information Management System, a mainframe transaction and hierarchical database management system.

**Why it matters to BankLang:** IMS is part of the broader IBM mainframe application ecosystem. Initial support may be roadmap-only, but the architecture must not block future IMS integration.

**References:**

- [IBM IMS documentation](https://www.ibm.com/docs/en/ims)

## IR / Intermediate Representation

**Definition:** A structured compiler representation between source-language AST and target-language output.

**Why it matters to BankLang:** IR is the compiler moat. It captures program meaning, type metadata, decimal semantics, source anchors, data layout, transaction boundaries, SQL/CICS operations, and audit metadata before COBOL generation.

**References:**

- [LLVM documentation: Intermediate Representation concept](https://llvm.org/docs/LangRef.html)

---

## Idempotency key

**Definition:** A caller-supplied value that uniquely identifies a request, so that repeating the request produces the same effect as performing it once.

**Why it matters to BankLang:** `language-reference.md` section 10 requires every transaction to have an idempotency key, because retries are routine in payment and messaging infrastructure and an unkeyed retry can post an amount twice. BankLang reports `BANK-TXN-001` when a transaction has no parameter named `idempotencyKey` and no record parameter declaring that field.

**References:**

- [Diagnostics](diagnostics.md)

---

# J

## JCL / Job Control Language

**Definition:** Job Control Language is used on IBM mainframe systems to define and control batch jobs and their required resources.

**Why it matters to BankLang:** Batch COBOL output often requires JCL examples or generated job metadata for compilation, linking, file allocation, and execution.

**References:**

- [IBM z/OS basic skills](https://www.ibm.com/docs/en/zos-basic-skills)

---

# L

## Lexer

**Definition:** A compiler component that turns source text into tokens such as identifiers, keywords, symbols, and literals.

**Why it matters to BankLang:** A deterministic lexer is required before parsing BankTS. Lexer diagnostics must preserve source spans.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## Let declaration

**Definition:** A local variable declaration introduced with `let` that binds a named value within a function or block.

**Why it matters to BankLang:** BankTS uses explicit local variables to express intermediate banking calculations without opening the door to arbitrary runtime mutation.

**References:**

- [TypeScript handbook: variable declarations](https://www.typescriptlang.org/docs/handbook/variable-declarations.html)

## LSP / Language Server Protocol

**Definition:** A protocol that lets editors and IDEs provide language features such as diagnostics, go-to-definition, hover text, and completion through a language server.

**Why it matters to BankLang:** An LSP can make BankTS usable in real development by showing compiler diagnostics, copybook layout information, and source-to-COBOL navigation.

**References:**

- [Language Server Protocol specification](https://microsoft.github.io/language-server-protocol/)

---

# M

## Money type

**Definition:** A nominal type representing monetary values with currency, precision, scale, and rounding rules.

**Why it matters to BankLang:** Money values must be safer than plain decimals because currency mixing, rounding, and scale handling are common sources of financial bugs.

**References:**

- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)

---

# N

## Node.js 24

**Definition:** Node.js is a JavaScript runtime built on the V8 engine. Version 24 is the major release line BankLang targets.

**Why it matters to BankLang:** Node.js 24 or newer is the required runtime for BankLang development, CI, and Docker-based verification lanes. Pinning a single major line keeps compiler runs, generated artifacts, and checked-in evidence reproducible across contributors and containers. The requirement is enforced by the `engines` field in `package.json` and by the CI workflow, and `@types/node` tracks the same major line.

**References:**

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [Node.js documentation](https://nodejs.org/docs/latest-v24.x/api/)

---

# O

## OCCURS

**Definition:** A COBOL clause used to define repeated data items, similar to fixed-size arrays.

**Why it matters to BankLang:** BankTS bounded arrays must map carefully to COBOL `OCCURS`, and layout reports must calculate repeated field offsets correctly.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## OCCURS DEPENDING ON

**Definition:** A COBOL construct for variable-occurrence tables whose effective number of elements depends on another data item.

**Why it matters to BankLang:** This affects dynamic record lengths and must be modelled explicitly. It is more complex than fixed `OCCURS` and requires careful backend support.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## OpenSSF Scorecard

**Definition:** An automated tool that assesses open-source projects for security risks using a set of checks and scores.

**Why it matters to BankLang:** A bank-facing open-source repo should visibly improve its supply-chain/security posture and use tools such as Scorecard where practical.

**References:**

- [OpenSSF Scorecard](https://scorecard.dev/)
- [OpenSSF Scorecard GitHub repository](https://github.com/ossf/scorecard)

---

# P

## Parser

**Definition:** A compiler component that turns tokens into an AST according to the source-language grammar.

**Why it matters to BankLang:** The parser must accept the supported BankTS subset and reject unsupported syntax with clear diagnostics.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## pnpm

**Definition:** A fast, disk-efficient JavaScript package manager that uses a content-addressable store and workspace-aware dependency management.

**Why it matters to BankLang:** BankLang uses pnpm for deterministic dependency installation and repeatable repository commands such as `pnpm install`, `pnpm test`, and `pnpm typecheck`.

**References:**

- [pnpm official site](https://pnpm.io/)
- [pnpm workspaces documentation](https://pnpm.io/workspaces)

## PIC / PICTURE clause

**Definition:** A COBOL clause that describes the format and size of a data item, including numeric and alphanumeric fields.

**Why it matters to BankLang:** BankTS types must map to precise COBOL `PIC` clauses. Wrong mappings can break data layout and arithmetic.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## Precompile

**Definition:** The process that scans source code containing embedded SQL and transforms it before normal compilation.

**Why it matters to BankLang:** Db2 embedded SQL requires build pipeline awareness. BankLang audit reports and generated build guidance must account for precompile steps.

**References:**

- [Db2 PRECOMPILE command](https://www.ibm.com/docs/en/db2/11.1.0?topic=commands-precompile)

## Property-based testing

**Definition:** A testing style where many generated inputs are checked against stated properties or invariants.

**Why it matters to BankLang:** Decimal arithmetic, rounding, overflow, copybook layout, identifier conversion, and source-map determinism need broader coverage than a few example tests.

**References:**

- [fast-check documentation](https://fast-check.dev/)

---

# R

## REDEFINES

**Definition:** A COBOL clause that allows a data item to share storage with another data item, enabling different interpretations of the same bytes.

**Why it matters to BankLang:** `REDEFINES` is common in legacy layouts but dangerous for type-safe modelling. BankLang must parse, report, and support it carefully.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

## Reference link

**Definition:** A link to primary documentation or a trustworthy authoritative source supporting a definition or technical claim.

**Why it matters to BankLang:** every entry on this page carries reference links, so a contributor can check the terminology against IBM, GnuCOBOL, TypeScript, SPDX or OpenSSF rather than against this page's own wording.

**References:**

- [IBM Documentation](https://www.ibm.com/docs)
- [GnuCOBOL documentation](https://gnucobol.sourceforge.io/guides.html)

## Reproducible build

**Definition:** A build process that can produce identical artifacts from the same source, dependencies, environment constraints, and configuration.

**Why it matters to BankLang:** Deterministic generated COBOL and audit artifacts require reproducibility discipline.

**References:**

- [Reproducible Builds project](https://reproducible-builds.org/)

---

# S

## SBOM / Software Bill of Materials

**Definition:** A Software Bill of Materials is a structured inventory of software components, metadata, provenance, licenses, and related risk information.

**Why it matters to BankLang:** A bank-facing open-source compiler should publish SBOMs to support supply-chain review.

**References:**

- [SPDX SBOM definition](https://spdx.github.io/spdx-spec/v3.0.1/model/Software/Classes/Sbom/)
- [SPDX official site](https://spdx.dev/)

## Source map

**Definition:** A mapping between source-language locations and generated artifact locations.

**Why it matters to BankLang:** BankTS source must be traceable to generated COBOL paragraphs, copybooks, SQL/CICS sections, and audit output.

**References:**

- [Source Map Revision 3 proposal](https://sourcemaps.info/spec.html)

## Source map coverage

**Definition:** The proportion of source-language symbols that have a source map entry resolving to a real location in the generated artifact, together with the set of symbols that do not.

**Why it matters to BankLang:** Traceability is an audit claim, so it needs a measurement rather than an assumption. `bankc verify` reports coverage for every module, record, field, and function, and fails when an entry is missing or when an entry points at a line range that does not contain the generated COBOL name it describes. The corresponding diagnostics are `BANK-GEN-001` through `BANK-GEN-006` in `diagnostics.md`.

**References:**

- [Source Map Revision 3 proposal](https://sourcemaps.info/spec.html)

## SPDX

**Definition:** SPDX is an open standard for representing software components, licenses, SBOMs, and related metadata.

**Why it matters to BankLang:** SPDX is a practical SBOM format for enterprise review and open-source supply-chain documentation.

**References:**

- [SPDX official site](https://spdx.dev/)
- [SPDX specification](https://spdx.dev/use/specifications/)

## SQLCA

**Definition:** SQL Communication Area; a data structure used by embedded SQL programs to receive status and diagnostic information from SQL operations.

**Why it matters to BankLang:** Generated COBOL with Db2 embedded SQL must handle SQLCA/SQLCODE correctly and report unhandled paths.

**References:**

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)
- [Db2 for z/OS glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

## SQLCODE

**Definition:** A status code produced by SQL execution that indicates success, warning, not-found, or error conditions.

**Why it matters to BankLang:** BankLang must reject Db2 operations where SQLCODE paths are not handled.

**References:**

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)
- [Db2 for z/OS glossary](https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=db2-glossary)

## Syncpoint

**Definition:** In transaction processing, a syncpoint is a point where updates are committed or backed out as a consistent unit of work.

**Why it matters to BankLang:** CICS and Db2 transaction behaviour must be explicit. BankLang transaction blocks must map to safe commit/rollback behaviour.

**References:**

- [IBM CICS Transaction Server documentation](https://www.ibm.com/docs/en/cics-ts)
- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)

---

# T

## TypeScript

**Definition:** TypeScript is a statically typed superset of JavaScript that adds type annotations and compile-time checking while emitting JavaScript.

**Why it matters to BankLang:** BankLang uses TypeScript for the initial compiler implementation because it provides strong tooling, explicit types, and a practical development experience for parser, typechecker, IR, backend, and test code.

**References:**

- [TypeScript official site](https://www.typescriptlang.org/)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)

## Tester notes

**Definition:** A human-readable record of what changed, why it changed, what research was checked, what tests ran, what manual checks happened, and what remains unvalidated.

**Why it matters to BankLang:** Tester notes create a habit of evidence. They prevent vague claims such as “validated” without saying where, how, and against which backend.

**References:**

- [GitHub pull request documentation](https://docs.github.com/en/pull-requests)

## Transpiler

**Definition:** A tool that translates source code from one programming language to another language at a similar abstraction level.

**Why it matters to BankLang:** BankLang may be casually described as a transpiler, but for credibility it should present itself as a deterministic compiler/toolchain with semantic checks, IR, backend profiles, and audit evidence.

**References:**

- [TypeScript Compiler API wiki](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## Typechecker

**Definition:** A compiler component that verifies that expressions, declarations, assignments, function calls, records, and operations follow the language's type rules.

**Why it matters to BankLang:** The typechecker enforces decimal safety, currency safety, nullability, record layout constraints, and unsupported-feature rejection.

**References:**

- [TypeScript official documentation](https://www.typescriptlang.org/docs/)

---

## Transaction (BankTS)

**Definition:** A first-class BankTS declaration that groups the effects of one business operation: ledger postings and audit events.

**Why it matters to BankLang:** Transactions are the unit the banking safety rules apply to. Each must carry an [[idempotency-key]], emit at least one [[audit-event]], and balance its postings. A transaction lowers to a COBOL paragraph and must appear in the source map, which `BANK-GEN-007` enforces. Rollback and syncpoint behaviour are not modelled yet; those belong to the CICS profile on the roadmap.

**References:**

- [Language reference](language-reference.md)
- [ADR-0003](adr/0003-ledger-and-audit-calling-convention.md)

---

# V

## VSAM

**Definition:** Virtual Storage Access Method, an IBM mainframe data access method commonly used for record-oriented datasets.

**Why it matters to BankLang:** Many COBOL systems use VSAM files. BankLang must model file declarations, key access, file status handling, and record layouts.

**References:**

- [IBM z/OS documentation](https://www.ibm.com/docs/en/zos)

---

# Z

## z/OS

**Definition:** IBM's mainframe operating system for IBM Z systems.

**Why it matters to BankLang:** IBM Enterprise COBOL, CICS, IMS, Db2 for z/OS, VSAM, and JCL all sit in the z/OS ecosystem that BankLang primarily targets.

**References:**

- [IBM z/OS documentation](https://www.ibm.com/docs/en/zos)
- [IBM z/OS basic skills](https://www.ibm.com/docs/en/zos-basic-skills)

## 88-level condition name

**Definition:** A COBOL condition name declared with level number 88 to associate meaningful names with specific values of a data item.

**Why it matters to BankLang:** 88-level names are useful for generated readable COBOL and copybook compatibility, especially for status fields and boolean-like values.

**References:**

- [IBM Enterprise COBOL documentation](https://www.ibm.com/docs/en/cobol-zos)

---

# Additional strategic terms

## Enterprise readiness level

**Definition:** A staged maturity level describing what evidence the project has produced and what claims it is allowed to make.

**Why it matters to BankLang:** Readiness levels prevent premature claims such as production readiness or IBM compatibility. They let the repo show progress honestly.

**References:**

- [NASA Technology Readiness Level concept](https://www.nasa.gov/directorates/somd/space-communications-navigation-program/technology-readiness-levels/)

## Evidence bundle

**Definition:** A structured set of source files, generated artifacts, validation reports, audit reports, tester notes, and known limitations for a specific demo or milestone.

**Why it matters to BankLang:** Evidence bundles make the project reviewable by IBM, banks, auditors, and mainframe engineers.

**References:**

- [Reproducible Builds project](https://reproducible-builds.org/)
- [SPDX SBOM definition](https://spdx.github.io/spdx-spec/v3.0.1/model/Software/Classes/Sbom/)

## IBM Dependency Based Build

**Definition:** IBM Dependency Based Build is an IBM tool for building traditional z/OS applications, including COBOL, PL/I, and Assembler, as part of modern DevOps pipelines.

**Why it matters to BankLang:** BankLang should eventually emit build metadata or scripts compatible with DBB-style z/OS build workflows.

**References:**

- [IBM Dependency Based Build overview](https://www.ibm.com/docs/en/adffz/dbb/3.0.x?topic=dependency-based-build-overview)
- [IBM Dependency Based Build product page](https://www.ibm.com/products/dependency-based-build)

## IBM Z Development and Test Environment

**Definition:** IBM Z Development and Test Environment provides a controlled z/OS development and testing environment on x86-compatible infrastructure for development, test, education, and demonstration, not production workloads.

**Why it matters to BankLang:** ZD&T is a possible validation path for generated IBM-target COBOL where licensed access exists.

**References:**

- [IBM Z Development and Test Environment overview](https://www.ibm.com/docs/en/zdt/14.1.0?topic=overview)
- [IBM Z Development and Test Environment product page](https://www.ibm.com/products/z-development-test-environment)

## IBM Z Open Editor

**Definition:** IBM Z Open Editor is IBM tooling for editing IBM Z enterprise languages in Visual Studio Code.

**Why it matters to BankLang:** BankLang should eventually support a VS Code/LSP workflow that complements IBM Z developer tooling.

**References:**

- [IBM Developer for z/OS VS Code introduction](https://www.ibm.com/docs/en/developer-for-zos/17.0.x?topic=developing-vs-code)

## Readiness claim

**Definition:** A public or internal statement about what maturity level, validation level, or compatibility level a project has reached.

**Why it matters to BankLang:** Claims must match evidence. The repo must not claim IBM validation, production readiness, or full compatibility without proof.

**References:**

- [Reproducible Builds project](https://reproducible-builds.org/)

## watsonx Code Assistant for Z

**Definition:** IBM watsonx Code Assistant for Z is an IBM product that uses generative AI and automation to assist with understanding, managing, modernizing, or building COBOL applications.

**Why it matters to BankLang:** BankLang should position itself as complementary: deterministic compiler and evidence generation, while AI tools can assist understanding, refactoring, and documentation.

**References:**

- [IBM watsonx Code Assistant for Z product page](https://www.ibm.com/products/watsonx-code-assistant-z)
- [About watsonx Code Assistant for Z](https://www.ibm.com/docs/en/watsonx/watsonx-code-assistant-4z/2.x?topic=welcome-about-watsonx-code-assistant-z)

## ZUnit

**Definition:** ZUnit is IBM's z/OS automated unit testing framework, adapting xUnit concepts for Enterprise COBOL and PL/I testing.

**Why it matters to BankLang:** BankLang should eventually generate or align with unit-test artifacts suitable for IBM Z testing workflows.

**References:**

- [ZUnit overview](https://www.ibm.com/docs/en/developer-for-zos/15.0.x?topic=applications-zos-automated-unit-testing-framework-zunit)

## COBOL Check

**Definition:** COBOL Check is an Open Mainframe Project unit testing/checking framework for COBOL that provides fine-grained unit testing concepts similar to testing frameworks in other languages.

**Why it matters to BankLang:** COBOL Check is a possible open-source testing reference or integration candidate, though its current project state must be reviewed before relying on it.

**References:**

- [Open Mainframe Project COBOL Check GitHub repo](https://github.com/openmainframeproject/cobol-check)
- [COBOL Check project page](https://neopragma.com/projects/cobol-check/)

## EIBRESP

**Definition:** `EIBRESP` is a CICS EXEC Interface Block field used after EXEC CICS commands to indicate the response condition.

**Why it matters to BankLang:** BankLang CICS generation must require response-code handling and should not emit CICS calls with ignored responses.

**References:**

- [Response codes of EXEC CICS commands](https://www.ibm.com/docs/en/cics-ts/6.x?topic=codes-response-exec-cics-commands)

## Galasa

**Definition:** Galasa is an open-source deep integration test framework for testing across technologies and platforms, including z/OS and IBM middleware.

**Why it matters to BankLang:** Galasa is a possible future integration-test lane for CICS, IMS, and other z/OS resource validation.

**References:**

- [Open Mainframe Project Galasa](https://openmainframeproject.org/projects/galasa/)
- [IBM Distribution for Galasa overview](https://www.ibm.com/docs/en/test-accelerator-for-z/1.0.x?topic=overview-about-distribution-galasa)

## OpenCBS

**Definition:** OpenCBS is an open-source COBOL defects benchmark suite created to support research and tooling around COBOL program comprehension, debugging, and defect location.

**Why it matters to BankLang:** OpenCBS can help with parser robustness and diagnostic research but must not be treated as proof of banking production compatibility.

**References:**

- [OpenCBS paper](https://arxiv.org/abs/2206.06260)

## SQLSTATE

**Definition:** SQLSTATE is a standard SQL status code value that can be used alongside or instead of SQLCODE for SQL diagnostics.

**Why it matters to BankLang:** Db2 integration should model SQL success/error infrastructure, including SQLCA or SQLCODE/SQLSTATE host variables.

**References:**

- [Db2 for z/OS embedded SQL programming](https://www.ibm.com/docs/en/db2-for-zos/12.0.0?topic=zos-embedded-sql-programming)

## X-COBOL

**Definition:** X-COBOL is a dataset of COBOL repositories mined from GitHub, containing metadata and COBOL source files.

**Why it matters to BankLang:** X-COBOL may help with open-source corpus research and parser robustness, but it is not a substitute for bank/mainframe validation.

**References:**

- [X-COBOL paper](https://arxiv.org/abs/2306.04892)

## AI orchestrator

**Definition:** The AI agent responsible for supervising task planning, model delegation, patch review, testing, documentation updates, and final decisions.

**Why it matters to BankLang:** the assistant is the orchestrator. This prevents a model or a model from independently changing compiler semantics or approving risky output.

**References:**

- [a model API rate limits](https://ai.google.dev/a model-api/docs/rate-limits)
- [a model API models](https://ai.google.dev/a model-api/docs/models)

## a model 2.5 Flash

**Definition:** A Google a model model listed by Google as `a model-2.5-flash`, described as a hybrid reasoning model with a 1M-token context window and thinking budgets.

**Why it matters to BankLang:** a model 2.5 Flash may be useful as a scarce specialist reviewer, but active API throughput must be checked in AI Studio and cannot be assumed from the context-window size.

**References:**

- [a model API pricing](https://ai.google.dev/a model-api/docs/pricing)
- [a model API rate limits](https://ai.google.dev/a model-api/docs/rate-limits)

## Q/A review loop

**Definition:** A feature-review process where one agent asks hard questions, another answers, and another validates the answer against specs, tests, definitions, and source references.

**Why it matters to BankLang:** Q/A review loops reduce the chance of accepting easy but flaky AI-generated solutions.

**References:**

- [GitHub pull request documentation](https://docs.github.com/en/pull-requests)

## Workhorse model

**Definition:** A model used for bounded implementation or generation tasks under supervision from an orchestrator.

**Why it matters to BankLang:** a model may be a workhorse for small patches; a model should be reserved for specialist review, but it is not the project supervisor or correctness authority.

**References:**

- [a model API pricing](https://ai.google.dev/a model-api/docs/pricing)
- [a model API rate limits](https://ai.google.dev/a model-api/docs/rate-limits)

## a model 4

**Definition:** a model 4 is a family of open models from Google. Google's a model-on-a model-API documentation lists hosted a model API access for `a model-4-31b-it` and `a model-4-26b-a4b-it`.

**Why it matters to BankLang:** The user's AI Studio free-tier screenshots show a model 4 26B/31B with much higher observed daily request capacity than a model 2.5 Flash. BankLang can use a model as a high-volume free workhorse for bounded code, test, documentation, and review tasks.

**References:**

- [Run a model with the a model API](https://ai.google.dev/a model/docs/core/a model_on_a model_api)
- [a model 4 model card](https://ai.google.dev/a model/docs/core/model_card_4)

## Scarce specialist model

**Definition:** A model used sparingly for difficult, high-value tasks because its quota, cost, or latency makes it unsuitable for high-volume work.

**Why it matters to BankLang:** a model 2.5 Flash free-tier should be treated as a scarce specialist under the user's observed 20 RPD text/code quota.

**References:**

- [a model API rate limits](https://ai.google.dev/a model-api/docs/rate-limits)

## High-volume workhorse model

**Definition:** A model used for many bounded repetitive tasks because available quota and cost make it practical.

**Why it matters to BankLang:** a model 4 26B/31B can act as the high-volume free API workhorse if active AI Studio limits remain favorable.

**References:**

- [Run a model with the a model API](https://ai.google.dev/a model/docs/core/a model_on_a model_api)
- [a model API rate limits](https://ai.google.dev/a model-api/docs/rate-limits)
