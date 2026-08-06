# CICS

Online transactions, the communication area, and response handling.

Part of the [BankTS language reference](../language-reference.md).

## CICS

An online transaction is declared with `cics`:

```ts
cics transaction accountEnquiry(request: EnquiryRequest, reply: EnquiryReply) {
  link "AUDITLOG" commarea reply resp linkResp;

  if linkResp == 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }
}
```

A CICS transaction receives input through `DFHCOMMAREA` in the `LINKAGE
SECTION` and ends with `EXEC CICS RETURN` rather than `GOBACK`.

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

`BANK-CICS-003` exists because a syncpoint inside a loop commits or discards
partial work on every iteration, which is rarely what a transaction means.
