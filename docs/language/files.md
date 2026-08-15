# Files

File declarations, organisation, keys, and file status.

Part of the [BankTS language reference](../language-reference.md).

## File declarations

```ts
file accountInput sequential input record AccountRecord status accountInputStatus;
file postingOutput sequential output record PostingRecord status postingOutputStatus;
```

Rules:

- file status must be checked
- record type must map to a copybook-compatible layout
- generated COBOL must contain file-control and FD sections

The `status` clause names the field that receives the COBOL `FILE STATUS`
value. It is optional at parse time so that a missing status is reported as
`BANK-FILE-001` with a remediation hint rather than as a syntax error.

A file is declared `input`, `output`, or `update`. `update` opens I-O, which is
what a master file update needs: the same `OPEN` serves the read that finds a
record and the `rewrite` that puts it back.

An indexed file is declared `ACCESS MODE IS DYNAMIC`, not `RANDOM`, because it
is both read by key and browsed, and `RANDOM` allows only the first.

### Text files

```ts
file paymentFeed lineSequential input record PaymentLine status paymentFeedStatus;
```

`lineSequential` is a text file: records end at a newline rather than at a fixed
width. It is what an import from anything that is not a mainframe looks like (a
payment feed, a reconciliation extract, a file a counterparty sent), and
Enterprise COBOL 6.4 has it as `ORGANIZATION IS LINE SEQUENTIAL` for files in
the z/OS UNIX file system.

It carries three restrictions the other organisations do not, and all three are
the target's rather than this compiler's.

**Every field has to be printable.** Enterprise COBOL requires that records
"contain only USAGE DISPLAY and DISPLAY-1 items", and this is the one that
catches people, because BankTS's default is exactly what is forbidden:

```ts
record PaymentLine {
  payAccount: string<16>;
  payAmount: decimal<11, 2>;   // BANK-FILE-014
}
```

`decimal` is packed (two digits to a byte with a sign nibble), and written into
a text file it produces bytes that are neither the number nor readable text. The
`WRITE` succeeds and nothing says so until somebody opens the file. Declare the
number `zoned` if it can be negative, which emits the `SIGN IS TRAILING
SEPARATE` the target asks for, or `unsigned` if it cannot:

```ts
record PaymentLine {
  payAccount: string<16>;
  payAmount: zoned<11, 2>;
  payValueDate: date;
}
```

**It cannot be opened for update.** `input` and `output` only. A record's length
is fixed once written, so there is nothing to rewrite in place:
`BANK-FILE-013`. A text file is amended by reading it and writing a new one,
which is what a job that rebuilds an extract already does.

**There is no `delete` and no browse.** Both need a record the file can address,
and this organisation has neither an index nor a relative number.

Reading pads: a line shorter than the record is space-filled to the declared
width, and writing strips the trailing blanks again. So a record round-trips
through a text file unchanged only if its declared width matches what is in the
file: worth remembering when a feed's last field is variable.

The generated JCL allocates a z/OS UNIX path rather than a dataset, because that
is where these files live:

```jcl
//PAYMENTF DD PATH='/u/banklang/paymentf',
//            PATHOPTS=(ORDONLY)
```

Two differences between GnuCOBOL and the target are recorded in
[divergences](../divergences.md): D23 on a final record with no delimiter, and
D24 on what a blank numeric field does.

### Records that vary in length

```ts
file feed sequential output record FeedLine
  varying 10 to 80 length feedLength status feedStatus;
```

`RECORD IS VARYING IN SIZE`. A fixed-length file pads every record to the
longest one it might hold; for a feed whose records differ by hundreds of bytes
that is most of the dataset, and on tape it is most of the tape.

`length` names the field that says how much of the record is in use: set it
before a write, and a read fills it:

```ts
line.payload = "SHORTER ONE";
feedLength = textLength(line.payload);
write feed from line;
```

`textLength` pairs with it: it is what the field holds rather than how wide it
was declared, which is exactly the number a varying write needs.

