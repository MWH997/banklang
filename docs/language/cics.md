# CICS

Online transactions, the communication area, and response handling.

Part of the [BankTS language reference](../language-reference.md).

## CICS

An online transaction is declared with `cics`:

```ts
cics transaction accountEnquiry(enquiry: EnquiryCommarea, audit: AuditEntry) {
  enquiry.caBalance = 0.00;
  enquiry.caReturnCode = "00";

  link "AUDITLOG" commarea audit resp linkResp;

  if linkResp == 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }
}
```

A CICS transaction receives input through `DFHCOMMAREA` in the `LINKAGE
SECTION` and ends with `EXEC CICS RETURN` rather than `GOBACK`.

**The commarea is the first record parameter, and it is how the transaction
answers.** CICS gives a program one communication area, not one in and one out:
`DFHCOMMAREA` is the caller's own storage, so the request fields and the reply
fields are the same block. The generated program moves it in on entry and back
out before it returns:

```cobol
           IF EIBCALEN < LENGTH OF DFHCOMMAREA
               EXEC CICS ABEND ABCODE("BKNC") END-EXEC
           END-IF
           MOVE DFHCOMMAREA TO ENQUIRY-COMMAREA
           ...
           MOVE ENQUIRY-COMMAREA TO DFHCOMMAREA
```

Every other record parameter is working storage, and working storage is gone
when the task ends. A transaction that computes its answer into a second record
named something like `reply` returns control having changed nothing the caller
can see: it hands back the bytes it was sent. `BANK-CICS-005` refuses it. The
`EIBCALEN` test is IBM's rule rather than a nicety: reading a commarea the
caller did not pass, or one shorter than the record expects, reads storage
belonging to something else and reads clean.

A transaction ending in `returnTransid` is the exception. That command carries
its own commarea to the next half of the pseudo-conversation, so the compiler
appends no writeback and `BANK-CICS-005` does not apply.

Beyond `link`, `syncpoint`, and `rollback`:

```ts
readFile    "ACCTFILE" into row  key request.accountId resp readResp;
writeFile   "ACCTFILE" from row  key request.accountId resp writeResp;
rewriteFile "ACCTFILE" from row  resp writeResp;

writeQueue "ENQLOG" from row resp writeResp;
readQueue  "ENQLOG" into row resp readResp;

returnTransid "ENQ2" commarea request;
```

A CICS file command reaches a VSAM dataset through the region rather than
through COBOL file control: there is no `open`, no `close`, and no FD, because
CICS owns the dataset and the program only asks. A read or write names the key
it addresses; a rewrite does not, because it updates the record the preceding
read is holding and naming a key would describe a different operation.

Temporary storage is the scratchpad an online transaction passes state through.
A queue command is ordinary work rather than a commit boundary, so unlike a
syncpoint it is allowed inside a loop.

`returnTransid` ends the task naming what runs next, which is how a
pseudo-conversation continues: CICS frees the program between the halves and
starts the named transaction when the terminal replies. It takes no `resp`,
because there is no response to come back to, and the compiler does not append a
second `EXEC CICS RETURN` after one.

**Not yet available:** BMS `SEND`/`RECEIVE MAP`, `START`/`RETRIEVE`, channels
and containers, and `HANDLE ABEND`.

| Rule                                                  | Diagnostic      |
| ----------------------------------------------------- | --------------- |
| Every command but `returnTransid` must capture `resp` | `BANK-CICS-001` |
| CICS commands need a `cics transaction`               | `BANK-CICS-002` |
| No syncpoint or rollback inside a loop                | `BANK-CICS-003` |
| A response is compared against a named value          | `BANK-CICS-004` |
| A computed result must reach the commarea             | `BANK-CICS-005` |

`BANK-CICS-003` exists because a syncpoint inside a loop commits or discards
partial work on every iteration, which is rarely what a transaction means.
