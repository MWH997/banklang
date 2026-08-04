# bankc Test Report

Project: examples/online-enquiry/
Version: 1
Backend profile: ibm-enterprise-cobol-zos

| Step            | Status  | Details                                                      |
| --------------- | ------- | ------------------------------------------------------------ |
| Check           | passed  | OK: examples/online-enquiry/                                 |
| Build           | passed  | Wrote /workspace/Code/banklang/dist/cobol/ONLINE-ENQUIRY.cbl |
| Verify          | passed  | Verified examples/online-enquiry/                            |
| GnuCOBOL report | emitted | /workspace/Code/banklang/dist/audit/gnucobol-validation.md   |

## Notes

- This report records command orchestration only.
- It does not claim business-semantics execution beyond the supported compiler subset.
- Local GnuCOBOL validation remains separate from IBM validation claims.