A record written shorter than the declared minimum is not written: COBOL
rejects it and the file status says so, which is what the `status` field is for.

The bounds have to be a range, and the file has to be `sequential`: an indexed or
relative dataset addresses a record by key or by position, which a varying length
would move (`BANK-FILE-009`).

### File operations

```ts
open accountFeed;
read accountFeed into account;
write adviceOutput from advice;
close accountFeed;
```

The record variable's type must match the file's declared record type, or the
bytes would not line up; a mismatch is `BANK-FILE-002`. Reading an output file
or writing an input file is `BANK-FILE-001`.

A file's name folds to a DD name of eight characters, and the generated `SELECT`
reads `ASSIGN TO <DD>`. If a record or a field has that same COBOL name, both
Enterprise COBOL 6 and GnuCOBOL take the file name from _its contents_ instead:
the program compiles and the `OPEN` fails with status 35. `BANK-FILE-016`.

A `read` sets the status field to `"10"` at end of file, so a batch loop can
test it:

```ts
while accountFeedStatus == "00" limit 100000 {
  read accountFeed into account;
}
```

### Several record layouts on one file

```ts
record BillHeading { headingText: string<98>; }
record BillDetail  { billCustomer: string<5>; billTotal: edited<zoned<9,2>, "plain">; }

file bills lineSequential output record BillHeading, BillDetail status billsStatus;
```

COBOL's several `01` entries under one `FD`. They share a record area as long as
the longest of them, and each `write` names the layout it is writing:

```ts
write bills from heading;
write bills from detail;
```

The type chooses the variant, so a heading cannot reach a detail's fields and a
short layout writes its own length rather than the area's. It is what a report
file is: a heading line and detail lines are different shapes and always were.
2,812 of the 6,451 file descriptions in the X-COBOL corpus declare more than one
record, and 2,663 of those are opened `OUTPUT`.

**Output only** (`BANK-FILE-015`). A `write` names a layout; a `read` does not.
Which one arrived is decided by the data, and BankTS will not hand back a value
whose type is a guess. A file that is read declares one record, and a feed
carrying several kinds is read as one layout with a field saying which kind it
is. The same rule covers a record key and a `varying` length, each of which
describes one layout rather than a choice between several.

The read side is measured rather than assumed. 143 of the corpus's file
descriptions carry several records and are opened `INPUT`, and those 143 are 51
distinct file contents: 21 parser, grammar, language-server and compiler-test
fixtures, 16 copies of the NIST CCVS85 conformance suite, and 14 textbook and
course programs. No application in 5,195 files reads a file this way. Eleven of
the fourteen are the same shape (a record code in the leading field, named by
`88` levels), so if that changes, what it would need is a typed variant with
narrowing the compiler checks, not the `redefines` above.

### The outcome of an operation has to be looked at

```ts
read accountFeed into account;
if accountFeedStatus == "00" {
  post(account);
}
```

End of file (`10`), no such record (`23`) and a duplicate key (`22`) are not
failures: they are answers, and the generated check lets them through for the
program to decide about. A program that does not decide carries on with the
record area still holding the record before it. A read past the end of a feed
posts the last transaction twice, with a return code of zero.

So an operation that can end with one of those statuses leaves an outcome the
program owes an answer to, and `BANK-FILE-017` is raised when it uses the record
that operation filled, operates on the file again, or reaches the end of the
routine without comparing the status. A `close` counts as operating on the file:
it sets the status too, so a test written after one reads the close's answer.

The comparison counts wherever it is written (in an `if`, in a loop condition,
into a local), so the drain loop above stays exactly as it was. A `log` of the
status does not count: printing the answer is not reading it.

_Using_ the record covers every way a program can read it, not only reading a
field out of it. COBOL hands whole records to things by naming them, and
`write trail from line`, `release line`, `putMessage feedQueue from line`,
`call "BANKSUB" using line` and `json out from line` are each the stale record
going somewhere. A statement that _fills_ it (a second `read into` it, a queue
`getMessage into` it) is not a use: replacing the bytes is the fix.

