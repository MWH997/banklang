# Repository Conventions

These conventions are mandatory for the BankLang repository.

BankLang must look like a serious compiler/toolchain project from the first commit. It should not look like an AI-generated code dump.

## 1. GitHub repository policy

The repository should initially be created as a **private GitHub repository**.

Use the GitHub CLI:

```bash
gh repo create banklang --private --source=. --remote=origin --push
```

Recommended initial setup:

```bash
git init
git add .
git commit -m "chore(repo): establish BankLang compiler planning baseline"
gh repo create banklang --private --source=. --remote=origin --push
```

Do not make the repository public until:

1. the deterministic compiler skeleton exists,
2. the README is accurate,
3. the security policy exists,
4. the examples run,
5. generated COBOL samples exist,
6. test commands pass,
7. limitations are documented honestly.

## 2. Branching convention

Use short-lived branches:

```txt
main
feature/parser-decimal-types
feature/cobol-emitter-skeleton
fix/source-map-determinism
docs/copybook-layout-spec
```

Do not batch unrelated changes into a single branch.

Every branch should have:

- one clear purpose
- tests for behaviour changes
- documentation updates if public behaviour changes
- changelog entry if user-visible or architecture-visible

## 3. Commit convention

Use conventional commits with a meaningful body.

Format:

```txt
type(scope): concise summary

Why:
- Explain why this change exists.
- Explain the design choice.
- Mention any rejected simpler alternative if relevant.

Validation:
- List commands run.
- List tests added or updated.
- Mention any manual tester notes.

Changelog:
- State the changelog entry added or explain why none was needed.
```

Accepted types:

```txt
feat
fix
docs
test
refactor
chore
ci
security
perf
```

Bad commit:

```txt
update files
```

Good commit:

```txt
feat(parser): parse decimal type aliases

Why:
- BankTS needs exact decimal metadata before the COBOL backend can map fields to PIC/COMP-3.
- Type aliases are the smallest useful language feature for the account-transfer demo.

Validation:
- Added parser tests for decimal<18, 2>.
- Ran pnpm test and pnpm typecheck.

Changelog:
- Added entry under Unreleased / Added.
```

## 4. Changelog policy

Every meaningful commit must update `CHANGELOG.md`.

Exceptions:

- typo-only fixes
- formatting-only changes
- internal comments with no behaviour or documentation impact

`CHANGELOG.md` should use this structure:

```md
# Changelog

## Unreleased

### Added

### Changed

### Fixed

### Security

### Testing

### Documentation

### Internal
```

Each entry should be specific.

Bad:

```md
- Updated compiler.
```

Good:

```md
- Added parser support for `decimal<precision, scale>` type aliases with source-span diagnostics.
```

## 5. Documentation discipline

Docs must be maintained as deep specifications, not AI-regenerated filler.

Rules:

1. Do not overwrite docs wholesale unless the change is intentional and reviewed.
2. Preserve existing design decisions.
3. Update the specific section affected by a code change.
4. Keep examples executable where possible.
5. Mark unimplemented features as planned with a version or ticket reference.
6. Do not use vague placeholders such as `TODO`, `TBD`, `later`, or `coming soon`.
7. If a feature is speculative, label it clearly as roadmap.
8. README should stay concise but accurate.
9. Deep details belong in `docs/` or dedicated spec files.
10. Architecture changes require an Architecture Decision Record.

Recommended ADR location:

```txt
docs/adr/
  0001-use-bankts-not-general-typescript.md
  0002-primary-target-ibm-enterprise-cobol.md
```

ADR template:

```md
# ADR-NNNN: Title

## Status

Accepted | Proposed | Superseded

## Context

What problem forced this decision?

## Decision

What did we decide?

## Consequences

What becomes easier, harder, or forbidden?
```

## 6. Feature scrutiny policy

Each new feature must be scrutinised before implementation.

Feature proposal checklist:

