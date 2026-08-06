# MQ request/reply

Take a payment instruction off one queue, do the work, put the answer on
another.

## Why the shape matters more than the payload

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

MQ reports an empty queue as reason 2033. Folding it in with the failures stops
a drain every time it finishes its work; folding it in with success processes
the message area again, still holding the last message read. Both branches are
required, which is why `getMessage` has an `else`.

**Everything is under syncpoint.** The get asks `MQGMO-SYNCPOINT` and the put
asks `MQPMO-SYNCPOINT`, so the reply and the ledger posting commit together or
not at all — a payment released before its posting is committed is one the
downstream system acts on and the bank has not recorded.

That is also why this example needs no restart record: an uncommitted get goes
back on the queue and a committed one is gone, so the queue holds the position.

**A rejection still gets a reply.** A request/reply partner that is told nothing
waits forever.

## What it costs on z/OS

MQ needs no precompiler — the MQI is plain `CALL`s — but the generated job asks
for three things it would not otherwise have: `MQM.SCSQCOBC` on SYSLIB so
`COPY CMQV` resolves at compile time, `MQM.SCSQLOAD` on SYSLIB so `MQCONN` and
the rest resolve to the stub at link time, and `MQM.SCSQANLE` with
`MQM.SCSQLOAD` on STEPLIB so the stub reaches MQ at run time.

Nothing outside z/OS supplies the MQI. [`runtime/BANKMQ.cbl`](../../runtime/README.md)
stands in locally: it answers each call with the completion and reason codes IBM
documents and holds one message between a put and a get. **It is not IBM MQ.**

## Artifacts

`dist/cobol/MQREQUES.cbl`, `dist/jcl/MQREQUES.jcl`, three copybooks.

## Related

- [docs/language-reference.md](../../docs/language-reference.md) — the `queue` declaration

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=mq-request-reply) — it compiles in your browser, with the generated COBOL beside it.
