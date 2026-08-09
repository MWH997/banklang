# BankLang Architecture

## 1. Architecture overview

BankLang is a deterministic compiler toolchain.

```txt
BankTS source
  -> lexer/parser
  -> AST
  -> type checker
  -> semantic analyzer
  -> banking safety analyzer
  -> platform-independent IR
  -> COBOL-oriented IR
  -> backend emitters
  -> generated COBOL/copybooks/JCL/audit artifacts
```

The compiler must be deterministic from source input and configuration to output artifacts.

AI tools may assist repository development, documentation, and repetitive tests. AI must not participate in compilation decisions.

## 2. Core packages

### `packages/bankc-cli`

Responsibilities:

- command parsing
- project discovery
- configuration loading
- calling compiler pipeline
- emitting files
- printing diagnostics
- returning stable exit codes

Commands, as `bankc` itself lists them:

- `bankc check <project>`
- `bankc build <project>`
- `bankc job <directory>`
- `bankc analyse <file-or-directory>...`
- `bankc emit cobol <project>`
- `bankc emit copybooks <project>`
- `bankc emit jcl <project>`
- `bankc audit-report <project>`
- `bankc verify <project>`
- `bankc test <project>`
- `bankc zunit <project>`
- `bankc layout <project>`
- `bankc doctor`
- `bankc copybook import <file>`
- `bankc dclgen import <file>`
- `bankc copybook inspect <file>`
- `bankc copybook types <file>`
- `bankc copybook diff <left> <right>`
- `bankc explain [diagnostic-id]`
- `bankc fmt <project|file.cbl> [--check]`
- `bankc init <directory>`
- `bankc config <project>`
- `bankc version`

`tests/architecture.test.ts` compares that list against the CLI's own help
text in both directions, so a command this page omits fails the build and so
does one it invents.

### `packages/parser`

Responsibilities:

- lexical analysis
- parsing BankTS syntax
- producing AST
- preserving source spans
- producing syntax diagnostics

Must not perform semantic checks beyond syntax validity.

### `packages/ast`

Responsibilities:

- AST node definitions
- source span model
- visitor helpers
- serialization for debugging

### `packages/typechecker`

Responsibilities:

- symbol tables
- type resolution
- decimal precision/scale checks
- record checks
- function signature checks
- nullability checks
- assignment compatibility
- banned feature checks

### `packages/semantic-analyzer`

Responsibilities:

- transaction semantics
- audit event requirements
- idempotency requirements
- file status requirements
- SQLCODE handling requirements
- CICS response handling requirements
- double-entry invariants

### `packages/ir`

Responsibilities:

- platform-independent intermediate representation
- typed operations
- data layout metadata
- control-flow graph
- decimal operation representation
- transaction boundary representation
- source-map anchors

IR must not be COBOL text. It must represent program meaning.

### `packages/cobol-ir`

Responsibilities:

- COBOL-oriented lowering
- paragraph planning
- data division planning
- working-storage planning
- file section planning
- SQL/CICS block planning
- naming strategy
- reserved-word escaping

### `packages/cobol-backend`

Responsibilities:

- IBM Enterprise COBOL emitter
- GnuCOBOL-compatible emitter profile
- formatting
- fixed/free form configuration
- generated-code banners
- source map output
- golden-test compatibility

### `packages/compiler`

The pipeline as one call. `compile()` runs parse, typecheck, semantic
analysis, lowering and emission, and returns the diagnostics, the COBOL, the
copybooks, the JCL and the source map together. The CLI, the playground and
the tests all enter here, so there is one order of phases rather than three.

### `packages/copybook`

Responsibilities:

- copybook parser, over the reference format
- copybook import to BankTS records
- DCLGEN import to BankTS records
- layout engine: field offsets, byte lengths, alignment and slack
- packed-decimal metadata
- inspection and layout diffing of generated copybooks

Db2, CICS and VSAM do not have packages of their own. Each is a set of
constructs spread across the phases that have to agree about it: the syntax in
`parser`, the types and host-variable rules in `typechecker`, the required
error handling in `semantic-analyzer`, the shape in `ir`, and the emitted
`EXEC SQL` / `EXEC CICS` blocks and `FILE-CONTROL` / `FD` entries in
`cobol-backend`. A package per subsystem would have to reach into all five.

### `packages/precompiler`

Responsibilities:

- the Db2 and CICS precompile step over emitted COBOL
- `CBL`/`PROCESS` compiler-option statement handling
- what the translator leaves for the compiler to see

### `packages/cobol-runtime`

An interpreter for the COBOL this compiler emits: reference-format reader,
tokenizer, statement parser, and a machine with the picture, packed-decimal
and edited-field model behind it, plus files, cursors, the ledger and the
audit log.

It exists to disagree. Every example is executed twice, once by `cobc` and
once here, and a test fails on any difference — which is what catches a defect
that compiles and passes every static check.

### `packages/verifier`

Responsibilities:

- byte-for-byte comparison of two compilations
- source-map coverage checking

The golden tests, decimal property tests and audit-schema checks are suites in
`tests/`, not code in this package.

### `packages/conformance-lint`

