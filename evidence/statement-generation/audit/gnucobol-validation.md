# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                             |
| backend-profile            | gnucobol-local                                                                                                                  |
| source-artifact            | examples/statement-generation/src/main.bank.ts                                                                                  |
| source-artifact-sha256     | 6c8de1f6aa35b7a864feee37005986d4f8a3021a97d4825c3d2f38021ba0f43c                                                                |
| generated-artifact         | dist/gnucobol/cobol/STATEMENT-GENERATION.cbl                                                                                    |
| generated-artifact-sha256  | 015007dc9a503dbe70572aa0947ef3baf8548702b6a1390947bad58e74239131                                                                |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                              |
| source-map-artifact-sha256 | a9329976cb196ac459579da81ca8c6c38f8af397815afd3c4cd10071557a4cb0                                                                |
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
