# Governance

BankLang is currently maintained in a review-led, maintainer-driven model.

## Decision rules

- Compiler semantics must follow the written specs and tests.
- Generated output changes require explicit evidence.
- Architectural changes require a documented rationale.
- Changelog entries and tester notes are required for meaningful changes.

## Review expectations

Substantial compiler, backend, or safety changes should include:

- feature scrutiny notes
- tests
- tester notes
- updated documentation where behavior changes

## Commit discipline

Use focused, conventional commits with a body that explains why the change was
made and what validation ran.
