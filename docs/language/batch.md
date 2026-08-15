# Batch operations

The PARM, sorting, procedures on the way through, and surviving a failure.

Part of the [BankTS language reference](../language-reference.md).

## Batch operations

```ts
returnCode = 4;
```

The step's condition code, which lands in COBOL's `RETURN-CODE` and reaches the
job as the value the next step's `COND=` tests. Without it every step reports
success, and a job that found no records looks exactly like one that processed a
million. Conventionally 0 ran clean, 4 warned, 8 failed, 12 or more is fatal.

It must be a whole number in 0–4095, which is what `RETURN-CODE` holds.

### Talking to the job

```ts
accept parameter into run.mode;      // ACCEPT ... FROM SYSIN
accept date into run.runDate;        // ACCEPT ... FROM DATE YYYYMMDD
accept time into run.startedAt;      // ACCEPT ... FROM TIME
log "STARTED ", run.mode;            // DISPLAY ... UPON SYSOUT
reset summary;                       // INITIALIZE
```

The job log is the operator's only view of what happened between the return code
and an abend, and a job parameter is how the same program runs a different
cycle. `UPON SYSOUT` puts the message in the job's output rather than wherever
the runtime defaults to, and `FROM DATE YYYYMMDD` gives the four-digit year the
unqualified form does not.

A restricted value may not be written to the log (`BANK-AUD-002`), for the same
reason it may not reach an audit event: the log outlives the run and is read
widely.

`reset` clears a whole record: alphanumerics to spaces, numerics to zero.
Clearing it field by field is the same thing written out, and drifts the moment
the record gains a field.

### Handing a record to something outside

```ts
json message.body from account count message.length on error {
  returnCode = 12;
};

xml message.body from account count message.length;
```

`JSON GENERATE` and `XML GENERATE`. A batch that has to hand a record to a
queue, a gateway, or a file a distributed system reads otherwise builds the text
by hand with `STRING`, which is where the quoting and the escaping go wrong.

COBOL builds the document from the group's own field names, so nothing here
describes the shape: **the record is the schema**:

```
{"ACCOUNT":{"ACCOUNT-ID":"12345678","BALANCE":1234.56}}
<ACCOUNT><ACCOUNT-ID>12345678</ACCOUNT-ID><BALANCE>1234.56</BALANCE></ACCOUNT>
```

The target is a fixed COBOL field and the compiler space-fills whatever the
document does not reach, which is why `count` matters: it is the only way the
caller can tell the text from the padding when it comes to write it out. Both
`count` and `on error` are optional, and `from` and `count` stay usable as field
names.

The target must be `string<n>` (not `national<n>`, whose two bytes to a
character is not what `JSON GENERATE` writes) the source must be a record, and
the count must be a whole number.

**A record carrying a `sensitive` field cannot be generated** (`BANK-AUD-002`).
Serialised text is data on its way out of the program, so this is the same
escape the rule already covers for an audit event and a log line. Copy the
fields that may leave into a record without them; a masked value derived through
a function is the declassification point.

#### Reading one back

```ts
json message.body into account on error {
  returnCode = 12;
};
```

`JSON PARSE`. The same statement with the direction reversed: `from` writes the
document out of a record, `into` reads one back in. There is no `count`, because
the document says where it ends.

A record carrying a `sensitive` field is fine here, unlike when generating.
Restricted data arriving from outside and landing in a field marked for it is
the marking working, not an escape.

**It carries a warning** (`BANK-TYPE-025`). Enterprise COBOL implements
`JSON PARSE`; GnuCOBOL 3.2.0 compiles it, warns that it is not implemented, and
then does nothing at run time. The record is left untouched and no exception is
raised, so a program reading a payload runs clean and processes an empty record.

The local build no longer runs that. The precompiler rewrites the statement into
one call on `BANKJSON` per item of the record (the same routing `EXEC SQL` and
`EXEC CICS` have), so the record is populated from the document and the
`JSON-STATUS` test reports a document that did not fill it, with IBM's own reason
code 1. What ships to z/OS keeps its `JSON PARSE`.

The warning stays because `BANKJSON` is a scan and not IBM's parser: it reads a
quoted name at the top level and the scalar after its colon, and nesting, arrays
and escape sequences are past what a stub should pretend to. Verify on z/OS
before relying on what a real document reads as.