Checks generated COBOL and JCL against the target's rules rather than against
a style: reserved words, intrinsic function names, reference-format columns,
and the constraints in [target conformance](target-conformance.md). This is
what grades an example nothing local can compile.

### `packages/zos-lint`

Rules over emitted COBOL that only matter on z/OS — commarea writes, `CALL`
operands, statement-level conventions the compiler is expected to honour.

### `packages/zunit`

Emits IBM zUnit test cases for a generated program, so the output can be
tested by the target's own framework rather than only by this repository.

### `packages/migration-analysis`

Reads COBOL you already have: paragraph graph, file use, SQL use, CICS use,
an inventory, and which of COBOL's constructs each member contains. It states
its own limits rather than guessing; see
[migration analysis](migration-analysis.md).

### `packages/horizontal-validation`

The other axis of validation. Everything else here is vertical — tests written
for BankLang, measuring BankLang against what their author expected — and this
is what measures the compiler against COBOL nobody wrote for it: independent
corpora, their licences, the rules that decide what BankTS can represent, and
the arithmetic that reports the answer with its denominator attached.

It reaches no network and fetches nothing. Corpora arrive in an ignored cache
through `tools/horizontal-fetch.ts`, pinned by `validation/corpus-lock.json`;
this package reads what is on disk. See
[horizontal validation](validation/horizontal-validation.md).

### `packages/formatter`

Formats BankTS. One canonical form, printed from the AST, so `bankc fmt
--check` is a build step rather than a preference.

### `packages/diagnostics`

Responsibilities:

- the diagnostic catalogue, keyed by stable ID
- `explainDiagnostic`, behind `bankc explain`
- reporters: text, JSON and SARIF
- the compiler's own invariant failures, kept apart from user diagnostics

No diagnostic can be emitted without a catalogue entry.

### `packages/config`

The `banklang.json` model, its JSON Schema, and the loader. The schema and the
accepted values are generated from one table, so a profile cannot be offered
by the schema and rejected by the loader.

### `packages/language-server`

An LSP server over stdio: diagnostics as you type, and the source-to-COBOL
mapping the editor navigates by.

### `packages/vscode-extension`

The editor client: BankTS syntax, the language server above, and the COBOL a
line produced.

### `packages/playground`

The whole compiler in a browser — no compile server, and nothing the reader
writes is sent anywhere. Editors for
BankTS and the emitted COBOL, the source map as a click-through between them,
and `Run` over `cobol-runtime`.

### `packages/site`

The static site: landing page, rendered documentation, blog, and the headers
served with them.

## 3. Intermediate representation

The IR should model these concepts explicitly:

- modules
- records
- fields
- primitive types
- decimal types
- currency types
- function definitions
- paragraphs
- assignments
- comparisons
- arithmetic operations
- control flow
- transaction blocks
- audit events
- SQL statements
- CICS statements
- file operations
- error branches
- source spans

Example IR concept:

```json
{
  "kind": "DecimalAdd",
  "left": "amount",
  "right": "fee",
  "precision": 18,
  "scale": 2,
  "rounding": "HALF_EVEN",
  "overflow": "DIAGNOSTIC"
}
```

The IR must preserve enough metadata to generate both COBOL and audit evidence.

## 4. Backend profiles

### `ibm-enterprise-cobol-zos`

Primary target.

Expected output:

- IBM Enterprise COBOL style
- `COMP-3` decimal support
- embedded SQL
- CICS blocks where needed
- JCL guidance
- copybooks
- source maps

### `gnucobol-local`

Local development target.

Expected output:

- GnuCOBOL-compatible subset
- no claim of production z/OS equivalence
- useful for CI and local behavioural fixtures

There are two profiles and no others. `BACKEND_PROFILES` in
`packages/config/src/index.ts` is the list, and the JSON Schema is generated
from it.

## 5. Determinism requirements

The same source files and same compiler version must produce the same output bytes.

Required controls:

- stable traversal order
- stable symbol ordering
- stable generated names
- stable formatting
- stable diagnostics
- stable source maps
- no time-dependent banners
- no random IDs
- no environment-dependent output unless explicitly configured

## 6. Source mapping

Every generated COBOL paragraph, major data item, copybook record, and audit event must map back to BankTS source spans.

Source map should include:

- source file
- start/end line and column
- generated artifact path
- generated line range
- IR node ID
- semantic category

## 7. Error handling model

Errors must be explicit.

Compiler diagnostics have:

- stable ID
- severity
- source span
- explanation
- remediation hint
- affected backend profile

Example:

```txt
BANK-DEC-003 error
Amount decimal<18,4> assigned to decimal<18,2> without explicit rounding.
Use round(amount, scale: 2, mode: HALF_EVEN).
```

## 8. Build artifacts

A build may produce:

```txt
dist/
  cobol/
  copybooks/
  jcl/
  maps/
  audit/
  zunit/
```

`dist` is the default `outDir`; `banklang.json` and `--out` both move it.

The audit folder must be machine-readable and human-readable.

## 9. Dependency policy

The compiler should minimize dependencies in core packages. Parser generators are allowed only if they produce deterministic output and are easy to audit.

Critical compiler logic must live in repository code, not opaque external services.
