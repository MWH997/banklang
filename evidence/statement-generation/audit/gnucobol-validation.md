# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                             |
| backend-profile            | gnucobol-local                                                                                                                  |
| source-artifact            | examples/statement-generation/src/main.bank.ts                                                                                  |
| source-artifact-sha256     | 6c8de1f6aa35b7a864feee37005986d4f8a3021a97d4825c3d2f38021ba0f43c                                                                |
| generated-artifact         | dist/gnucobol/cobol/STATEMENT-GENERATION.cbl                                                                                    |
| generated-artifact-sha256  | 6017c7645b1ea1bb2946d50257ac47b1e56964bb25cb6510833cfb5c2860a30a                                                                |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                              |
| source-map-artifact-sha256 | 83e8ef76b91cd7415e2faf1ebdfb0628c7361280994a8306c5aa995c5e1c26f7                                                                |
| compiler-executable        | cobc                                                                                                                            |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                           |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/STATEMENT-GENERATION.cbl -o dist/gnucobol/bin/statement-generation |
| compiler-exit-code         | 0                                                                                                                               |
| compiler-status            | passed                                                                                                                          |

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
