# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/statement-generation/src/main.bank.ts |
| source-artifact-sha256 | 0b053259461a1cb1635ffe6eac82121878423a50da4f58a1e94d0f8afd3cec83 |
| generated-artifact | evidence/statement-generation/gnucobol/cobol/STATEMEN.cbl |
| generated-artifact-sha256 | 4e39793436a3048f4c3884a3424fffb7ccf69c2ba0f617cc69aad60ded10f0e9 |
| source-map-artifact | evidence/statement-generation/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 31adfbc1eba1ad59cd095f292bd37799902b694559ea01ee81adaccbf2f0209d |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/statement-generation/gnucobol/copybooks evidence/statement-generation/gnucobol/cobol/STATEMEN-PRE.cbl -o evidence/statement-generation/gnucobol/bin/statemen |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

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
