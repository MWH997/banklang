# GnuCOBOL Validation Report

| Field                      | Value                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                      |
| backend-profile            | gnucobol-local                                                                                           |
| source-artifact            | examples/interest-posting-batch/src/main.bank.ts                                                         |
| source-artifact-sha256     | 81c36c8bf27bfbe952b76b039551af8b91dcf672a40dcdc1afdf6f91aa32c36d                                         |
| generated-artifact         | dist/gnucobol/cobol/INTEREST-POSTING-BATCH.cbl                                                           |
| generated-artifact-sha256  | 236e45af638f6672764d58b6930f49df4de725494481598fb12d5667ace229f4                                         |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                       |
| source-map-artifact-sha256 | c5a549b651c2c383361db43a061f05969971358cde9e9eac5f4577020586c791                                         |
| compiler-executable        | cobc                                                                                                     |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                    |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/INTEREST-POSTING-BATCH.cbl -o dist/gnucobol/bin/interest-posting-batch |
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
