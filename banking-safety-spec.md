# Banking Safety Specification

## 1. Diagnostic philosophy

BankLang must catch banking and mainframe hazards before COBOL is generated.

Diagnostics are product features. They should be stable, documented, and useful.

Every diagnostic has:

- ID
- severity
- title
- explanation
- source span
- backend profile
- remediation hint

## 2. Diagnostic ID namespaces

```txt
BANK-SYN-*    syntax
BANK-TYPE-*   type system
BANK-DEC-*    decimal/money
BANK-TXN-*    transaction
BANK-LED-*    ledger
BANK-AUD-*    audit
BANK-SQL-*    Db2/SQL
BANK-CICS-*   CICS
BANK-FILE-*   VSAM/file IO
BANK-COPY-*   copybook/layout
BANK-GEN-*    code generation
BANK-SEC-*    security
```

## 3. Decimal diagnostics

### `BANK-DEC-001` floating-point money forbidden

Money cannot use binary floating-point representation.

### `BANK-DEC-002` implicit scale narrowing

Assigning `decimal<18,4>` to `decimal<18,2>` requires explicit rounding.

### `BANK-DEC-003` missing rounding mode

Division or scale conversion requires an explicit rounding mode.

### `BANK-DEC-004` possible overflow

Operation may exceed target precision.

### `BANK-DEC-005` currency mismatch

Different currency types cannot be added/subtracted without explicit conversion.

## 4. Transaction diagnostics

### `BANK-TXN-001` missing idempotency key

A transaction that posts financial effects must have a typed idempotency key.

### `BANK-TXN-002` missing rollback path

A transaction backend requires rollback representation but no rollback path can be generated.

### `BANK-TXN-003` unsafe non-deterministic operation

Transaction contains an operation with backend-dependent behaviour.

### `BANK-TXN-004` unbounded loop in transaction

Transaction contains a loop without static bound or approved termination proof.

## 5. Ledger diagnostics

### `BANK-LED-001` unbalanced posting

Debit total may not equal credit total on at least one commit path.

### `BANK-LED-002` missing ledger entry

Money movement occurs without ledger posting.

### `BANK-LED-003` inconsistent value date

Posting date and value date policy is missing or inconsistent.

## 6. Audit diagnostics

### `BANK-AUD-001` missing audit event

Financial transaction path lacks audit event.

### `BANK-AUD-002` audit payload contains sensitive field

Audit payload includes a field marked sensitive.

### `BANK-AUD-003` audit event name is not compile-time constant

Audit event names must be statically known.

## 7. SQL diagnostics

### `BANK-SQL-001` SQLCODE not handled

A generated SQL operation must handle success, not found, and error branches.

### `BANK-SQL-002` dynamic SQL disallowed

Dynamic SQL is not supported in the selected backend profile.

### `BANK-SQL-003` host variable layout mismatch

SQL host variable does not match expected COBOL field layout.

### `BANK-SQL-004` transaction commit ambiguity

SQL statement participates in a transaction without clear commit/rollback mapping.

## 8. CICS diagnostics

### `BANK-CICS-001` CICS response code not handled

A CICS command must handle response code.

### `BANK-CICS-002` unsupported CICS operation

Selected backend profile does not support the requested operation.

### `BANK-CICS-003` syncpoint misuse

Transaction uses syncpoint in an invalid scope.

## 9. File diagnostics

### `BANK-FILE-001` file status not checked

File operation result is ignored.

### `BANK-FILE-002` record layout mismatch

File record layout differs from declared copybook.

### `BANK-FILE-003` unsafe restart behaviour

Batch file processing lacks checkpoint/restart policy.

## 10. Copybook diagnostics

### `BANK-COPY-001` unsupported PIC clause

Copybook contains a PIC clause not supported by current parser.

### `BANK-COPY-002` unsupported REDEFINES shape

`REDEFINES` construct cannot be represented safely in BankTS subset.

### `BANK-COPY-003` incompatible layout change

New copybook layout changes field offsets or byte lengths incompatibly.

## 11. Code generation diagnostics

These diagnostics protect the traceability claim: every BankTS symbol that
reaches the backend must be locatable in the generated COBOL.

### `BANK-GEN-001` module missing source map entry

The generated source map has no entry for the compiled module.

### `BANK-GEN-002` record missing source map entry

A record reached the backend but has no source map entry.

### `BANK-GEN-003` field missing source map entry

A record field reached the backend but has no source map entry.

### `BANK-GEN-004` function missing source map entry

A function reached the backend but has no source map entry.

### `BANK-GEN-005` source map entry outside generated artifact

An entry targets a line range that does not exist in the generated COBOL, or an
inverted range where the end line precedes the start line.

### `BANK-GEN-006` source map entry not anchored to generated name

An entry targets a line range that exists but does not contain the COBOL name
the entry claims to describe. This catches entries that drift when the emitter
changes its line layout.

## 12. Severity levels

```txt
error      compilation must stop
warning    compilation may continue but risk is recorded
info       useful explanation
audit      included in audit report
```

## 13. Audit report integration

All warnings and errors should be available in machine-readable audit output.

Example:

```json
{
  "id": "BANK-DEC-002",
  "severity": "error",
  "source": "src/transfer.bank.ts",
  "line": 42,
  "message": "Implicit scale narrowing requires explicit rounding."
}
```