#### Reading XML

XML is different, and not by choice: `XML PARSE` is event-driven in Enterprise
COBOL and in GnuCOBOL alike. COBOL calls a procedure once per token of the
document (a start tag, its content, an end tag), and the procedure works out
what to keep by reading the `XML-EVENT` and `XML-TEXT` special registers. There
is no form that fills a record, so there is no `xml ... into ...`
(`BANK-TYPE-026`).

What there is says which elements go where:

```ts
xml message.body processing {
  element "ID" into account.accountId;
  element "BAL" into account.balance;
} on error {
  returnCode = 12;
};
```

and the compiler writes the state machine:

```cobol
       XML PARSE BODY OF MESSAGE-FLD
           PROCESSING PROCEDURE BANK-XML-1
           ON EXCEPTION
               MOVE 12 TO RETURN-CODE
       END-XML
...
       BANK-XML-1 SECTION.
           EVALUATE XML-EVENT
             WHEN "START-OF-ELEMENT"
               MOVE XML-TEXT TO BANK-XML-1-ELEM
             WHEN "CONTENT-CHARACTERS"
               EVALUATE BANK-XML-1-ELEM
                 WHEN "ID"
                   MOVE XML-TEXT TO ACCOUNT-ID OF ACCOUNT
                 WHEN "BAL"
                   COMPUTE BALANCE OF ACCOUNT = FUNCTION NUMVAL(XML-TEXT)
               END-EVALUATE
             WHEN "END-OF-ELEMENT"
               MOVE SPACES TO BANK-XML-1-ELEM
           END-EVALUATE.
```

Three things there are worth pointing at, because they are where a hand-written
handler goes wrong. The element a start tag opened has to be **remembered**,
since its content arrives as a separate event. It has to be **forgotten** at the
end tag, or a parent's whitespace is filed under the child that just closed. And
a number has to go through `NUMVAL` rather than `MOVE`: moving characters into a
numeric picture reads the digits positionally and puts the decimal point
somewhere else.

The handler is a section placed after the last `GOBACK`, because a section in
the flow of control would be run again on the way past.

Bindings must name at least one element, must not bind one twice, and must read
into a `string<n>` or a number: COBOL hands the content over as characters.

**The same warning applies** (`BANK-TYPE-025`). GnuCOBOL compiles all of this,
including the special registers, warns that `XML PARSE` is not implemented, and
then does nothing: no field is filled, and neither the exception nor the
not-exception branch is taken, so a document that failed looks exactly like one
that worked.

The precompiler rewrites the statement into the loop it is (`BANKXML` returns
one event per call and the generated handler is `PERFORM`ed for each), so the
local build enters the handler, takes the branch the document asks for, and
fills the fields. The registers cannot come along: GnuCOBOL reserves `XML-TEXT`
but only a real `XML PARSE` sets it, and a `MOVE` to it ends the run with a
segmentation fault, so the handler is pointed at fields of the translator's own.
The artifact keeps the registers, because on z/OS they are the ones IBM fills in.

`BANKXML` is not an XML parser: attributes, namespaces, entity references and
CDATA are past what a stub should pretend to. The rest waits for z/OS.

### Ordering the input

```ts
sort rawPostings into sortedPostings on branchId, descending accountId;
merge morningFile, eveningFile into dayFile on accountId;
```

An internal `SORT` is what a program uses when the ordering is its own business
rather than the job's. It runs through a sort-work file, described by `SD`
rather than `FD` because the sort owns its blocking. `USING` and `GIVING` let the
sort open, read, write, and close the files itself: the form to use when there
is nothing to do to the records on the way through.

The `SD` gets a `SELECT ... ASSIGN TO SORTWORK`, and that name is
**documentation**: COBOL requires the clause and then ignores the name, which is
why IBM's own example assigns two `SD` files to the same one. Nothing is
allocated for it and no DD answers to it. It is deliberately not `SORTWK01`.
that is the DD the sort product reads for its first _work dataset_, which the
generated job does allocate, along with `SORTWK02` and `SORTWK03`. Naming the
`SD` after it would read as though the two were connected.

A `MERGE` gets no work datasets. Its inputs already arrive in order, so there is
nothing to spill to disk.

Every file a sort touches holds the same record, and every key is a field of it:
a key that is not in the record sorts on nothing (`BANK-FILE-005`). A `merge`
takes two or more already-sorted inputs.

