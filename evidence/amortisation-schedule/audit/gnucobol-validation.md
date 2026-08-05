# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                               |
| backend-profile            | gnucobol-local                                                                                                                    |
| source-artifact            | examples/amortisation-schedule/src/main.bank.ts                                                                                   |
| source-artifact-sha256     | 1a2193f454760ceae605f6901d0b6bb6c6e14ce0fb869f34a5e9b02f849cef57                                                                  |
| generated-artifact         | dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl                                                                                     |
| generated-artifact-sha256  | a1b78e2da2df5413b4b35242c194954a848a720b0d756c8b0e01306696a33be8                                                                  |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                                |
| source-map-artifact-sha256 | 3b5c27c2e06f1c25accb2ea050763006c6b21a9d9659149ee6858b00ec173331                                                                  |
| compiler-executable        | cobc                                                                                                                              |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                             |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl -o dist/gnucobol/bin/amortisation-schedule |
| compiler-exit-code         | 0                                                                                                                                 |
| compiler-status            | passed                                                                                                                            |

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
