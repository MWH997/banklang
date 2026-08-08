# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/withdrawal-with-recovery/src/main.bank.ts |
| source-artifact-sha256 | 1259915f2e052ecc98e511c7d1b66779d222d7fb054850ebfcdb6063cc53621c |
| generated-artifact | evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW.cbl |
| generated-artifact-sha256 | e1efb31ee0fad50df14198ecc5ac05c44c71d80f8dfd7de23afc7c7483f27417 |
| source-map-artifact | evidence/withdrawal-with-recovery/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 5b0fbcf41418d6eb9523e306f19bf8d92644436b86be1e4544c8a29701c2dc08 |
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
