# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/dist/audit/copybook-layout.md

## ACCOUNT-RECORD

Total length: 26

| Order | Path                      | Type          | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | ------------------------- | ------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | ACCOUNT-RECORD.ACCOUNT-ID | string<16>    | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | ACCOUNT-RECORD.BALANCE    | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 16     | 10     | 10    |
