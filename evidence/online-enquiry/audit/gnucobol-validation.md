# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/online-enquiry/src/main.bank.ts |
| source-artifact-sha256 | 5bad584888ff9f884296845682286d4cba144812f3d1405b9f3f66009ad45201 |
| generated-artifact | evidence/online-enquiry/gnucobol/cobol/ONLINEEN.cbl |
| generated-artifact-sha256 | 5b186efdf984d708b574d2253c80104cadf2413a24fa56a9963e665caa177327 |
| source-map-artifact | evidence/online-enquiry/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 8cfc9a0492064325109069d1a826258e7ed8dd01589935146c2204e08f2b2fdf |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/online-enquiry/gnucobol/copybooks evidence/online-enquiry/gnucobol/cobol/ONLINEEN-PRE.cbl -o evidence/online-enquiry/gnucobol/bin/onlineen |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This program requires db2-precompiler and cics-translator. It was translated by the BankLang precompiler before compiling, which checks the surrounding COBOL and every host variable but does not validate SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
