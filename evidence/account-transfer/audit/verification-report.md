# Verification Report

Project: /workspace/Code/banklang/examples/account-transfer/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | /workspace/Code/banklang/evidence/account-transfer/cobol/ACCOUNTT.cbl |
| Copybook emit | passed | 1 copybook file(s) |
| Source map emit | passed | /workspace/Code/banklang/evidence/account-transfer/maps/source-map.json |
| JCL emit | passed | /workspace/Code/banklang/evidence/account-transfer/jcl/ACCOUNTT.jcl |
| Audit artifacts | passed | /workspace/Code/banklang/evidence/account-transfer/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 6/6 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 6
- traced-symbols: 6
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-transfer/gnucobol/copybooks evidence/account-transfer/gnucobol/cobol/ACCOUNTT-PRE.cbl -o evidence/account-transfer/gnucobol/bin/accountt
- compiler-exit-code: 0
