# Roadmap

## v0.1 — Compiler credibility

Theme: deterministic compiler skeleton.

Deliverables:

- BankTS parser subset
- typed AST
- decimal type metadata
- minimal IR
- readable COBOL emitter
- source map
- golden tests
- `bankc check`
- `bankc emit cobol`
- account-transfer pure-function demo
- audit report skeleton

## v0.2 — Financial arithmetic

Theme: safe decimal and money behaviour.

Deliverables:

- decimal operations
- rounding policies
- overflow diagnostics
- currency types
- decimal property tests
- COBOL decimal mapping report

## v0.3 — Copybook foundation

Theme: data-layout credibility.

Deliverables:

- BankTS record to copybook generation
- subset copybook parser
- layout inspector
- copybook diff
- fixture generator
- copybook roundtrip example

## v0.4 — Banking diagnostics

Theme: domain safety.

Deliverables:

- diagnostic catalogue
- audit-event checker
- idempotency checker
- double-entry checker
- file-status checker
- source-map coverage checker

## v0.5 — Batch and file programs

Theme: batch workload credibility.

Deliverables:

- batch job declaration
- sequential file IO
- generated file sections
- generated JCL example
- batch interest accrual example

## v0.6 — Db2 profile

Theme: embedded SQL credibility.

Deliverables:

- SQL declarations
- host variable mapping
- SQLCA
- SQLCODE diagnostics
- CRUD lowering
- cursor support

## v0.7 — CICS profile

Theme: online transaction credibility.

Deliverables:

- transaction declaration
- COMMAREA support
- CICS command generation
- response-code diagnostics
- syncpoint/rollback model

## v0.8 — Migration analysis

Theme: legacy-estate relevance.

Deliverables:

- COBOL inventory tools
- copybook dependency graph
- SQL extractor
- CICS extractor
- paragraph graph
- skeleton migration output

## v1.0 — Serious open-source release

Theme: credible public launch.

Deliverables:

- stable CLI
- documented language subset
- stable audit schemas
- deterministic output guarantee
- security policy
- SBOM
- signed release target
- serious demos
- compatibility matrix
- contributor process
