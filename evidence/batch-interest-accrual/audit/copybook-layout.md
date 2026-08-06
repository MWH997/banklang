# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/batch-interest-accrual/audit/copybook-layout.md

## INTEREST-ACCOUNT

Total length: 26

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | INTEREST-ACCOUNT.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | INTEREST-ACCOUNT.BALANCE | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
