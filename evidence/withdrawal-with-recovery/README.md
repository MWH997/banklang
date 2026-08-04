# Withdrawal With Recovery Evidence Bundle

Generated artifacts for the withdrawal-with-recovery example, which exercises
record inheritance, guard clauses, `raise` with an `on failure` handler, ledger
rollback on the failure path, and an explicit program entry point.

This is the only example that is also **executed**. See
[`tests/conformance.test.ts`](../../tests/conformance.test.ts) and
[`runtime/README.md`](../../runtime/README.md).

## Contents

- `source/main.bank.ts`
- `cobol/WITHDRAWAL-WITH-RECOVERY.cbl`
- `copybooks/CURRENT-ACCOUNT.cpy`
- `copybooks/SAVINGS-ACCOUNT.cpy`
- `copybooks/WITHDRAWAL-RESULT.cpy`
- `jcl/WITHDRAWAL-WITH-RECOVERY.jcl`
- `maps/source-map.json`
- `audit/diagnostics.json`
- `audit/source-map.json`
- `audit/generated-artifacts.json`
- `audit/decimal-analysis.json`
- `audit/transaction-analysis.json`
- `audit/copybook-layout.json`
- `audit/copybook-layout.md`
- `audit/validation-matrix.md`
- `audit/verification-report.md`
- `audit/verification-report.json`
- `audit/gnucobol-validation.md`
- `audit/bankc-test-report.md`

## What this bundle shows

- `audit/copybook-layout.md` is the inheritance claim in evidence form:
  `SAVINGS-ACCOUNT`'s first three fields sit at exactly the offsets
  `CURRENT-ACCOUNT` puts them at, so a copybook cut for the base still reads a
  derived record.
- `cobol/WITHDRAWAL-WITH-RECOVERY.cbl` shows the whole failure shape: the
  `BANK-MAIN` entry paragraph, the wrapper performing the body through its exit
  paragraph, the `GO TO` out of `PERMITTED-AMOUNT` on a raise, the caller's test
  of `BANK-FAILURE-CODE` after the `PERFORM`, and the `ROLLBK` call that
  precedes the handler.
- The same file shows substitutability resting on that layout: `LEDGER-BALANCE-OF-P1`
  is a `LINKAGE` cell carrying `CURRENT-ACCOUNT`'s fields, and the call site
  points it at `SAVINGS-ACCOUNT` with `SET ADDRESS OF` rather than copying
  anything.
- `audit/source-map.json` traces all 19 symbols, including the paragraphs that
  only exist because the transaction can fail.
- `audit/gnucobol-validation.md` records the local `cobc` invocation, its exit
  code, and the SHA-256 of both the source and the generated artifact.

## What it does not show

GnuCOBOL 3.2.0 is not IBM Enterprise COBOL, and this bundle claims no IBM
validation. The executed conformance run behind this example uses the reference
runtime in `runtime/`, which is a set of small COBOL programs in this
repository — not a bank ledger, not Db2, and not CICS.
