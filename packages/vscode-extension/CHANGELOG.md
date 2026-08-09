# Changelog

VS Code shows this file as a tab on the extension's page, so it is written for
somebody deciding whether to install rather than for somebody working on it.

The version tracks the compiler's, because the compiler ships inside the
extension. The repository's own [CHANGELOG](https://github.com/MWH997/banklang/blob/main/CHANGELOG.md)
records what changed in it.

## [0.10.0] — 2026-08-09

First published version.

- Diagnostics from the compiler itself, including the banking safety rules, with
  the catalogue's explanation and fix on hover.
- Hover on a clean line reports the range of generated COBOL that line produces.
- Format on save through the compiler's formatter.
- Outline, with record fields nested under their record.
- Syntax highlighting from a grammar held to the lexer's keyword list by a test.

Numbered 0.10.0 rather than 0.1.0: the extension bundles the compiler, and two
version numbers moving independently would let the editor report a diagnostic
the command line does not. There is no 0.9.0 of this extension — that version
of the compiler was recorded but never published, and shipping an extension
under a number nothing was ever released as would be the same defect one step
removed.
