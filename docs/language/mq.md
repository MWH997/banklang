# IBM MQ

Queues, messages, and syncpoint.

Part of the [BankTS language reference](../language-reference.md).

## IBM MQ

```ts
record Payment {
  accountId: string<16>;
  amount: decimal<15, 2>;
  idempotencyKey: string<36>;
}

queue paymentOut manager "CSQ1" name "PAYMENT.OUT" output
  record Payment status outReason;
queue paymentIn manager "CSQ1" name "PAYMENT.IN" input
  record Payment status inReason;

connectQueue paymentIn;
getMessage paymentIn into payment {
  putMessage paymentOut from payment;
} else {
  log "NOTHING TO DO";
};
disconnectQueue paymentIn;
```

A queue is not a file, and nothing about it goes through file control. The
program connects to a **queue manager**, opens the queue as an _object_
described by an MQOD, and every operation is a `CALL` with a completion code and
a reason code coming back:

```cobol
       01  PAYMENT-OUT-MQOD.
           COPY CMQODV.
           ...
           CALL "MQOPEN" USING PAYMENT-OUT-HCONN, MQOD OF PAYMENT-OUT-MQOD,
               PAYMENT-OUT-OPTIONS, PAYMENT-OUT-HOBJ,
               PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON
```

The manager and queue names live on the declaration because they go into the
object descriptor once, and each is 48 characters — `MQ_Q_MGR_NAME_LENGTH` and
`MQ_Q_NAME_LENGTH` are both that, which is what `MQOD-OBJECTNAME` and `MQCONN`'s
first parameter are declared as. A longer one is truncated into a name the queue
manager has never heard of (`BANK-MQ-001`).

**`connectQueue` is `MQCONN` then `MQOPEN`, and `disconnectQueue` is `MQCLOSE`
then `MQDISC`.** Neither half is useful alone: a connection with nothing open
does no work, an open object with no connection cannot exist. Emitting them as
one statement each removes the two orderings that are wrong and the ending that
leaves a handle behind.

**Every structure is copied into a group of its own.** `CMQODV` declares
`10 MQOD.` with `15 MQOD-...` beneath it, and the other copybooks do the same, so
a program with two queues has two of every one of those names and each reference
has to be qualified. IBM's own samples copy each structure once and reference it
bare, which is why the ambiguity does not show up there.

**A get has three outcomes, not two.** A message, an empty queue, and a failure:

```cobol
           EVALUATE TRUE
               WHEN PAYMENT-IN-COMPCODE = MQCC-OK
                   ...
               WHEN PAYMENT-IN-REASON = MQRC-NO-MSG-AVAILABLE
                   ...
               WHEN OTHER
                   DISPLAY "MQGET FAILED paymentIn COMPCODE " ...
```

An empty queue is the ordinary end of a drain, not a failure — MQ reports it as
reason 2033. Folding it in with the failures stops a batch every time it
finishes its work; folding it in with success processes the message area again,
still holding the last message read. That is why both branches are required.

A `put` goes under `MQPMO-SYNCPOINT` and a `get` under `MQGMO-SYNCPOINT`, so
neither is visible outside the unit of work until it commits: a payment released
before its ledger posting is committed is one the downstream system acts on and
the bank has not recorded. A `get` also asks `MQGMO-NO-WAIT`, because a batch
that blocks on an empty queue never ends. Both set `MQMI-NONE` and `MQCI-NONE`
in the message descriptor — on a put that asks the queue manager for a new
message identifier rather than reusing the last one, and on a get it means any
message will do.

The direction on the declaration decides which calls are allowed, because it is
what the `MQOPEN` asked for. Reading a queue opened `MQOO-OUTPUT` fails at run
time with reason 2037 and putting to one opened `MQOO-INPUT-AS-Q-DEF` fails with
2039, so both are refused when the program is compiled (`BANK-MQ-002`).

The status field is a **reason code**, not a two-character status like a file's
or a PCB's, so it is a number: `inReason` holds 2033 for an empty queue and 2085
for a queue that is not there. It is required, for the reason a file's status is
(`BANK-MQ-001`).

#### What a queue costs on z/OS

MQ needs no precompiler — the MQI is plain `CALL`s — but the job needs three
things it would not otherwise have, and the generated JCL asks for all of them:
`MQM.SCSQCOBC` on `SYSLIB` so `COPY CMQV` and the rest resolve at compile time,
`MQM.SCSQLOAD` on `SYSLIB` at link time so `MQCONN` and the others resolve to the
stub, and `MQM.SCSQANLE` with `MQM.SCSQLOAD` on `STEPLIB` so the stub reaches MQ
at run time.

Nothing outside z/OS supplies the MQI, so the local build cannot link a queue
program at all. `runtime/BANKMQ.cbl` stands in: the precompiler replaces the MQ
copybooks with a local declaration of the fields the compiler sets, and the stub
answers each call with the completion and reason codes IBM documents, holding
one message between a put and a get. **It is not IBM MQ** — no queue manager, no
persistence, no syncpoint, no channel. What running against it proves is that
the call sequence is one MQ accepts, that every operand resolves and is the
right type, and that all three outcomes of a get are reachable. What ships to
z/OS keeps its `COPY CMQV` and its calls exactly as written.
