# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/withdrawal-with-recovery/src/main.bank.ts |
| source-artifact-sha256 | e23bf46be9e23e8acab9748648fdaf226a89d8b49cf57c5c938b84338e90e334 |
| generated-artifact | evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW.cbl |
| generated-artifact-sha256 | 4ef161b27372b6e1a55e289aaa95cd9b6d514c38db12071702d501aa5b6de0a6 |
| source-map-artifact | evidence/withdrawal-with-recovery/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 442e0e79b52ccb3672085d4b385136f128a85f893dd7c92d52768c61f3c3273d |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/withdrawal-with-recovery/gnucobol/copybooks evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW-PRE.cbl -o evidence/withdrawal-with-recovery/gnucobol/bin/withdraw |
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