```md
# Feature Proposal: <name>

## Problem

What banking/compiler/mainframe problem does this solve?

## Non-goals

What will this not do?

## Source-language impact

Does BankTS syntax or semantics change?

## IR impact

Does the IR need a new node or metadata?

## COBOL output impact

How does generated COBOL change?

## Copybook/layout impact

Does byte layout change?

## Decimal/money impact

Can this affect precision, scale, rounding, or overflow?

## Mainframe impact

Does this affect IBM COBOL, Db2, CICS, VSAM, IMS, or JCL?

## Security/audit impact

Does this affect source maps, audit reports, or sensitive data?

## Testing plan

What tests prove this works?

## Documentation plan

Which docs must change?

## Rejected alternatives

What simpler or safer approaches were considered?
```

A feature should not be implemented just because it is easy. It should support the compiler’s credibility.

## 7. Web documentation verification policy

When internet access is available, use web search/current documentation before implementing or changing anything related to:

- IBM Enterprise COBOL
- z/OS
- CICS
- Db2 for z/OS
- IMS
- VSAM
- JCL
- GnuCOBOL
- Rocket/Micro Focus COBOL
- TypeScript compiler APIs
- parser libraries
- test frameworks
- GitHub Actions
- security tooling
- SBOM tooling
- package manager behaviour

Use primary sources first:

- IBM documentation for IBM COBOL, CICS, Db2, IMS, z/OS, JCL
- GnuCOBOL official documentation/source for GnuCOBOL behaviour
- TypeScript official docs/API references for TypeScript-related implementation
- GitHub docs for GitHub Actions and repository settings
- OpenSSF/SPDX official docs for security and SBOM

Do not rely on random blog posts for compiler or mainframe semantics unless no primary source exists. If a secondary source is used, record it in tester notes or an ADR.

Every implementation touching mainframe semantics should include a `Research notes` section in the PR or tester notes:

```md
## Research notes

- Checked IBM Enterprise COBOL documentation for packed decimal representation.
- Checked GnuCOBOL documentation for local backend limitations.
- Decision: IBM backend remains source of truth; GnuCOBOL is only a local test profile.
```

## 8. Compiler/toolchain validation policy

For enterprise credibility, validation must happen at multiple levels.

Preferred production validation target:

- IBM Enterprise COBOL for z/OS, when available.

Open-source/local validation target:

- GnuCOBOL, when IBM compiler access is unavailable.

Policy:

1. IBM Enterprise COBOL is the primary semantic target.
2. GnuCOBOL is useful for local smoke tests but must not be treated as proof of IBM z/OS correctness.
3. Any difference between IBM and GnuCOBOL behaviour must be documented in backend profiles.
4. Generated COBOL should include backend profile metadata in audit artifacts.
5. Compiler features that cannot be validated locally must include explicit tester notes and planned IBM validation steps.

## 9. Layered validation requirements

Every compiler feature should be validated through several layers.

Minimum layers:

1. **Static validation**
   Parser, typechecker, semantic diagnostics.

2. **IR validation**
   Ensure AST lowering preserves source spans, type metadata, decimal precision/scale, and layout information.

3. **Generated artifact validation**
   Check generated COBOL/copybooks/source maps/audit files against golden outputs and schemas.

4. **Behavioural validation**
   Run source-level reference evaluator and generated COBOL where possible.

5. **Layout validation**
   For records/copybooks, validate byte offsets, lengths, signedness, scale, and packed-decimal assumptions.

6. **Backend validation**
   Validate against GnuCOBOL locally where supported and IBM Enterprise COBOL when available.

7. **Audit validation**
   Ensure source maps, diagnostics, and audit reports contain enough evidence.

8. **Manual tester notes**
   Record what was tested, what was not tested, and why.

## 10. Testing layers

Required test categories:

