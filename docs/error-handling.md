# Error handling

One page for every way a generated program can report that something went wrong,
and how `on failure` maps onto each. It was spread across four documents.

The rule underneath all of it: **a run that did not do what it was submitted to
do must not end the way one that did ends.** Every finding in the 2026-08-05
audit's P1 section was a violation of that single sentence.

---

## The return-code contract

A batch step ends with one of these, and the next step's `COND=` is written
against them.

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 0    | The work completed.                                                                           |
| 4    | The program set it deliberately with `returnCode = 4`. Nothing the compiler generates uses 4. |
| 8    | Likewise. Reserved for a program that wants a warning code.                                   |
| 12   | A failure the program named. `BANK-FAILURE-CODE` says which.                                  |
| 16   | A sort or merge did not complete. `SORT-RETURN` says so.                                      |

Under CICS none of it applies: `RETURN-CODE` is a batch step's answer to JCL and
nothing in a region reads it. A CICS program that has failed abends with code
`BLNG`, which is what backs out the unit of work.

### Two registers, not one

```cobol
       01  BANK-FAILURE-CODE    PIC X(32) EXTERNAL.
       01  BANK-RETURN-CODE     PIC S9(4) COMP EXTERNAL.
```

`RETURN-CODE` cannot hold the answer while the program is still running. The
Language Reference is explicit: "the RETURN-CODE special register in the calling
program is set to the value of the RETURN-CODE special register in the called
program", so every generated transaction, which ends by calling `BANKAUDT`,
used to hand the operating system the audit program's zero.

`BANK-RETURN-CODE` holds it and `BANK-MAIN` moves it out once, after everything
the program performs has returned.

`BANK-FAILURE-CODE` names the failure, so a job log says which of a dozen
guards fired. Both are `EXTERNAL` because a recursive or nested function is a
separate program rather than a paragraph, and a failure raised inside one has to
reach the caller.

### The one failure path

Every generated failure does the same three things, in the same order:

```cobol
               MOVE 12 TO BANK-RETURN-CODE
               MOVE "READ-FAILED" TO BANK-FAILURE-CODE
               GO TO POST-ACCOUNTS-EXIT
```

Set the code, name the failure, leave through the enclosing routine's exit.
Control returns to `BANK-MAIN`, which is the only paragraph that ends the
program. Where there is no enclosing routine (a file error declarative, an XML
handler section, both entered by the run time rather than performed)
`BANK-ABEND` is the paragraph it goes to instead.

Every call site tests the register afterwards:

```cobol
           PERFORM ACCRUE THRU ACCRUE-EXIT
           IF BANK-FAILURE-CODE NOT = SPACES
               GO TO POST-ACCOUNTS-EXIT
           END-IF
```

Not only after a call to something declared able to raise. An overflow, a failed
`READ` or a subscript outside its table is a failure the callee never declared,
and checking only declared raises is how one used to run on regardless.

---

## `on failure`

A transaction may declare a handler:

```
entry transaction postAccounts(account: Account) {
  on failure {
    audit("REJECTED", account.idempotencyKey);
  }
  ...
}
```

It compiles to the standard COBOL shape for a body with an early exit: a
wrapper that performs the body `THRU` its exit and then inspects the register:

```cobol
       POST-ACCOUNTS.
           MOVE SPACES TO BANK-FAILURE-CODE
           PERFORM POST-ACCOUNTS-BODY THRU POST-ACCOUNTS-BODY-EXIT
           IF BANK-FAILURE-CODE NOT = SPACES
               PERFORM POST-ACCOUNTS-FAILURE THRU POST-ACCOUNTS-FAILURE-EXIT
           END-IF
           CONTINUE.
```

Every failure reaches it, whatever raised it. A transaction that posted to the
ledger before failing gets a `"ROLLBK"` call to `BANKLEDG` ahead of the handler:
the postings already made are not this program's to keep, and unwinding them is
the ledger's job rather than compensating debits and credits of the compiler's
invention.

A transaction with **no** handler still fails the step. It says so in the job
log and ends 12, rather than the body stopping where it failed and the wrapper
returning success.

---

## File status

Every I/O statement's status is checked, not only `OPEN`. IBM's guidance is to
"check the file status key after each input or output request", and a `WRITE`
that filled the volume or a `CLOSE` that could not write its last buffer is
exactly the failure nobody investigates until a reconciliation months later.

The status field carries condition names:

```cobol
       01  ACCOUNT-INPUT-STATUS PIC X(2).
           88  ACCOUNT-INPUT-STATUS-OK  VALUE "00" THRU "09".
           88  ACCOUNT-INPUT-STATUS-EOF VALUE "10".
           88  ACCOUNT-INPUT-STATUS-DUPKEY VALUE "22".
           88  ACCOUNT-INPUT-STATUS-NOTFND VALUE "23".
```

`"00" THRU "09"` is IBM's successful-completion class. `"02"` is a duplicate
alternate key where duplicates are allowed, `"05"` is an OPTIONAL file created
on this run: a check written `NOT = "00"` stops a restartable batch on its
first night.

