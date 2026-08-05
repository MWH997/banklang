# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/branch-accrual-cursor/src/main.bank.ts |
| source-artifact-sha256 | 2da557dc9a311acc9b5820327100ca0050a66992ddd30ec490c6bb8b9769f04c |
| generated-artifact | evidence/branch-accrual-cursor/gnucobol/cobol/BRANCHAC.cbl |
| generated-artifact-sha256 | 38ff6a47433d83645f587cace6743abd3f196f31806c975118df21a7e99b0543 |
| source-map-artifact | evidence/branch-accrual-cursor/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 9df8eb073db2793ac87ec4f9241eaae47ee04ef95f9054c03d9dfbf8b2195446 |
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
