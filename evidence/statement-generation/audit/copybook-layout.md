# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/dist/audit/copybook-layout.md

## LEDGER-ENTRY

Total length: 56

| Order | Path                    | Type                 | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | ----------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | LEDGER-ENTRY.ENTRY-KIND | enum<EntryKind>      | PIC X(6)             | DISPLAY | 0      | 6      | 6     |
| 2     | LEDGER-ENTRY.NARRATIVE  | string<40>           | PIC X(40)            | DISPLAY | 6      | 40     | 40    |
| 3     | LEDGER-ENTRY.AMOUNT     | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 46     | 10     | 10    |

## STATEMENT

Total length: 5701

| Order | Path                           | Type                     | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | ------------------------------ | ------------------------ | -------------------- | ------- | ------ | ------ | ----- |
| 1     | STATEMENT.ACCOUNT-ID           | string<16>               | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | STATEMENT.STATUS-FLD           | enum<AccountStatus>      | PIC X(7)             | DISPLAY | 16     | 7      | 7     |
| 3     | STATEMENT.OPENING-BALANCE      | currency<"BDT",18,2>     | PIC S9(16)V99 COMP-3 | COMP-3  | 23     | 10     | 10    |
| 4     | STATEMENT.CLOSING-BALANCE      | currency<"BDT",18,2>     | PIC S9(16)V99 COMP-3 | COMP-3  | 33     | 10     | 10    |
| 5     | STATEMENT.LINES-FLD            | record<LedgerEntry>[100] | GROUP                | GROUP   | 43     | 5600   | 5600  |
| 6     | STATEMENT.RELATIONSHIP-MANAGER | nullable<string<20>>     | PIC X(20)            | DISPLAY | 5643   | 22     | 22    |
| 7     | STATEMENT.IDEMPOTENCY-KEY      | string<36>               | PIC X(36)            | DISPLAY | 5665   | 36     | 36    |

## ACCOUNT-MASTER

Total length: 33

| Order | Path                      | Type                 | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | ------------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | ACCOUNT-MASTER.ACCOUNT-ID | string<16>           | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | ACCOUNT-MASTER.STATUS-FLD | enum<AccountStatus>  | PIC X(7)             | DISPLAY | 16     | 7      | 7     |
| 3     | ACCOUNT-MASTER.BALANCE    | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 23     | 10     | 10    |