The rule reaches into every block a statement runs, the `on page` block of a
write and a sort procedure's body included. A transaction's `on failure`
handler and a file's `on error` handler are each checked as a routine of their
own, because control reaches them from anywhere: nothing the body owed is known
there, and an operation the handler itself performs owes the same answer.

### What the compiler checks for you

Every I/O statement is followed by a generated test of the file status **key**:
the first character, since class 0 is successful completion and includes `02`,
`04`, `05` and `07`, not only `00`. A status outside class 0 names the operation,
the file and the status in the job log, sets a return code of 12, and stops.

The statuses a statement is written to produce are left to the program: end of
file on a read, a key that was not there on a keyed read or a browse, a
duplicate key on a write to a KSDS. Those say the request found nothing, not
that the file failed, so the loop above still ends the way it always did.

This matters most where nothing else would notice. A `write` that cannot happen
(the volume full, a `varying` record outside its declared length) leaves the
loop running and the output file short, and the job ends with a return code of
zero. Inside a sort's input or output procedure the same failure sets
`SORT-RETURN` to 16 instead, because control may not leave a sort procedure
while the sort is running.

Read and write map the record **field by field** rather than moving it as a
group, so the correspondence between the file record and working storage is
explicit in the generated COBOL and does not depend on the two layouts being
byte-identical. An array field is copied element by element, because COBOL
rejects a move of an `OCCURS` item without a subscript.

The `FD` record is emitted as an unstructured buffer sized from the copybook
layout, and the structured record is declared once in working storage. Emitting
the record inside each `FD` as well would duplicate field names and make every
unqualified reference ambiguous.

### Alternate keys

```ts
file accountMaster indexed input record Account
  key accountId alternate customerId, branchId status masterStatus;
```

A KSDS is read by its primary key and browsed by any of its alternates. A
program that can only name the primary cannot open a file whose alternate index
is the whole reason it exists: an account file read by customer, say.

Each alternate is declared `WITH DUPLICATES`, because many accounts per customer
is nearly always why one exists. Only an indexed file has them
(`BANK-FILE-004`).

### When an operation fails anyway

```ts
on error accountInput {
  log "FILE ERROR ", inStatus;
  returnCode = 12;
}
```

A file status check covers the statement that thought to look. This covers the
ones that did not: COBOL runs a `USE AFTER STANDARD ERROR` procedure when any
operation on that file fails, wherever it was written. That is what makes
`DECLARATIVES` the standard error path rather than a convenience.

The handler is declared at the top level, not inside a transaction, because it
is not reached from one. It runs when the failure happens. It sees the file
statuses and nothing else: there is no record in scope and no ledger to post to.

A file may have one handler (`BANK-FILE-005`), which is what COBOL allows. When
any handler exists, the program's own paragraphs move into a `BANK-BODY SECTION`,
because everything after `DECLARATIVES` has to be in a section.

### Browsing an indexed file

```ts
start accountMaster key master.accountId;   // position at or after the key
readNext accountMaster into master;         // walk from there
```

`START` uses `KEY IS NOT LESS THAN`, which begins at the first record at or
after the key, what a range walk wants. An exact match would make a browse from
a partial key impossible.

`readNext` reports end of data through the file status, the way a sequential
read does, because a browse runs out rather than failing.

### Updating in place

```ts
read accountMaster into master key master.accountId;
master.balance = master.balance + amount;
rewrite accountMaster from master;

delete accountMaster key master.accountId;
```

`rewrite` and `delete` need the file open for `update`, because updating a
record in place means finding it first (`BANK-FILE-005`). `start` and `readNext`
need an `indexed` file, because there is no index to walk otherwise. A `write`
or `rewrite` to an indexed file captures `INVALID KEY` in the file status: a
duplicate key is the failure a KSDS write actually has, and it is silent
otherwise.
