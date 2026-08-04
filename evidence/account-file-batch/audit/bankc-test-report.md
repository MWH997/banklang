# bankc Test Report

Project: examples/account-file-batch
Version: 1
Backend profile: ibm-enterprise-cobol-zos

| Step            | Status  | Details                                            |
| --------------- | ------- | -------------------------------------------------- |
| Check           | passed  | OK: examples/account-file-batch                    |
| Build           | passed  | Wrote /workspace/dist/cobol/ACCOUNT-FILE-BATCH.cbl |
| Verify          | passed  | Verified examples/account-file-batch               |
| GnuCOBOL report | emitted | /workspace/dist/audit/gnucobol-validation.md       |

## Notes

- This report records command orchestration only.
- It does not claim business-semantics execution beyond the supported compiler subset.
- Local GnuCOBOL validation remains separate from IBM validation claims.
