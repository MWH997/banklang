# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/statement-generation/src/main.bank.ts |
| source-artifact-sha256 | 6c8de1f6aa35b7a864feee37005986d4f8a3021a97d4825c3d2f38021ba0f43c |
| generated-artifact | evidence/statement-generation/gnucobol/cobol/STATEMEN.cbl |
| generated-artifact-sha256 | cfc3672ff95060064bb5f013b38515b0db78374f86972d15a1b083a644545389 |
| source-map-artifact | evidence/statement-generation/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 5ffae2d7ea9543bf70150dff7973ad66a475f664deea3a65bfaea81d2a521ee6 |
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
