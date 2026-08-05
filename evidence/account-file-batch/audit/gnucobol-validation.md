# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                         |
| backend-profile            | gnucobol-local                                                                                                              |
| source-artifact            | examples/account-file-batch/src/main.bank.ts                                                                                |
| source-artifact-sha256     | 561b89ea4116a112a95061ece3e92d7df8aa8e0f44c86899be645f0a6df5de6e                                                            |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-FILE-BATCH.cbl                                                                                  |
| generated-artifact-sha256  | 9ff65d9eb2d51a4dbc6899db263a72e854e4ef74ae741eef6909f94849ce0355                                                            |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                          |
| source-map-artifact-sha256 | 087933891b236b452012c20191e24120aa525d70108f47f4cb320043cddee663                                                            |
| compiler-executable        | cobc                                                                                                                        |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                       |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/ACCOUNT-FILE-BATCH.cbl -o dist/gnucobol/bin/account-file-batch |
| compiler-exit-code         | 0                                                                                                                           |
| compiler-status            | passed                                                                                                                      |

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
