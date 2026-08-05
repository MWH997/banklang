# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/withdrawal-with-recovery/src/main.bank.ts |
| source-artifact-sha256 | c144363d321a6586794c5600f8e8e4bd9a4966d0b7cac277d4edae2fbfe1e093 |
| generated-artifact | evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW.cbl |
| generated-artifact-sha256 | 623621e1854597f8d11d8bac70c5c7a7ed93d46f1e07fad106275a04bbcba362 |
| source-map-artifact | evidence/withdrawal-with-recovery/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 05373feded315953477f6d07eb286e95c14abf66d4bd46214d5308cfb318fd28 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/withdrawal-with-recovery/gnucobol/copybooks evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW.cbl -o evidence/withdrawal-with-recovery/gnucobol/bin/withdraw |
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
