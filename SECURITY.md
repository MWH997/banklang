# Security Policy

BankLang treats security issues as a normal part of repository maintenance.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories
rather than opening a public issue.

Never include secrets, credentials, or private customer data in issues, pull
requests, or generated artifacts.

## Design guarantees

The compiler is built so that a build is fully explainable from local inputs:

- no telemetry
- no network calls in the compiler core
- no source code sent to any external service by the compiler
- deterministic output: the same input produces byte-identical artifacts
- pinned dependencies through a committed lockfile

`bankc verify` re-emits every artifact from the same IR and fails if the bytes
differ, so a non-reproducible build is detectable rather than silent.

## Scope

Security concerns include:

- secret leakage in generated files, logs, or audit artifacts
- unsafe dependency additions
- compromised build scripts
- a diagnostic that suppresses a real safety issue
- generated artifacts that embed sensitive source data

## Expectations for a fix

- a clear explanation of the problem
- a test that prevents regression
- a `CHANGELOG.md` entry when user-visible behaviour changes

## AI policy

This repository is developed with AI assistance under one hard boundary: **AI is
never used as compiler truth.**

Permitted: documentation drafts, test fixture suggestions, diagnostic wording,
repetitive scaffolding.

Not permitted: deciding compiler semantics, generating COBOL at runtime,
silently updating golden outputs, approving diagnostics, or altering financial
arithmetic without deterministic tests.

Every artifact in this repository is produced by deterministic compiler code,
not by a model.
