# GnuCOBOL Validation Report

| Field                      | Value                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                          |
| backend-profile            | gnucobol-local                                                                               |
| source-artifact            | examples/account-transfer/src/main.bank.ts                                                   |
| source-artifact-sha256     | ce511a3e0e193fcb873d1c72af546e76aa49dac9665dab56e4f1e05428527a44                             |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-TRANSFER.cbl                                                     |
| generated-artifact-sha256  | b3dc980875293b23f6afbbb4db029ee9aa00ef1ca2b5faaecc02a41b9bf2c23f                             |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                           |
| source-map-artifact-sha256 | 1511e46a23c9888005058064282278dc48bdcf5065e98f307c63f7b531627613                             |
| compiler-executable        | cobc                                                                                         |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                        |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/ACCOUNT-TRANSFER.cbl -o dist/gnucobol/bin/account-transfer |
| compiler-exit-code         | 0                                                                                            |
| compiler-status            | passed                                                                                       |

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
