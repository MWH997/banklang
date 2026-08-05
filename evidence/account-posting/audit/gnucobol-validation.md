# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                   |
| backend-profile            | gnucobol-local                                                                                                        |
| source-artifact            | examples/account-posting/src/main.bank.ts                                                                             |
| source-artifact-sha256     | 4923b5458c2d8286c458d300d10906fc158ca0410b4c4fd174d47c79665c0ae9                                                      |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-POSTING.cbl                                                                               |
| generated-artifact-sha256  | e3eb20ee670e5c7150fdec3788ae28d88ceba8b9db3cec87afce1a84ae6d8d35                                                      |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                    |
| source-map-artifact-sha256 | 4e4491eba5b14ae8e278ff63936a36e9ab1bf970501946bd365369e305209128                                                      |
| compiler-executable        | cobc                                                                                                                  |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                 |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/ACCOUNT-POSTING.cbl -o dist/gnucobol/bin/account-posting |
| compiler-exit-code         | 0                                                                                                                     |
| compiler-status            | passed                                                                                                                |

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