- unit tests
- parser tests
- typechecker tests
- semantic diagnostic tests
- IR lowering tests
- COBOL emitter golden tests
- source-map tests
- copybook layout tests
- property-based decimal tests
- determinism tests
- CLI integration tests
- local GnuCOBOL smoke tests when available
- IBM compiler validation notes when available
- fuzz tests for parser/copybook parser
- audit-schema tests

Testing commands should be explicit:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm test:property
pnpm test:determinism
pnpm bankc check examples/account-transfer
pnpm bankc emit cobol examples/account-transfer
```

If GnuCOBOL is installed:

```bash
pnpm test:gnucobol
```

If IBM compiler access is available, use the documented enterprise validation flow. Do not fake IBM validation.

## 11. Tester notes policy

Every substantial feature or fix must include tester notes.

Recommended location:

```txt
tester-notes/
  2026-07-06-parser-decimal-types.md
  2026-07-06-cobol-emitter-skeleton.md
```

Tester note template:

```md
# Tester Notes: <feature/change>

## Change summary

What changed?

## Why this was needed

Why was the change made?

## Research notes

What documentation was checked?

## Validation commands

What commands were run?

## Automated tests

Which tests were added or updated?

## Manual checks

What was inspected manually?

## Backend validation

Was GnuCOBOL used?
Was IBM Enterprise COBOL used?
If not, why not?

## Known gaps

What remains unvalidated?

## Follow-up tickets

What should be done next?
```

Tester notes are not optional for:

- decimal semantics
- copybook layout
- COBOL generation
- Db2/CICS/VSAM/JCL support
- security changes
- release changes
- generated-output changes

## 12. Pull request policy

Every PR should include:

```md
## Summary

## Why

## Changes

## Feature scrutiny

## Research notes

## Validation

## Tester notes

## Changelog

## Risks

## Follow-up
```

PRs that change generated COBOL must include before/after snippets or golden diff references.

PRs that change compiler semantics must include an ADR or feature proposal.

## 13. Generated output policy

Generated COBOL, copybooks, source maps, and audit files must be deterministic.

Rules:

- no timestamps by default
- no random IDs
- no environment-dependent ordering
- no machine-specific absolute paths unless explicitly configured
- generated files contain a do-not-edit banner
- golden output changes require tests and changelog entries

## 15. Definitions file policy

The repository must maintain a root-level `definitions.md` file.

Purpose:

- define every important term used across the repository
- explain terminology in enough detail for compiler engineers, COBOL engineers, banking architects, auditors, and new contributors
- attach reference links to each term definition
- prevent vague or inconsistent terminology across README, specs, tickets, ADRs, tester notes, audit reports, and generated documentation

Rules:

1. Every important technical, banking, compiler, mainframe, testing, governance, or security term introduced in the repo must be added to `definitions.md`.
2. Each definition must include a `Definition`, `Why it matters to BankLang`, and `References` section.
3. Reference links should prefer primary documentation.
4. IBM/mainframe terms should prefer IBM documentation.
5. GnuCOBOL terms should prefer GnuCOBOL documentation.
6. TypeScript/compiler tooling terms should prefer TypeScript or official project documentation.
7. Security/SBOM terms should prefer SPDX, OpenSSF, GitHub, or other official project documentation.
8. If no primary source is available, use the best available source and mark it as secondary.
9. Do not add unexplained jargon in docs or tickets.
10. Any PR introducing a new term must update `definitions.md`.

Definition entry template:

```md
## Term

**Definition:** Clear explanation.

**Why it matters to BankLang:** Explain relevance to the compiler, generated COBOL, validation, migration tooling, or audit evidence.

**References:**

- [Reference title](https://example.com)
```

Reviewers should reject feature PRs that introduce new terminology without updating `definitions.md`.

## 14. Release policy

Do not release from a dirty tree.

Release checklist:

- all tests pass
- generated samples refreshed intentionally
- changelog updated
- compatibility matrix updated
- docs updated
- SBOM generated
- checksums generated
- tester notes complete
- known limitations documented
- security scan completed
