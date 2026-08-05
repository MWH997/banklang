# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                                     |
| backend-profile            | gnucobol-local                                                                                                                          |
| source-artifact            | examples/withdrawal-with-recovery/src/main.bank.ts                                                                                      |
| source-artifact-sha256     | c144363d321a6586794c5600f8e8e4bd9a4966d0b7cac277d4edae2fbfe1e093                                                                        |
| generated-artifact         | dist/gnucobol/cobol/WITHDRAWAL-WITH-RECOVERY.cbl                                                                                        |
| generated-artifact-sha256  | d613aefeea69e28cc0997e6bcacf317864dac30fe2fdb1965589097b00b75475                                                                        |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                                      |
| source-map-artifact-sha256 | efe2b5634710faea435961a361c25fe31134fac4d4532bb86c2a4e0585eeb398                                                                        |
| compiler-executable        | cobc                                                                                                                                    |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                                   |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/WITHDRAWAL-WITH-RECOVERY.cbl -o dist/gnucobol/bin/withdrawal-with-recovery |
| compiler-exit-code         | 0                                                                                                                                       |
| compiler-status            | passed                                                                                                                                  |

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
