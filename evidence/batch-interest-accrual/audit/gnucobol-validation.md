# GnuCOBOL Validation Report

| Field                      | Value                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                      |
| backend-profile            | gnucobol-local                                                                                           |
| source-artifact            | examples/batch-interest-accrual/src/main.bank.ts                                                         |
| source-artifact-sha256     | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa                                         |
| generated-artifact         | dist/gnucobol/cobol/BATCH-INTEREST-ACCRUAL.cbl                                                           |
| generated-artifact-sha256  | dc18fc14cd248eb8bffb83eab832edc7965b0b187f0b201e42e618df3dc9c03d                                         |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                       |
| source-map-artifact-sha256 | 7503bfddd89a0af193419eed1171ab26da9a6b731c49717b2feee3bc126f4ecf                                         |
| compiler-executable        | cobc                                                                                                     |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                    |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/BATCH-INTEREST-ACCRUAL.cbl -o dist/gnucobol/bin/batch-interest-accrual |
| compiler-exit-code         | 0                                                                                                        |
| compiler-status            | passed                                                                                                   |

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
