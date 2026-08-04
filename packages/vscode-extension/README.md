# BankLang for VS Code

BankTS language support: banking safety diagnostics as you type, formatting, an
outline, and hover that tells you which COBOL a line produces.

## Features

- **Diagnostics** from the real compiler, including `BANK-TXN-001`,
  `BANK-AUD-001`, `BANK-AUD-003`, `BANK-LED-001`, and `BANK-FILE-001`.
- **Hover.** On a diagnostic, the catalogue explanation and the fix. On a clean
  line, the COBOL line range that line generates.
- **Format on save**, via the compiler's own formatter.
- **Outline** with record fields nested under their record.
- **Syntax highlighting** through a TextMate grammar that mirrors the lexer's
  token classes, including the contextual `debit`, `credit`, and `audit`
  operations.

## Building

```bash
pnpm install
pnpm --filter banklang-vscode build
```

Then press **F5** in VS Code, or run the **Run Extension** launch target, to
open a development host with the extension loaded.

## Settings

| Setting                 | Default | Meaning                                 |
| ----------------------- | ------- | --------------------------------------- |
| `banklang.server.path`  | `""`    | Path to the language server entry point |
| `banklang.trace.server` | `off`   | Log client/server traffic for debugging |

Leave `banklang.server.path` empty to use the bundled server, or point it at
`packages/language-server/src/bin.ts` when working inside this repository.

## Status

Not published to the Visual Studio Marketplace. It is built and typechecked in
CI, and the language server it talks to is unit-tested across its whole
protocol surface, but it has not been through marketplace review or broad
real-world use.
