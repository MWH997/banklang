# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/dist/audit/copybook-layout.md

## LEDGER-ENTRY

Total length: 56

| Order | Path                    | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ----------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | LEDGER-ENTRY.ENTRY-KIND | enum<EntryKind>      | PIC X(6)             | DISPLAY | 0      | 6      | 6     | no        |
| 2     | LEDGER-ENTRY.NARRATIVE  | string<40>           | PIC X(40)            | DISPLAY | 6      | 40     | 40    | no        |
| 3     | LEDGER-ENTRY.AMOUNT     | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 46     | 10     | 10    | no        |

## STATEMENT

Total length: 5761

| Order | Path                           | Type                     | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ------------------------------ | ------------------------ | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | STATEMENT.ACCOUNT-ID           | string<16>               | PIC X(16)            | DISPLAY | 0      | 16     | 16    | no        |
| 2     | STATEMENT.HOLDER-NAME          | string<40>               | PIC X(40)            | DISPLAY | 16     | 40     | 40    | yes       |
| 3     | STATEMENT.NATIONAL-ID          | string<20>               | PIC X(20)            | DISPLAY | 56     | 20     | 20    | yes       |
| 4     | STATEMENT.STATUS-FLD           | enum<AccountStatus>      | PIC X(7)             | DISPLAY | 76     | 7      | 7     | no        |
| 5     | STATEMENT.OPENING-BALANCE      | currency<"BDT",18,2>     | PIC S9(16)V99 COMP-3 | COMP-3  | 83     | 10     | 10    | no        |
| 6     | STATEMENT.CLOSING-BALANCE      | currency<"BDT",18,2>     | PIC S9(16)V99 COMP-3 | COMP-3  | 93     | 10     | 10    | no        |
| 7     | STATEMENT.LINES-FLD            | record<LedgerEntry>[100] | GROUP                | GROUP   | 103    | 5600   | 5600  | no        |
| 8     | STATEMENT.RELATIONSHIP-MANAGER | nullable<string<20>>     | PIC X(20)            | DISPLAY | 5703   | 22     | 22    | no        |
| 9     | STATEMENT.IDEMPOTENCY-KEY      | string<36>               | PIC X(36)            | DISPLAY | 5725   | 36     | 36    | no        |

## ACCOUNT-MASTER

Total length: 33

| Order | Path                      | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ------------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ACCOUNT-MASTER.ACCOUNT-ID | string<16>           | PIC X(16)            | DISPLAY | 0      | 16     | 16    | no        |
| 2     | ACCOUNT-MASTER.STATUS-FLD | enum<AccountStatus>  | PIC X(7)             | DISPLAY | 16     | 7      | 7     | no        |
| 3     | ACCOUNT-MASTER.BALANCE    | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 23     | 10     | 10    | no        |
