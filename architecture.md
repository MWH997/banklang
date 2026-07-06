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

Commands:

- `bankc check`
- `bankc build`
- `bankc emit cobol`
- `bankc emit copybooks`
- `bankc audit-report`
- `bankc doctor`
- `bankc copybook inspect`
- `bankc copybook types`
- `bankc copybook diff`

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

### `packages/copybook`

Responsibilities:

- copybook AST
- copybook parser
- copybook generator
- layout engine
- field offset calculation
- packed-decimal metadata
- layout diffing
- fixture generation

### `packages/db2`

Responsibilities:

- embedded SQL model
- host variable mapping
- SQLCA generation
- SQL diagnostics
- precompile/bind metadata generation

### `packages/cics`

Responsibilities:

- transaction model
- COMMAREA/channel/container model
- CICS command lowering
- response-code diagnostics
- syncpoint/rollback mapping

### `packages/vsam`

Responsibilities:

- file declaration model
- access mode model
- file status checking
- generated FILE-CONTROL and FD support

### `packages/verifier`

Responsibilities:

- golden tests
- source-vs-generated behavioural fixtures
- decimal property tests
- audit report validation
- source-map validation
- deterministic output validation

### `packages/lsp`

Responsibilities:

- editor integration
- diagnostics
- hover docs
- go-to-definition
- source-to-COBOL navigation

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

### `rocket-visual-cobol`

Roadmap target.

Expected output:

- compatibility profile
- useful for enterprise development environments

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
  tests/
```

The audit folder must be machine-readable and human-readable.

## 9. Dependency policy

The compiler should minimize dependencies in core packages. Parser generators are allowed only if they produce deterministic output and are easy to audit.

Critical compiler logic must live in repository code, not opaque external services.
