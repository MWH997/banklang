# BankLang for VS Code

Write banking logic in **BankTS**, a small banking language whose types are
TypeScript's, and get **IBM Enterprise COBOL** out. This extension
puts the compiler in the editor: the same diagnostics, the same formatter, and
hover that tells you which COBOL lines a line of BankTS produces.

The compiler refuses to compile financially unsafe programs. An unbalanced
ledger posting, a retry with no idempotency key, money moving with no audit
trail: these are compile errors, not review comments. This extension is where
you see them, while typing rather than in a pipeline.

**[banklang.mwhassan.com](https://banklang.mwhassan.com)** ·
**[Try it in the browser](https://banklang.mwhassan.com/playground/)** ·
**[Documentation](https://banklang.mwhassan.com/docs/)**

## What it does

- **Diagnostics from the real compiler**, not a second implementation that
  drifts from it. The extension bundles the compiler and runs it on every
  keystroke, so what the editor underlines is what `bankc` fails on. That
  includes the banking rules: `BANK-TXN-001` (a transaction with no
  idempotency key), `BANK-AUD-001` and `BANK-AUD-002` (money moved without an
  audit record), `BANK-LED-001` (a posting that does not balance),
  `BANK-SEC-001` and `BANK-FILE-001`, each with the catalogue's explanation and
  its fix.
- **Hover.** On a diagnostic, why it fires and what to write instead. On a clean
  line, the range of generated COBOL that line is responsible for, and the
  traceability a reviewer asks for, without leaving the source.
- **Format on save**, through the compiler's own formatter, so formatting is one
  decision rather than an editor setting per person.
- **Outline**, with record fields nested under their record.
- **Syntax highlighting** from a TextMate grammar generated against the lexer's
  own token classes, including the contextual `debit`, `credit` and `audit`
  operations. A test in the repository compares the grammar to the lexer's
  keyword list, so a keyword the compiler accepts cannot go on looking like an
  undefined name here.

Files ending `.bank.ts` are recognised automatically.

## Settings

| Setting                 | Default | Meaning                                        |
| ----------------------- | ------- | ---------------------------------------------- |
| `banklang.server.path`  | `""`    | Path to a language server to use instead       |
| `banklang.trace.server` | `off`   | Log the traffic between VS Code and the server |

Leave `banklang.server.path` empty to use the bundled server. Point it at
`packages/language-server/src/bin.ts` when working inside the BankLang
repository itself.

## What this does not claim

Generated COBOL is validated locally with **GnuCOBOL**. **No IBM Enterprise
COBOL validation is claimed**: no program here has been compiled by IBM's
compiler or run on z/OS. The generator targets Enterprise COBOL 6.4 and cites
the manual for every construct it emits, and that is a different statement from
having run it. See
[status and limits](https://banklang.mwhassan.com/docs/status-and-limits.html).

The extension provides diagnostics, hover, formatting and an outline. It does
not provide completion, go-to-definition or rename.

## Version

The version here matches the compiler's, because the compiler is what ships
inside it. An extension version and a compiler version that move independently
would let somebody read a diagnostic in the editor that the command line does
not produce.

## Source, and reporting something wrong

Everything is in
[github.com/MWH997/banklang](https://github.com/MWH997/banklang), MIT licensed.

If the generated COBOL diverges from what Enterprise COBOL accepts, there is an
issue template for exactly that, and it asks for the emitted lines and a
sentence rather than a reproduction. That report is the most valuable one this
project can receive.
