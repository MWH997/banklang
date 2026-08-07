# Online Enquiry Example

A CICS online transaction that reads an account from Db2 and links to an audit
program — the shape most real bank enquiry logic actually takes.

## What it demonstrates

| Feature              | Where                                                     |
| -------------------- | --------------------------------------------------------- |
| Db2 declaration      | `sql fetchAccount(...): AccountBalanceRow { SELECT ... }` |
| Host variables       | `:keyAccountId` in, `:rowBalance` out                     |
| SQLCODE handling     | `if sqlcode == 0 { ... }`, required by `BANK-SQL-001`     |
| CICS transaction     | `cics transaction accountEnquiry(...)`                    |
| COMMAREA             | `enquiry: EnquiryCommarea`, in and back out               |
| CICS LINK            | `link "AUDITLOG" commarea auditEntry resp linkResp;`      |
| Syncpoint / rollback | Committed only when the link succeeded                    |
| Currency and enums   | `BDT` amounts, `EnquiryOutcome` result                    |

## The answer goes back through the commarea

CICS gives a program one communication area, not one in and one out.
`DFHCOMMAREA` is the caller's own storage, so the request fields and the reply
fields are the same block — and the first record parameter of a
`cics transaction` is that block:

```cobol
           MOVE DFHCOMMAREA TO ENQUIRY-COMMAREA
           ...
           MOVE ENQUIRY-COMMAREA TO DFHCOMMAREA
```

Which is why `caBalance` and `caOutcome` are fields of `EnquiryCommarea` rather
than of a reply record of their own. A reply record would be working storage,
and working storage is gone when the task ends: the transaction would compute
the right balance, return control, and hand the caller back the bytes it was
sent. `BANK-CICS-005` refuses that program.

`AuditEntry` is working storage and is meant to be. It leaves through the
`link`, not through the commarea, and the transaction writes to the commarea as
well — which is what tells `BANK-CICS-005` apart from a program with a
legitimate scratch record.

## SQL is declared, not assembled

BankLang does not parse SQL. It resolves the `:hostVariable` references against
the declared parameters and result record, rewrites them to COBOL names, and
emits the statement verbatim:

```cobol
           MOVE CA-ACCOUNT-ID OF ENQUIRY-COMMAREA TO FETCH-ACCOUNT-H1
           EXEC SQL
               SELECT ACCOUNT_ID, BALANCE, STATUS
               INTO :ROW-ACCOUNT-ID OF ACCOUNT-BALANCE-ROW, ...
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
           EXEC CICS LINK PROGRAM("AUDITLOG") COMMAREA(AUDIT-ENTRY) RESP(LINK-RESP) END-EXEC
           IF LINK-RESP = 0
               EXEC CICS SYNCPOINT RESP(COMMIT-RESP) END-EXEC
           ELSE
               EXEC CICS SYNCPOINT ROLLBACK RESP(ROLLBACK-RESP) END-EXEC
           END-IF
```

## Both branches are executed, not just emitted

**Embedded SQL needs the Db2 precompiler and CICS commands need the CICS
translator**, so plain GnuCOBOL rejects this program as written. BankLang's own
precompiler performs the equivalent translation first, and the audit trail
records that it did:

```txt
| compiler-status         | passed |
| validated-with-gnucobol | yes    |
```

`tests/conformance.test.ts` goes further and runs it against the reference
runtime, scripting what the runtime reports so the branch each test guards is
actually taken:

| Scripted               | Executed result                                   |
| ---------------------- | ------------------------------------------------- |
| nothing                | `CICS 0002 SYNCPOINT RESP 0` — the link committed |
| `PGMIDERR` on the link | `CICS 0002 SYNCPOINT ROLLBACK RESP 0`             |

That is what the `RESP` plumbing is for: the translator copies `EIBRESP` into
`linkResp` after the call, because CICS returns a response in the EXEC interface
block rather than in an operand.

## Running it

```bash
pnpm bankc check examples/online-enquiry
pnpm bankc test  examples/online-enquiry
```

## Notes

No IBM Db2, CICS, or Enterprise COBOL validation has been performed, and none is
claimed. The generated `EXEC SQL` and `EXEC CICS` blocks follow IBM's documented
syntax but have never been precompiled by `DSNHPC`, translated by the CICS
translator, or run in a region. Every `SQLCODE` and `RESP` above was written down
by a test: it says what this program does with that outcome, not that Db2 or CICS
would produce it.

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=online-enquiry) — it compiles in your browser, with the generated COBOL beside it.
