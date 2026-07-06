# Security Policy

BankLang treats security issues as a normal part of repository maintenance.

## Reporting

Do not file secrets, credentials, or private customer data in issues, pull
requests, tester notes, or audit artifacts.

If you discover a vulnerability, report it through the repository's normal
security contact process if one exists, or open a private report in the hosting
platform if supported.

## Scope

Security concerns include:

- secret leakage in generated files or logs
- unsafe dependency additions
- compromised build scripts
- diagnostics that suppress a real safety issue
- generated artifacts that embed sensitive source data

## Expectations

Fixes should include:

- a clear explanation of the problem
- a test that prevents regression
- a changelog entry when user-visible behavior changes
- tester notes when the change affects compiler behavior or generated output
