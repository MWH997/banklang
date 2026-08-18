# Toolchain

Everything around the compiler: the CLI, the formatter, project configuration,
CI integration, and editor support.

## Commands

Every command `bankc --help` lists, and nothing else.
`tests/cli-toolchain.test.ts` holds this table to the CLI's own inventory, so a
command added without a row here fails the build.

| Command                        | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `bankc init <dir>`             | Scaffold a project that compiles on first run       |
| `bankc check <project>`        | Diagnostics only, no artifacts                      |
| `bankc build <project>`        | COBOL, copybooks, JCL, source map, audit bundle     |
| `bankc job <directory>`        | Several programs and their sorts, as one JCL stream |
| `bankc emit <what> <project>`  | One artifact kind: `cobol`, `copybooks` or `jcl`    |
| `bankc audit-report <project>` | The audit bundle on its own                         |
| `bankc verify <project>`       | Determinism and source-map coverage                 |
| `bankc test <project>`         | check, build, verify, plus local `cobc` validation  |
| `bankc zunit <project>`        | zUnit test case: configuration, driver, and job     |
| `bankc layout <project>`       | Copybook byte layout report                         |
| `bankc config <project>`       | Show the resolved configuration                     |
| `bankc fmt <project>`          | Format source; `--check` to verify only             |
| `bankc analyse <path>...`      | COBOL inventory, paragraph and copybook graphs      |
| `bankc copybook <sub> <file>`  | Import, inspect, summarise, or diff a copybook      |
| `bankc dclgen import <file>`   | A Db2 DCLGEN member, as BankTS                      |
| `bankc explain [id]`           | Explain a diagnostic, or list the catalogue         |
| `bankc doctor`                 | Environment report                                  |
| `bankc version`                | The compiler version, and nothing else              |

### Global options

| Option                       | Applies to | Meaning                                        |
| ---------------------------- | ---------- | ---------------------------------------------- |
| `--format text\|json\|sarif` | `check`    | Diagnostic output format                       |
| `--output <file>`            | `check`    | Write the machine-readable report to a file    |
| `--out <dir>`                | build-like | Output root for generated artifacts            |
| `--watch`                    | project    | Rerun when a `.bank.ts` file changes           |
| `--debug`                    | any        | Print the stack when the compiler itself fails |

Positional arguments may appear before or after flags.

`bankc analyse` recursively reads `.cbl`, `.cob`, and `.cpy` members from its
supplied paths. `--out` writes the inventory, one paragraph graph per program,
and deterministic copybook dependency reports as Mermaid Markdown and JSON.
Dependency resolution reports missing and duplicate member names rather than
guessing, and does not expand copybook content into the inventory counts.

Everything the compiler means to report (a diagnostic, a missing project, an
unreadable copybook) comes back as a message and an exit code. A failure it did
not anticipate is still a thrown error, and `bankc` prints its message on one
line prefixed with `bankc:` and exits 1. `--debug` adds the stack, which is the
right output for a bug in the compiler and the wrong output for a mistake in a
program.

Under `--watch` the same failure is printed and the session continues. A watch
exists to shorten the loop on exactly the errors that end a build, so ending the
watch on one is the wrong response: the exit code follows the last build, and
saving a fix clears it. `bankc job <directory> --watch` watches the directory
itself, since a job's sources are one level down in each step's project.

`--watch` applies to the commands that read a project (`check`, `build`,
`job`, `emit`, `audit-report`, `verify`, `test`, `zunit`, `layout`, `config`)
and is refused with exit code 2 on the rest, which name the commands that take
it. It used to be accepted everywhere, and "everywhere" included commands with
no project to find: `bankc explain BANK-LED-001 --watch` read the diagnostic
identifier as a project path and died on `ENOENT … watch '/…/BANK-LED-001'`,
and `bankc doctor --watch` opened a recursive watch over the working directory
to rerun a command no `.bank.ts` can change.

## `bankc doctor`

The first command worth running on a machine that has just cloned this, and the
one to paste into a bug report. It reports the compiler's own version, the
working directory and whether it holds a project, Node and the platform, the
backend target, and whether GnuCOBOL is installed: by running
`cobc --version` through the same resolution `pnpm test:gnucobol` uses,
including `GNUCOBOL_COBC_PATH`, so it names the compiler that lane would
actually run rather than whatever is first on the path.

```txt
BankLang doctor
bankc: 0.10.0
cwd: /home/somebody/banklang
project: src/main.bank.ts
node: v24.18.0
platform: linux
arch: x64
compiler target: ibm-enterprise-cobol-zos
local validation target: gnucobol-local
gnucobol: cobc (GnuCOBOL) 3.2.0
ibm enterprise cobol: not detected, and no native IBM validation is claimed
```

An absent `cobc` is a normal state, not a failure: the line says so and says
what it costs, which is that `pnpm test:gnucobol` and the `cobc` tests skip.

The last line is a constant. Nothing on a workstation can detect IBM Enterprise
COBOL, so printing it only on failure would leave a reader unsure whether a
missing line meant success or no check at all. It is always there, and never
conditional on something a machine could accidentally satisfy.

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
  "$schema": "https://banklang.mwhassan.com/schema/banklang.json",
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
