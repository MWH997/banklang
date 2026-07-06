# Enterprise Readiness Specification

## 1. Purpose

This document defines what BankLang must show before it can credibly be discussed with banks, IBM, or enterprise modernization teams.

Enterprise readiness does not mean production readiness. It means the project has enough discipline, evidence, and honesty to be taken seriously.

## 2. Enterprise readiness levels

### ERL 0 — Planning only

Characteristics:

- specs exist
- no compiler skeleton
- no generated output
- no validation evidence

Allowed claim:

> Concept and planning stage.

### ERL 1 — Deterministic compiler skeleton

Required:

- CLI
- parser subset
- AST
- typechecker subset
- IR subset
- COBOL emitter skeleton
- generated source map
- golden tests
- deterministic output test

Allowed claim:

> Deterministic compiler skeleton demonstrated on a restricted example.

### ERL 2 — Financial semantics evidence

Required:

- decimal precision/scale model
- rounding diagnostics
- overflow diagnostics
- money/currency model
- property tests
- decimal audit report

Allowed claim:

> Financial arithmetic checks demonstrated for the supported subset.

### ERL 3 — Copybook credibility

Required:

- copybook generation
- copybook parser subset
- layout inspector
- offset/length report
- layout diff
- fixture generator

Allowed claim:

> Copybook-aware layout evidence demonstrated for the supported subset.

### ERL 4 — Local COBOL validation

Required:

- GnuCOBOL-compatible local profile
- local generated COBOL compile/run smoke test
- limitations documented
- GnuCOBOL validation report

Allowed claim:

> Generated COBOL subset validated locally with GnuCOBOL, not yet IBM-certified.

### ERL 5 — IBM-target validation path

Required:

- IBM Enterprise COBOL backend profile
- IBM compiler options notes
- ZD&T or z/OS validation plan
- DBB build metadata roadmap
- ZUnit test roadmap
- validation matrix

Allowed claim:

> IBM Enterprise COBOL validation path is specified.

### ERL 6 — IBM compiler smoke validation

Required:

- generated COBOL compiled with IBM Enterprise COBOL
- evidence from validation environment
- compiler version recorded
- options recorded
- unsupported features recorded
- tester notes attached

Allowed claim:

> Selected generated artifacts validated with IBM Enterprise COBOL under documented conditions.

### ERL 7 — Pilot readiness

Required:

- multiple demos
- copybook import/export
- Db2 embedded SQL subset
- CICS transaction subset
- layered tests
- security posture
- SBOM
- governance
- risk register
- external review feedback

Allowed claim:

> Ready for controlled technical pilot discussion.

## 3. Enterprise evidence bundle

Every milestone should produce:

```txt
evidence/
  README.md
  source/
  generated-cobol/
  generated-copybooks/
  generated-jcl/
  source-maps/
  audit/
  tests/
  validation/
  tester-notes/
  risk-register.md
  limitations.md
```

## 4. Enterprise review checklist

A skeptical enterprise reviewer should be able to answer:

- What source subset is supported?
- What COBOL dialect/profile is targeted?
- What generated output was produced?
- Is the output deterministic?
- How are decimals handled?
- How are copybooks handled?
- What tests ran?
- What compiler validated the COBOL?
- What remains unsupported?
- What risks are known?
- Who reviewed the change?
- Which documentation sources support the implementation?

## 5. Enterprise anti-patterns

These make the repo look unserious:

- no generated COBOL committed as sample evidence
- no changelog
- no tester notes
- no exact decimal tests
- no copybook layout report
- no reference links
- no limitations page
- no reproducible commands
- claiming IBM validation without IBM validation
- using AI as the compiler
- vague README claims