The statuses a given statement is _allowed_ to produce are its own. End of file
on a read and a key that was not there on a keyed read are questions answered
rather than files that failed, and the program branches on them:

```cobol
               IF NOT ACCOUNT-INPUT-STATUS-OK AND NOT ACCOUNT-INPUT-STATUS-EOF
                   DISPLAY "READ FAILED accountInput STATUS "
                       ACCOUNT-INPUT-STATUS UPON SYSOUT
                   MOVE 12 TO BANK-RETURN-CODE
                   ...
```

A file may also declare an error handler, which becomes a `USE AFTER STANDARD
ERROR PROCEDURE` in `DECLARATIVES`. That is entered by the run time rather than
performed, so a failure inside it goes to `BANK-ABEND`.

Declaring no status field at all is `BANK-FILE-001`.

---

## `SQLCODE`

`+100` is the only "not found". Negative is an error: `-911` is a deadlock the
thread lost, `-904` a resource that was not available, `-805` a package that was
never bound.

A body that runs SQL and never tests `SQLCODE` is `BANK-SQL-001`. A body that
tests it but cannot separate an error from `+100` is **`BANK-SQL-007`**,
because `if sqlcode == 0 { found } else { not found }` turns a deadlock into a
customer being told their account does not exist, and `sqlcode != 100` is no
better, putting `+100` and `-911` on the same side.

```
  if sqlcode < 0 {
    reply.outcome = EnquiryOutcome.UNAVAILABLE_DB;
  } else {
    if sqlcode == 0 { ... } else { ... }
  }
```

A cursor loop fails the step on a negative `SQLCODE` rather than merely leaving,
and closes the cursor on the way out so the failure does not hold locks. A loop
that stopped on its declared bound with `SQLCODE = 0` also fails: the result set
was not finished.

---

## CICS `RESP`

Every CICS command captures its response, and an unchecked one is
`BANK-CICS-001`.

The comparison is against the condition name, not a number:

```cobol
           IF LINK-RESP = DFHRESP(NORMAL)
```

The API Reference names one value a program may write (a normal return is
`DFHRESP(NORMAL)`), and says the rest are tested "by means of DFHRESP", the
translator's own built-in function. The numbers behind the other conditions
belong to the translator, so comparing against one is `BANK-CICS-004`.

A CICS transaction that has failed abends with `BLNG` from `BANK-MAIN`, which
backs out the unit of work. `EXEC CICS RETURN` is followed by `GOBACK`, as IBM's
own sample writes it: ending the task is something CICS does, not something
COBOL does.

A commarea shorter than the record is refused before anything reads it, with
abend code `BKNC`: IBM's guidance is to verify the length "matches what the
program expects", because a short one leaves the `MOVE` reading somebody else's
storage.

The commarea is written back on both paths, including the one where the
transaction failed and its `on failure` handler ran: a return code the handler
sets and the caller never sees leaves a failure looking like a success. And a
transaction that computes its answer into a record parameter that is not the
commarea is refused outright with `BANK-CICS-005`, because there is no path
from working storage back to a caller once the task has ended.

---

## MQ

Every MQI call returns a completion code and a reason code, and both are tested
and both are named in the message. Reporting one without the other leaves an
operator with either "it failed" or a number with no context.

An empty queue is not a failure: `MQRC-NO-MSG-AVAILABLE` (2033) is how a batch
finishes its work, and folding it in with the errors would stop the job every
night. Folding it in with success would process the message area again, still
holding the last message read.

---

## IMS DL/I

The two characters DL/I leaves in the PCB are the whole error model, which is
why the status field is required rather than optional: without it a `getUnique`
that found nothing is indistinguishable from one that worked.

---

## Loop bounds

Every loop carries one, and reaching it is a failure:

```cobol
           IF POST-ACCOUNTS-LOOP-1 >= 1000000 AND
               (ACCOUNT-INPUT-STATUS = "00")
               DISPLAY "LOOP LIMIT 1000000 REACHED, WORK UNFINISHED"
                   UPON SYSOUT
```

The condition is re-evaluated so the two exits are told apart exactly. A loop
that ended because its own condition went false is the ordinary end; the counter
at the limit while the condition still holds is the bound stopping work that had
not finished, which without this branch was a five-million-record master
processing the first million and ending RC=0.

---

## Arithmetic overflow

Any computation that can overflow carries `ON SIZE ERROR`. COBOL leaves the
receiving field alone when the phrase is present rather than storing the
truncated answer, which is what makes stopping safe: the wrong value never
reaches the ledger.

Without it, the digits truncated are the high-order ones, so an overflowing
addition does not produce a large wrong number that stands out, it produces a
plausible small one.

## Subscripts

See [for-mainframe-engineers.md](for-mainframe-engineers.md#why-the-bounds-guard-rather-than-ssrange).

---

## Related pages

- [diagnostics.md](diagnostics.md) (every diagnostic the compiler emits
- [numeric-model.md](numeric-model.md)) overflow, rounding and intermediate results
- [jcl-model.md](jcl-model.md): what `COND=` the generated job writes