### Working on the records on the way through

```ts
sort rawPostings into sortedPostings on branchId, descending accountId
  input posting {
    if posting.amount > 0.00 {
      release posting;
    }
  }
  output posting {
    write sortedPostings from posting;
  };
```

A procedure replaces the clause it stands in for: `input` replaces `USING`,
`output` replaces `GIVING`. They are alternatives, not additions: the sort
either handles the file itself or leaves it to the program. Either may be given
alone.

The record named after `input` or `output` is an ordinary record variable, the
same way `read <file> into <record>` names one, so the body reads and assigns
fields exactly as the rest of the program does. Only the loop is generated: the
`OPEN`, the `READ` or `RETURN`, the end-of-data test, and the `CLOSE`.
Hand-writing those is where this shape is usually got wrong: a `RETURN` whose
`AT END` is forgotten reads the last record forever.

`release` is the statement an input procedure exists for. The records it does
not release are the ones the procedure filters out. It only means anything while
a sort is running, so writing it anywhere else is `BANK-FILE-006`, as is an
input procedure that never reaches one: that sorts an empty file, and there is
no reading of the program under which it is what was meant.

A `merge` takes no input procedure (`BANK-FILE-006`). Its premise is that the
inputs already arrive in order, and a procedure that could drop or reorder
records would break it. An output procedure on a merge is fine.

The procedures are emitted as `SECTION`s after the last `GOBACK`, because a
section in the flow of control would be run again on the way past; an
`INPUT PROCEDURE` is meant to be entered by `SORT` and by nothing else.

### Surviving a failure

```ts
file restartFile indexed update record RestartPoint key jobName status restartStatus;

restartPoint.jobName = "POSTBAT";

restart restartFile into restartPoint {
  log "RESUMING AFTER ", restartPoint.lastAccountId;
} else {
  log "NOTHING TO RESUME";
}

while ... {
  ...
  restartPoint.lastAccountId = posting.accountId;
  checkpoint restartFile from restartPoint every 1000;
}
```

A job that dies halfway is rerun. Without a position written down, the rerun
starts at the beginning and posts everything twice. `checkpoint` writes that
position and, in a program with SQL, commits the work up to it: position first,
commit after, so a restart that finds a position can trust everything up to it
is durable.

Counting rather than checkpointing every record is the whole trade: a commit
costs time, and rework after a failure costs the records since the last one.

`restart` is the other half, and without it the first half is decoration: a
position nothing reads back leaves the rerun starting at the beginning exactly
as it would with no checkpoint at all. It is a keyed read of the restart record.
The key field of the record has to hold the key being looked for before the
statement runs, the same way a keyed `read` works. The first branch is taken
when a position was found, with the record holding it; the `else` branch when
there was none. `else` is optional, because a fresh start often needs nothing
done.

The restart file must be **`indexed update`** (`BANK-FILE-003`). A sequential
output file is rewritten from the start by the next `OPEN`, so a rerun that dies
before its own first checkpoint destroys the position it was resuming from and
the run after that starts from the beginning: the failure the whole mechanism
exists to prevent. One keyed record, rewritten in place by each checkpoint, has
no such window, and it is what a restart control record on z/OS conventionally
is: a small KSDS holding the last committed position.

**Inside a cursor loop, the checkpoint's commit closes the cursor.** Db2 closes
a cursor that is not declared `WITH HOLD` when the unit of work commits, so a
loop that checkpoints over an unheld cursor fetches `-501` on the next row,
having already posted and committed part of the result set. `BANK-SQL-008`
refuses it, and the fix is `hold` on the declaration; see
[the SQL page](sql.md#a-cursor-that-survives-a-commit).

A restart file is generated with `SELECT OPTIONAL`, because the first run of a
batch has never written a position and the dataset does not exist yet. Every
other file stays required, and a missing one still stops the job.

A transaction that posts to the ledger **inside a loop** without both halves is
`BANK-FILE-003`. It is a **warning**, not an error: the compiler can see the
hazard but cannot tell whether the job is rerunnable another way, a consumed
and recreated input, a small enough window, an operator procedure. It reports
what it can see and leaves the judgement where the knowledge is. A single
posting outside a loop is not flagged; rerunning that is the caller's problem,
and the idempotency key covers it.
