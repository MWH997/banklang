# BankLang Product Specification

## 1. Product statement

BankLang is an open-source compiler toolchain for writing banking-safe programs in **BankTS**, a strict TypeScript-like language, and compiling them into readable, auditable **IBM Enterprise COBOL for z/OS**.

The compiler is deterministic. It does not use AI to decide code generation. AI may be used around the compiler for documentation, test generation, migration explanations, and repetitive scaffolding.

## 2. Primary audiences

### Banking engineering teams

They need safe modern tooling without losing COBOL compatibility.

### Mainframe engineers

They need generated COBOL that is readable, traceable, buildable, and compatible with existing copybooks and z/OS workflows.

### Enterprise architects

They need a migration path that does not demand a risky big-bang rewrite.

### Auditors and risk teams

They need evidence: source maps, decimal-safety reports, transaction reports, copybook layout reports, and test evidence.

### IBM / mainframe ecosystem vendors

They need to see a serious toolchain that respects IBM COBOL, CICS, Db2, VSAM, IMS, JCL, and enterprise build processes.

## 3. Product principles

1. Deterministic compiler output.
2. Exact decimal arithmetic.
3. Readable generated COBOL.
4. Copybook compatibility.
5. Source-to-COBOL traceability.
6. Audit evidence as a first-class build output.
7. Local development support through GnuCOBOL-compatible test backend where possible.
8. IBM Enterprise COBOL for z/OS as the primary target.
9. No arbitrary JavaScript runtime semantics.
10. AI-assisted tooling, not AI-controlled compilation.

## 4. Source language

The source language is **BankTS**.

BankTS resembles TypeScript syntactically but is a restricted, statically checked banking language. It forbids dynamic JavaScript features and models banking concepts directly.

BankTS supports:

- modules
- typed records
- exact decimal types
- currency-specific money types
- bounded arrays
- explicit nullable types
- explicit error handling
- transaction blocks
- file declarations
- copybook imports
- SQL declarations
- CICS transaction declarations
- audit events
- deterministic control flow

BankTS does not support:

- `eval`
- prototype mutation
- arbitrary reflection
- implicit `any`
- binary floating-point money
- unbounded dynamic object shapes
- hidden async behaviour
- exceptions crossing transaction boundaries
- runtime-dependent field ordering
- arbitrary JavaScript libraries

## 5. Primary target

The primary target is IBM Enterprise COBOL for z/OS.

The compiler should generate:

- COBOL source
- copybooks
- JCL examples
- Db2 embedded SQL sections
- SQLCA handling
- CICS command sections where applicable
- VSAM file access definitions
- source maps
- audit reports
- test harnesses

## 6. Secondary target

The secondary target is a GnuCOBOL-compatible local backend for developer confidence and CI.

The GnuCOBOL backend is not the enterprise production target. It exists to test compiler behaviour, decimal arithmetic, control flow, data-layout expectations where possible, and generated program fixtures.

## 7. Required capability areas

### 7.1 Exact financial arithmetic

The compiler must support exact decimal arithmetic and money types with explicit precision, scale, rounding, and overflow behaviour.

Example:

```ts
type BDT = currency<"BDT", 18, 4>;
type LedgerAmount = decimal<18, 2>;
```

Required checks:

- precision loss
- overflow
- implicit currency mixing
- missing rounding mode
- invalid scale assignment
- division without rounding policy
- unsafe conversion to display string

### 7.2 Copybook support

The compiler must support both directions:

1. BankTS types to COBOL copybooks.
2. Existing COBOL copybooks to BankTS types.

Required copybook features:

- `01` records
- nested groups
- `PIC`
- `COMP`
- `COMP-3`
- `DISPLAY`
- `OCCURS`
- `OCCURS DEPENDING ON`
- `REDEFINES`
- `88` condition names
- signed numeric fields
- fixed-length alphanumeric fields

Required reports:

- field offset map
- byte-length map
- packed-decimal map
- incompatible layout diff
- binary fixture generation report

### 7.3 Db2 support

The compiler must model embedded SQL as a first-class target feature.

Required features:

- host variables
- SQLCA
- cursors
- simple `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`
- explicit SQLCODE handling
- rollback/commit mapping
- generated precompile/bind guidance
- mockable local test adapter

### 7.4 CICS support

The compiler must support online transaction-style programs.

Required features:

- transaction declaration
- COMMAREA
- channels/containers in roadmap
- `EXEC CICS` generation
- response-code handling
- syncpoint/rollback modelling
- generated error paragraph strategy
- generated test stubs

### 7.5 VSAM support

The compiler must support file access declarations for mainframe-style data stores.

Required features:

- sequential input/output
- KSDS roadmap support
- file status checking
- key definitions
- generated `FILE-CONTROL`
- generated FD records
- generated open/read/write/close paragraphs

### 7.6 Batch support

Required features:

- batch job declaration
- input files
- output files
- restart checkpoints
- return codes
- abend strategy
- generated JCL example
- summary report generation

### 7.7 Audit evidence

Every build should be able to produce an audit folder containing:

- source-to-COBOL map
- decimal analysis
- transaction analysis
- copybook layout report
- generated COBOL inventory
- test evidence
- unsupported feature report
- SBOM file
- risk register

## 8. CLI

The CLI is named `bankc`.

Required commands:

```txt
bankc init
bankc check
bankc build
bankc emit cobol
bankc emit copybooks
bankc emit jcl
bankc verify
bankc test
bankc layout
bankc copybook inspect
bankc copybook types
bankc copybook diff
bankc audit-report
bankc doctor
```

## 9. First serious demo

The first serious demo is `examples/account-transfer`.

It must include:

- account debit
- account credit
- double-entry ledger validation
- insufficient funds path
- duplicate transaction detection
- explicit audit event
- exact decimal amount
- generated COBOL
- generated copybook
- generated audit report
- golden tests
- GnuCOBOL-compatible test path where possible

## 10. Definition of credible v0.1

A credible v0.1 release must include:

1. parser for a restricted BankTS subset
2. typed AST
3. exact decimal type checking
4. minimal IR
5. COBOL backend for batch-style programs
6. copybook generator
7. golden tests
8. source map generation
9. account-transfer example
10. audit-report skeleton
11. `bankc check`
12. `bankc emit cobol`
13. `bankc audit-report`
14. security policy
15. clear unsupported-features document
