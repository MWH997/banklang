# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/account-posting/audit/copybook-layout.md

## POST-TRANSFER-REQUEST

Total length: 78

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POST-TRANSFER-REQUEST.DEBIT-ACCOUNT | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | POST-TRANSFER-REQUEST.CREDIT-ACCOUNT | string<16> | PIC X(16) | DISPLAY | 16 | 16 | 16 | no |
| 3 | POST-TRANSFER-REQUEST.AMOUNT | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 32 | 10 | 10 | no |
| 4 | POST-TRANSFER-REQUEST.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 42 | 36 | 36 | no |
