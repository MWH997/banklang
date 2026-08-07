# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/branch-accrual-cursor/src/main.bank.ts |
| source-artifact-sha256 | 7e7c3b9d3f567c5aaceaa31d0a618efcc171be1e1c11579bc119ae82f498faab |
| generated-artifact | evidence/branch-accrual-cursor/gnucobol/cobol/BRANCHAC.cbl |
| generated-artifact-sha256 | ec2406e9e6c7029ee639c09c13abbe0085471f62c7accf05762da9cffb519ef9 |
| source-map-artifact | evidence/branch-accrual-cursor/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 6d22a334091f9f1d77985de4bc78052877c5d76c516e1fa4c07b931cb0ffb4d9 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/branch-accrual-cursor/gnucobol/copybooks evidence/branch-accrual-cursor/gnucobol/cobol/BRANCHAC-PRE.cbl -o evidence/branch-accrual-cursor/gnucobol/bin/branchac |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

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
