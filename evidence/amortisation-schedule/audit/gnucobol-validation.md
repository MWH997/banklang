# GnuCOBOL Validation Report

| Field                      | Value                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| validated-with-gnucobol    | yes                                                                                                    |
| backend-profile            | gnucobol-local                                                                                         |
| source-artifact            | examples/amortisation-schedule/src/main.bank.ts                                                        |
| source-artifact-sha256     | 1a2193f454760ceae605f6901d0b6bb6c6e14ce0fb869f34a5e9b02f849cef57                                       |
| generated-artifact         | dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl                                                          |
| generated-artifact-sha256  | 2796d3d86a4b81274e73637e9917d2791394908241be9e1ee8110d48224d4e48                                       |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                     |
| source-map-artifact-sha256 | aae43515b492108b677040aab23b0431bd799dcd2e62cfc6bf16d59985e75a86                                       |
| compiler-executable        | cobc                                                                                                   |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                  |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl -o dist/gnucobol/bin/amortisation-schedule |
| compiler-exit-code         | 0                                                                                                      |
| compiler-status            | passed                                                                                                 |

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
