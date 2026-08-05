# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/evidence/account-file-batch/audit/copybook-layout.md

## ACCOUNT-RECORD

Total length: 26

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ACCOUNT-RECORD.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | ACCOUNT-RECORD.BALANCE | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |

## POSTING-RECORD

Total length: 27

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POSTING-RECORD.POSTING-ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | POSTING-RECORD.POSTING-BALANCE | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | POSTING-RECORD.POSTING-FLAG | string<1> | PIC X(1) | DISPLAY | 26 | 1 | 1 | no |
