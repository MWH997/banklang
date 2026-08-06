# ADR-0003: Lower ledger and audit operations to a named calling convention

## Status

Accepted

## Context

The language makes transactions first class, with `debit`, `credit`, and
`audit` operations in the transaction body — see
[language-reference.md](../language-reference.md). The COBOL backend has
to lower those operations into something readable and deterministic.

Inlining posting logic is not an option. BankLang does not own the ledger, and
generating invented posting or journaling code would be a semantic claim the
project cannot support. Equally, emitting nothing would make the generated
program incomplete.

The operations therefore need a boundary: BankLang generates the call, and the
institution supplies the program behind it.

## Decision

Ledger and audit operations lower to `CALL` statements against a fixed BankLang
calling convention.

Two group items are emitted into working storage when a program declares at
least one transaction:

```cobol
       01  BANK-LEDGER-INTERFACE.
           05  BANK-LEDGER-OPERATION    PIC X(6).
           05  BANK-LEDGER-ACCOUNT      PIC X(32).
           05  BANK-LEDGER-AMOUNT       PIC S9(16)V99 COMP-3.
       01  BANK-AUDIT-INTERFACE.
           05  BANK-AUDIT-EVENT         PIC X(32).
           05  BANK-AUDIT-CORRELATION   PIC X(64).
```

A `debit` or `credit` statement fills `BANK-LEDGER-INTERFACE` and calls
`BANKLEDG`. An `audit` statement fills `BANK-AUDIT-INTERFACE` and calls
`BANKAUDT`. The operation name is moved as a literal, so `DEBIT` and `CREDIT`
are visible in the generated source rather than encoded.

Field widths are fixed rather than derived from the caller's record, so the
interface layout stays stable across programs and can be described by a single
copybook on the receiving side.

## Consequences

- The generated COBOL is complete and compiles: the account-posting example is
  validated locally with GnuCOBOL 3.2.0.
- `BANKLEDG` and `BANKAUDT` are BankLang conventions, not IBM or vendor
  interfaces. No IBM ledger, journaling, or audit product is implied.
- The institution owns the called programs and the semantics behind them.
- Amounts wider than `S9(16)V99` or accounts longer than 32 characters do not
  fit the current interface. That limit is deliberate for the current slice and
  is recorded as a known gap rather than silently truncated at compile time.
- Rollback and syncpoint behaviour are not modelled here. Those belong to the
  CICS profile on the roadmap.

## References

- [BankLang Language Specification](../language-reference.md)
- [Banking Safety Specification](../diagnostics.md)
- [IBM Enterprise COBOL CALL statement](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=statements-call-statement)
