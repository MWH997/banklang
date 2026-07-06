# Governance and Security

## 1. License

Recommended license:

```txt
Apache-2.0
```

Reason:

- enterprise-friendly
- permissive
- patent grant
- familiar to banks and vendors

## 2. Required governance files

- `LICENSE`
- `SECURITY.md`
- `GOVERNANCE.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `AGENTS.md`

## 3. Security principles

- no telemetry by default
- no cloud upload by default
- no source code sent to AI services by compiler
- deterministic local builds
- pinned dependencies
- SBOM generation
- release checksums
- dependency audit in CI
- secret scanning in CI
- CodeQL or equivalent analysis

## 4. Supply-chain requirements

Releases should include:

- source tarball
- package archive
- checksum
- SBOM
- changelog
- compatibility matrix
- generated sample artifacts
- signed tag when release process supports it

## 5. AI policy

AI can be used for:

- documentation drafts
- test fixture suggestions
- diagnostic wording suggestions
- migration explanation drafts
- repetitive scaffolding
- examples review

AI must not be used for:

- deciding compiler semantics
- generating production COBOL at runtime
- silently modifying golden outputs
- approving diagnostics
- making security decisions
- altering financial arithmetic logic without deterministic tests

## 6. Review policy

Changes requiring strict review:

- decimal arithmetic
- copybook layout
- COBOL emission
- transaction semantics
- SQL/CICS generation
- diagnostics severity
- source-map generation
- generated output changes
- security policy
- release scripts

## 7. Compatibility policy

Every release must state compatibility with:

- BankTS language version
- compiler version
- COBOL backend profile version
- copybook subset version
- audit schema version

## 8. Deprecation policy

Deprecated features must remain for at least one minor release unless they are security-critical.

Every deprecation must include:

- replacement
- migration guide
- removal version
- diagnostic ID
