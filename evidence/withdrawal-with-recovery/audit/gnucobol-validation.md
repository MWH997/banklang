# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/withdrawal-with-recovery/src/main.bank.ts |
| source-artifact-sha256 | 03a58dfd1070aeba5f7273ea8afdae5c4983ddeb47ec8160dd33e49f595139f8 |
| generated-artifact | evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW.cbl |
| generated-artifact-sha256 | 8b4778d8925cd9d74d3c9dc2d09dbabf2b70678cd7753c0afb6d1d48a40e0739 |
| source-map-artifact | evidence/withdrawal-with-recovery/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 014b5d5c4389c47e8370c6eacd9c04f6cb49226945947edbc7ecf1859c1c45d9 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/withdrawal-with-recovery/gnucobol/copybooks evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW-PRE.cbl -o evidence/withdrawal-with-recovery/gnucobol/bin/withdraw |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
