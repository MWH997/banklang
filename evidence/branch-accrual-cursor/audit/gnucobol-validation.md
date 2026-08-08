# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/branch-accrual-cursor/src/main.bank.ts |
| source-artifact-sha256 | a0d692d100c729039231471863f6c3fafa15f417bbf0e6fffd84e4d5340801ea |
| generated-artifact | evidence/branch-accrual-cursor/gnucobol/cobol/BRANCHAC.cbl |
| generated-artifact-sha256 | 4b0c1bb31795701cd7bdd5e311ef7a086238b780709ea8cc7109a91b1ab268ba |
| source-map-artifact | evidence/branch-accrual-cursor/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 721f41f6ae99ea81f23ef4c08c74e1af15060cf3541636927d273ff7fe167da1 |
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
