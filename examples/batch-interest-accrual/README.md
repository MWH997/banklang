# Batch Interest Accrual Example

This example exercises the control-flow expansion path with a second BankTS
fixture.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- a record declaration
- a branch-based function that validates an interest threshold

## Expected artifacts

Running the CLI from the repository root writes generated artifacts to `dist/`.
The `build` command produces a full bundle:

- `dist/cobol/BATCH-INTEREST-ACCRUAL.cbl`
- `dist/copybooks/INTEREST-ACCOUNT.cpy`
- `dist/jcl/BATCH-INTEREST-ACCRUAL.jcl`
- `dist/maps/source-map.json`
- `dist/audit/diagnostics.json`
- `dist/audit/source-map.json`
- `dist/audit/generated-artifacts.json`
- `dist/audit/decimal-analysis.json`
- `dist/audit/transaction-analysis.json`
- `dist/audit/copybook-layout.json`
- `dist/audit/verification-report.md`
- `dist/audit/validation-matrix.md`

## Notes

The example keeps the branching shape simple so the control-flow lowering can
stay deterministic and readable.
