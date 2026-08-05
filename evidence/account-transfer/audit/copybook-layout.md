# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/evidence/account-transfer/audit/copybook-layout.md

## TRANSFER-REQUEST

Total length: 42

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | TRANSFER-REQUEST.DEBIT-ACCOUNT | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | TRANSFER-REQUEST.CREDIT-ACCOUNT | string<16> | PIC X(16) | DISPLAY | 16 | 16 | 16 | no |
| 3 | TRANSFER-REQUEST.AMOUNT | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 32 | 10 | 10 | no |
