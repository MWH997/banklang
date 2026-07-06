# Batch Interest Accrual Example

This example exercises the control-flow expansion path with a second BankTS
fixture.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- a record declaration
- a local decimal variable, arithmetic, and a branch-based function that validates an interest threshold

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
- `dist/audit/verification-report.json`
- `dist/audit/gnucobol-validation.md`
- `dist/audit/bankc-test-report.md`
- `dist/audit/validation-matrix.md`

The narrower emit and validation commands still write their respective outputs:

- `pnpm bankc verify examples/batch-interest-accrual` writes
  `dist/audit/verification-report.md` and `dist/audit/verification-report.json`
- `pnpm bankc test examples/batch-interest-accrual` runs `check`, `build`, and
  `verify`, then writes `dist/audit/bankc-test-report.md` plus the local
  GnuCOBOL report in `dist/audit/gnucobol-validation.md`
- `pnpm bankc emit jcl examples/batch-interest-accrual` writes
  `dist/jcl/BATCH-INTEREST-ACCRUAL.jcl`

## Notes

The example keeps the branching shape simple so the control-flow lowering can
stay deterministic and readable.
