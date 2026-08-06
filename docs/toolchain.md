# Toolchain

Everything around the compiler: the CLI, the formatter, project configuration,
CI integration, and editor support.

## Commands

| Command                       | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `bankc init <dir>`            | Scaffold a project that compiles on first run      |
| `bankc check <project>`       | Diagnostics only, no artifacts                     |
| `bankc build <project>`       | COBOL, copybooks, JCL, source map, audit bundle    |
| `bankc verify <project>`      | Determinism and source-map coverage                |
| `bankc test <project>`        | check, build, verify, plus local `cobc` validation |
| `bankc fmt <project>`         | Format source; `--check` to verify only            |
| `bankc explain [id]`          | Explain a diagnostic, or list the catalogue        |
| `bankc config <project>`      | Show the resolved configuration                    |
| `bankc layout <project>`      | Copybook byte layout report                        |
| `bankc copybook <sub> <file>` | Inspect, summarise, or diff a generated copybook   |
| `bankc doctor`                | Environment report                                 |

### Global options

| Option                       | Applies to | Meaning                                     |
| ---------------------------- | ---------- | ------------------------------------------- |
| `--format text\|json\|sarif` | `check`    | Diagnostic output format                    |
| `--output <file>`            | `check`    | Write the machine-readable report to a file |
| `--out <dir>`                | build-like | Output root for generated artifacts         |
| `--watch`                    | any        | Rerun when a `.bank.ts` file changes        |

Positional arguments may appear before or after flags.

## Formatting

`bankc fmt` prints from the AST, so the output shape is decided by one code
path rather than by regex rewriting.

Two properties are tested:

- **Idempotent.** Formatting formatted output changes nothing.
- **Comment-preserving.** The lexer captures comments as trivia and the printer
  reattaches them. Own-line comments keep their own line; trailing comments stay
  on the line they annotate.

The formatter refuses to rewrite a file with syntax errors, because a formatter
that reshapes source it could not fully parse can destroy work.

Author blank lines inside a body are preserved (normalised to one), since
grouping is meaningful. Blank lines between top-level declarations are
normalised to exactly one.

```bash
pnpm fmt          # format every example
pnpm fmt:check    # verify, used by CI
```

## Project configuration

`banklang.json` sits beside `src/`:

```json
{
  "$schema": "https://banklang.dev/schema/banklang.json",
  "entry": "src/main.bank.ts",
  "outDir": "dist",
  "backendProfile": "ibm-enterprise-cobol-zos",
  "formatCheck": false
}
```

| Option           | Default                          | Meaning                                   |
| ---------------- | -------------------------------- | ----------------------------------------- |
| `entry`          | `src/main.bank.ts`               | Entry source file                         |
| `outDir`         | `dist`                           | Output root                               |
| `backendProfile` | `ibm-enterprise-cobol-zos`       | Target profile                            |
| `formatCheck`    | `false`                          | Treat formatting drift as a failure       |
| `copybookMode`   | `inline`                         | Whether records are written in or `COPY`d |
| `decimalPoint`   | `point`                          | `DECIMAL-POINT IS COMMA` when `comma`     |
| `currencySign`   | `$`                              | `CURRENCY SIGN IS`, for an edited picture |
| `runtimeOptions` | `TERMTHDACT(UADUMP)`, `TRAP(ON)` | Cards written to the job's `CEEOPTS` DD   |

### Language Environment run-time options

A step that states none runs on whatever the installation's defaults are, which
is not something a job's behaviour should depend on silently. The two defaults
are about whether a bad night can be diagnosed at all: `TERMTHDACT(UADUMP)`
asks for a readable dump when a program abends, and `TRAP(ON)` is what puts LE
in the path to produce one.

Everything else is a site's. A long-running batch wants `HEAP` and `STACK`
sized for the region and the data, and those are numbers this compiler cannot
see and does not invent:

```json
{
  "runtimeOptions": [
    "TERMTHDACT(UADUMP)",
    "TRAP(ON)",
    "HEAP(4M,1M,ANYWHERE,KEEP)",
    "STACK(1M,1M,ANYWHERE)"
  ]
}
```

Each entry is written on its own card, exactly as given. Nothing validates the
option names: the set belongs to Language Environment and grows with it, and a
compiler that refused an option it had not heard of would be one nobody could
use a new release of.

Unknown keys and wrong types are reported as warnings and fall back to
defaults, rather than throwing. A typo in a config file should produce a clear
message, not a stack trace. Inspect the resolved values with `bankc config`.

## CI integration

### Diagnostics as pull request annotations

`bankc check --format sarif` emits SARIF 2.1.0, which GitHub code scanning
ingests. Banking safety diagnostics then appear inline on the pull request
instead of buried in a log.

```yaml
- name: Produce SARIF report
  run: pnpm bankc check examples/account-posting --format sarif --output bankc.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: bankc.sarif
```

Uploading requires a public repository or GitHub Advanced Security.

Each SARIF rule carries the catalogue's explanation and remediation, so a
reviewer seeing `BANK-LED-001` for the first time gets the reasoning inline.

### JSON

`--format json` is the simpler machine-readable option, enriched with the
catalogue title and explanation for each diagnostic.

Both formats emit a valid report even when there are no diagnostics, so a CI
step can upload unconditionally. Exit status is `1` when any diagnostic was
reported and `0` otherwise, regardless of format.

## Editor support

### Language server

`packages/language-server` implements LSP over stdio with no dependencies:

| Capability           | Behaviour                                            |
| -------------------- | ---------------------------------------------------- |
| `publishDiagnostics` | On open and change, from the real compiler           |
| `hover`              | Diagnostic explanation, or the COBOL a line produces |
| `documentFormatting` | Runs the formatter                                   |
| `documentSymbol`     | Outline, with record fields nested                   |

```bash
pnpm lsp   # start the server on stdio
```

Transport is separate from request handling, so the whole protocol surface is
unit-tested without spawning a process.

Hover is worth calling out: on a clean line it reports which COBOL lines that
source produced, reading the same source map the playground uses.

### VS Code extension

`packages/vscode-extension` provides the language client, a TextMate grammar,
and editor configuration.

```bash
pnpm --filter banklang-vscode build
```

The extension is not published to the marketplace. Load it with **Run Extension**
from VS Code, or point `banklang.server.path` at the server entry point.

## Programmatic use

```ts
import { compile } from "@banklang/compiler";
import { formatBankTs } from "@banklang/formatter";
import { explainDiagnostic } from "@banklang/diagnostics";

const result = compile(source);
if (!result.ok) {
  for (const diagnostic of result.diagnostics) {
    const doc = explainDiagnostic(diagnostic.id);
    console.error(`${diagnostic.id}: ${doc?.remediation}`);
  }
}
```

`compile` and `formatBankTs` perform no file system or network access, so they
run in Node and in a browser. That is what lets the playground run the real
compiler client-side, and a test fails if any compiler package imports a Node
built-in.
