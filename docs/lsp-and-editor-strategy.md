# LSP and Editor Strategy

## Purpose

BankLang should align with modern IBM Z developer workflows.

## Source of truth

Use IBM Z Open Editor documentation and Language Server Protocol documentation.

## Research finding

IBM Z Open Editor provides VS Code language support for COBOL, PL/I, HLASM, REXX, and JCL through LSP. It includes features such as copybook hover/preview.

## BankLang editor roadmap

- BankTS syntax highlighting
- compiler diagnostics
- hover definitions from `definitions.md`
- go-to-definition
- copybook preview
- generated COBOL preview
- source-to-COBOL navigation
- generated audit artifact links

## v0.1 scope

Document only. CLI first.

## References

- [IBM Developer for z/OS on VS Code introduction](https://www.ibm.com/docs/en/developer-for-zos/17.0.x?topic=developing-vs-code)
- [IBM Z Open Editor documentation](https://ibm.github.io/zopeneditor-about/Docs/introduction.html)
- [Language Server Protocol specification](https://microsoft.github.io/language-server-protocol/)
