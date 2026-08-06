# IMS DL/I

Databases, segments, and the PCB list.

Part of the [BankTS language reference](../language-reference.md).

## IMS DL/I

```ts
record AccountSegment {
  acctId: string<10>;
  balance: decimal<9, 2>;
}

database accountDb pcb segment "ACCTSEG" key "ACCTID"
  record AccountSegment status dbStatus;

getUnique accountDb into segment key "0000000001";
getNext accountDb into segment;
getHoldUnique accountDb into segment key "0000000001";
getHoldNext accountDb into segment;
insertSegment accountDb from segment;
replaceSegment accountDb from segment;
deleteSegment accountDb;
```

An IMS program does not open a database or read it with file control. The region
hands it a **PCB**, and every operation is `CALL "CBLTDLI"` with a function code,
that PCB, a segment area, and — for a qualified read — a search argument:

```cobol
       PROCEDURE DIVISION USING IO-PCB ACCOUNT-DB-PCB.
           MOVE "0000000001" TO ACCOUNT-DB-SSA-VALUE
           CALL "CBLTDLI" USING DLI-GU, ACCOUNT-DB-PCB, ACCOUNT-SEGMENT,
               ACCOUNT-DB-SSA
           MOVE ACCOUNT-DB-PCB-STATUS TO DB-STATUS
```

**The I/O PCB comes first, always.** A batch program needs it to make system
service calls, so `CMPAT=YES` is what IBM says to specify — and with it the
region passes the I/O PCB ahead of every database PCB. Leaving it out does not
fail to compile: it shifts every database PCB by one, so the program reads the
I/O PCB as its first database and works on whatever that storage holds.

The segment and key names live on the declaration, because the search argument
is built from them once and each is eight bytes — what DL/I carries, and a
longer one is truncated into a name matching nothing in the DBD
(`BANK-DLI-001`).

Each call takes the search argument it needs, and they are not the same:

| Call                              | Argument                                 |
| --------------------------------- | ---------------------------------------- |
| `getUnique`, `getHoldUnique`      | qualified — segment, field, value        |
| `getNext`, `getHoldNext`          | unqualified — nine bytes of segment name |
| `insertSegment`                   | unqualified                              |
| `replaceSegment`, `deleteSegment` | none                                     |

An unqualified argument still matters. A `GN` without one returns the next
segment of **any** type in hierarchical order, not the one the database
declares, and an `ISRT` without one has nothing telling DL/I what to insert.
`REPL` and `DLET` take none because they act on the segment the get-hold held.

### Holding before updating

**DL/I will not update a segment the program has not held.** A `replaceSegment`
or `deleteSegment` after a plain `getUnique` comes back with status `DJ` and the
update does not happen — which the program only discovers if it tests the
status.

So read it with `getHoldUnique` or `getHoldNext` first, and the compiler
insists (`BANK-DLI-002`):

```ts
getHoldUnique accountDb into segment key accountId;
if dbStatus == "  " {
  segment.balance = segment.balance + amount;
  replaceSegment accountDb from segment;
}
```

A hold earlier in an enclosing block covers a branch inside it, because every
path through the branch has passed it. A hold _inside_ a branch does not travel
back out: the path that skipped the branch reaches the update unheld.

**The status field is required.** The two characters DL/I leaves in the PCB are
the entire error model — spaces worked, `GE` found nothing, `GB` reached the end
— so without somewhere to read them a `getUnique` that found nothing is
indistinguishable from one that worked, and the program uses whatever the
segment area held last. It reads like a file status:

```ts
getUnique accountDb into segment key accountId;
if dbStatus == "  " {
  ...
}
```

### What the local run establishes

The tests execute against [`runtime/CBLTDLI.cbl`](../../runtime/CBLTDLI.cbl), which
is **not IMS**: it evaluates no database, holds no segments, and maintains no
position. It puts a scripted status in the PCB so the branches can be reached.

That proves the program issues its calls in order with the right function codes,
and takes the branch its status test selects. It proves nothing about what IMS
would return. Same grade of evidence as Db2 and CICS already have here — see
[`runtime/README.md`](../../runtime/README.md).
