# Verification Report

Project: /workspace/examples/account-transfer/src/main.bank.ts

| Check               | Status | Details                                    |
| ------------------- | ------ | ------------------------------------------ |
| Parse               | passed | 0 diagnostics                              |
| Typecheck           | passed | 0 diagnostics                              |
| COBOL artifact      | passed | /workspace/dist/cobol/ACCOUNT-TRANSFER.cbl |
| Source map artifact | passed | /workspace/dist/maps/source-map.json       |
| JCL artifact        | passed | /workspace/dist/jcl/ACCOUNT-TRANSFER.jcl   |
| Audit schema        | passed | verified locally by the assistant                  |

## Notes

- This report confirms the generated artifacts exist and match the current deterministic compiler pipeline.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately by `bankc test` and `pnpm test:gnucobol`.
