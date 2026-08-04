# bankc Test Report

Project: examples/statement-generation/
Version: 1
Backend profile: ibm-enterprise-cobol-zos

| Step            | Status  | Details                                                            |
| --------------- | ------- | ------------------------------------------------------------------ |
| Check           | passed  | OK: examples/statement-generation/                                 |
| Build           | passed  | Wrote /workspace/Code/banklang/dist/cobol/STATEMENT-GENERATION.cbl |
| Verify          | passed  | Verified examples/statement-generation/                            |
| GnuCOBOL report | emitted | /workspace/Code/banklang/dist/audit/gnucobol-validation.md         |

## Notes

- This report records command orchestration only.
- It does not claim business-semantics execution beyond the supported compiler subset.
- Local GnuCOBOL validation remains separate from IBM validation claims.
