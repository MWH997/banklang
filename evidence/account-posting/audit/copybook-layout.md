# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/dist/audit/copybook-layout.md

## TRANSFER-REQUEST

Total length: 78

| Order | Path                             | Type          | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | -------------------------------- | ------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | TRANSFER-REQUEST.DEBIT-ACCOUNT   | string<16>    | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | TRANSFER-REQUEST.CREDIT-ACCOUNT  | string<16>    | PIC X(16)            | DISPLAY | 16     | 16     | 16    |
| 3     | TRANSFER-REQUEST.AMOUNT          | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 32     | 10     | 10    |
| 4     | TRANSFER-REQUEST.IDEMPOTENCY-KEY | string<36>    | PIC X(36)            | DISPLAY | 42     | 36     | 36    |
