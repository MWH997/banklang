# bankc Test Report

Project: examples/batch-interest-accrual
Version: 1
Backend profile: ibm-enterprise-cobol-zos

| Step            | Status  | Details                                                |
| --------------- | ------- | ------------------------------------------------------ |
| Check           | passed  | OK: examples/batch-interest-accrual                    |
| Build           | passed  | Wrote /workspace/dist/cobol/BATCH-INTEREST-ACCRUAL.cbl |
| Verify          | passed  | Verified examples/batch-interest-accrual               |
| GnuCOBOL report | emitted | /workspace/dist/audit/gnucobol-validation.md           |

## Notes

- This report records command orchestration only.
- It does not claim business-semantics execution beyond the supported compiler subset.
- Local GnuCOBOL validation remains separate from IBM validation claims.
