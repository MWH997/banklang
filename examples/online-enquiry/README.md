# Online Enquiry Example

A CICS online transaction that reads an account from Db2 and links to an audit
program — the shape most real bank enquiry logic actually takes.

## What it demonstrates

| Feature              | Where                                                 |
| -------------------- | ----------------------------------------------------- |
| Db2 declaration      | `sql fetchAccount(...): AccountRow { SELECT ... }`    |
| Host variables       | `:keyAccountId` in, `:rowBalance` out                 |
| SQLCODE handling     | `if sqlcode == 0 { ... }`, required by `BANK-SQL-001` |
| CICS transaction     | `cics transaction accountEnquiry(...)`                |
| COMMAREA             | `DFHCOMMAREA` in the `LINKAGE SECTION`                |
| CICS LINK            | `link "AUDITLOG" commarea reply resp linkResp;`       |
| Syncpoint / rollback | Committed only when the link succeeded                |
| Currency and enums   | `BDT` amounts, `EnquiryOutcome` result                |

## SQL is declared, not assembled

BankLang does not parse SQL. It resolves the `:hostVariable` references against
the declared parameters and result record, rewrites them to COBOL names, and
emits the statement verbatim:

```cobol
           MOVE ACCOUNT-ID OF ENQUIRY-REQUEST TO FETCH-ACCOUNT-H1
           EXEC SQL
               SELECT ACCOUNT_ID, BALANCE, STATUS
               INTO :ROW-ACCOUNT-ID OF ACCOUNT-ROW, ...
               FROM ACCOUNT
               WHERE ACCOUNT_ID = :FETCH-ACCOUNT-H1
           END-EXEC
```

Parameters bind to dedicated host-variable storage; result fields bind into the
target record. A name that matches both is `BANK-SQL-003`, because the generated
statement would otherwise silently pick one.

## Every outcome is checked

Two rules make the failure paths impossible to skip:

- `BANK-SQL-001` — a body that runs SQL must test `sqlcode`. A row that was not
  found otherwise looks identical to one that was.
- `BANK-CICS-001` — every CICS command must capture `resp`. A failed `LINK`
  otherwise looks like a successful one.

```cobol
           EXEC CICS LINK PROGRAM("AUDITLOG") COMMAREA(ENQUIRY-REPLY) RESP(LINK-RESP) END-EXEC
           IF LINK-RESP = 0
               EXEC CICS SYNCPOINT RESP(COMMIT-RESP) END-EXEC
           ELSE
               EXEC CICS SYNCPOINT ROLLBACK RESP(ROLLBACK-RESP) END-EXEC
           END-IF
```

## This program is not locally validated

**Embedded SQL needs the Db2 precompiler and CICS commands need the CICS
translator.** Plain GnuCOBOL rejects both, so this example is the one program in
the repository that is _not_ compiler-checked, and the audit trail says so:

```txt
| compiler-status         | requires-preprocessor |
| validated-with-gnucobol | no                    |
```

`bankc test` reports this rather than recording a pass, and the compile lane in
the test suite reports it instead of skipping silently. The diagnostics are
still enforced: the compiler checks host variables, SQLCODE handling, response
codes, and syncpoint placement without needing a precompiler.

## Running it

```bash
pnpm bankc check examples/online-enquiry
pnpm bankc test  examples/online-enquiry
```

## Notes

No IBM Db2, CICS, or Enterprise COBOL validation has been performed, and none is
claimed. The generated `EXEC SQL` and `EXEC CICS` blocks follow IBM's documented
syntax but have never been precompiled, translated, or run.
