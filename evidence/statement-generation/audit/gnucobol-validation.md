# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/statement-generation/src/main.bank.ts |
| source-artifact-sha256 | 6c8de1f6aa35b7a864feee37005986d4f8a3021a97d4825c3d2f38021ba0f43c |
| generated-artifact | evidence/statement-generation/gnucobol/cobol/STATEMEN.cbl |
| generated-artifact-sha256 | 3d5dbb5ee952fc16284379b24cea61ed7a6263daaf52d2606816aaac1efb1cfb |
| source-map-artifact | evidence/statement-generation/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | ace2d7a5872aa646136a4f182fdc5f02df4596c627c2c2055008b28db963e085 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/statement-generation/gnucobol/copybooks evidence/statement-generation/gnucobol/cobol/STATEMEN-PRE.cbl -o evidence/statement-generation/gnucobol/bin/statemen |
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
