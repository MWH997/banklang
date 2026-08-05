# GnuCOBOL Validation Report

| Field                      | Value                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                                                   |
| backend-profile            | gnucobol-local                                                                                                                        |
| source-artifact            | examples/branch-accrual-cursor/src/main.bank.ts                                                                                       |
| source-artifact-sha256     | 2bda6c970730d7b02bfe14fb7826d0c55a27c34d3a5eaf70887cadb5d0f0b811                                                                      |
| generated-artifact         | dist/gnucobol/cobol/BRANCH-ACCRUAL-CURSOR.cbl                                                                                         |
| generated-artifact-sha256  | 0a7ee2861e56b4adc0c2341028d4e13ff1b5327c3d6cb45d32420550882c0d3c                                                                      |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                                                    |
| source-map-artifact-sha256 | 8620611aa73072bf320d25ec2dc1ff9409d514c5ddeb6ad6555490de7feb12cc                                                                      |
| compiler-executable        | cobc                                                                                                                                  |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                                                 |
| compiler-command           | cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/BRANCH-ACCRUAL-CURSOR-PRE.cbl -o dist/gnucobol/bin/branch-accrual-cursor |
| compiler-exit-code         | 0                                                                                                                                     |
| compiler-status            | passed                                                                                                                                |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This program requires db2-precompiler. It was translated by the BankLang precompiler before compiling, which checks the surrounding COBOL and every host variable but does not validate SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
