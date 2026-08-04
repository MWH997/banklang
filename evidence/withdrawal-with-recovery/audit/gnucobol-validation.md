# GnuCOBOL Validation Report

| Field                      | Value                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| validated-with-gnucobol    | yes                                                                                                          |
| backend-profile            | gnucobol-local                                                                                               |
| source-artifact            | examples/withdrawal-with-recovery/src/main.bank.ts                                                           |
| source-artifact-sha256     | 78e590d4a58d8e4ddf5bb5a1cf25a75387dd3a58516ae553aabaab832f9fba12                                             |
| generated-artifact         | dist/gnucobol/cobol/WITHDRAWAL-WITH-RECOVERY.cbl                                                             |
| generated-artifact-sha256  | edf403f81c2eaa23f86ac1a918718e8639b4c07d444b3fb638e21c04ed381321                                             |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                           |
| source-map-artifact-sha256 | af0093497740514e6713c15895976f92cfe63180ae420fcacc3788f4ad1ae1a2                                             |
| compiler-executable        | cobc                                                                                                         |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                        |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/WITHDRAWAL-WITH-RECOVERY.cbl -o dist/gnucobol/bin/withdrawal-with-recovery |
| compiler-exit-code         | 0                                                                                                            |
| compiler-status            | passed                                                                                                       |

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
