# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/branch-accrual-cursor/src/main.bank.ts |
| source-artifact-sha256 | a0d692d100c729039231471863f6c3fafa15f417bbf0e6fffd84e4d5340801ea |
| generated-artifact | evidence/branch-accrual-cursor/gnucobol/cobol/BRANCHAC.cbl |
| generated-artifact-sha256 | bb7d953de2f0dbbba5cb510d2ade66defede7e7ca5b2a8874af5d55c35d949f9 |
| source-map-artifact | evidence/branch-accrual-cursor/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 4e147ba0ddc2b395686aadf40e78ae3f1fcc64b020e3ddfab4c0ef5b61a910ca |
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
