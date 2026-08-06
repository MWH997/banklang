# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/online-enquiry/src/main.bank.ts |
| source-artifact-sha256 | 5b1f8ecf61fcd8d1b5ea8fd15ae6fa9092343285d1ead18fae8d6fd703c21382 |
| generated-artifact | evidence/online-enquiry/gnucobol/cobol/ONLINEEN.cbl |
| generated-artifact-sha256 | 1c2f8310a814053a29295930a1d34c740b603ef3453c1d7af1659564d47b5f16 |
| source-map-artifact | evidence/online-enquiry/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 22a3d08b22036d0663caa64be0d69c6fa2f5ae637d2939ed352f86af6f96fa72 |
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
