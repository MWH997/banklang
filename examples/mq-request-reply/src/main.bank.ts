module MqRequestReply;

type MoneyBDT = currency<"BDT", 18, 2>;

// Request/reply over MQ: take a payment instruction off one queue, do the
// work, put the answer on another.
//
// The shape matters more than the payload. A get has three outcomes — a
// message, an empty queue, and a failure — and folding the empty queue in with
// the failures stops a drain every time it finishes its work, while folding it
// in with success reprocesses whatever the message area was still holding.
// Both branches are required here for that reason.
record PaymentRequest {
  requestAccountId: string<16>;
  requestAmount: MoneyBDT;
  idempotencyKey: string<36>;
}

record ReplyMessage {
  replyKey: string<36>;
  replyOutcome: string<8>;
  replyAmount: MoneyBDT;
}

record DrainTotals {
  messagesRead: unsigned<9, 0>;
  messagesAccepted: unsigned<9, 0>;
  messagesRejected: unsigned<9, 0>;
}

queue paymentIn manager "CSQ1" name "PAYMENT.REQUEST" input record PaymentRequest status inReason;

queue paymentOut manager "CSQ1" name "PAYMENT.REPLY" output record ReplyMessage status outReason;

// A payment this program will not pass on. The rule is deliberately dull: what
// the example is showing is that a rejection still gets a reply, because a
// request/reply partner that is told nothing waits forever.
function acceptable(amount: MoneyBDT): string<8> {
  if amount <= 0.00 {
    return "REJECT";
  } else {
    if amount > 1000000.00 {
      return "REJECT";
    } else {
      return "ACCEPT";
    }
  }
}

entry transaction drainPayments(request: PaymentRequest, reply: ReplyMessage, totals: DrainTotals) {
  on failure {
    audit("DRAIN_FAILED", request.idempotencyKey);
  }

  totals.messagesRead = 0;
  totals.messagesAccepted = 0;
  totals.messagesRejected = 0;

  // Each of these is MQOPEN, and MQCLOSE at the other end. Neither half is
  // useful alone, which is why the language does not offer them separately.
  //
  // Both queues are on CSQ1, and a program connects to a queue manager rather
  // than to a queue: the first of these two also does the MQCONN, the last
  // disconnectQueue does the MQDISC, and the second MQCONN that a connect per
  // queue would issue never happens. MQ answers that one with
  // MQRC_ALREADY_CONNECTED and MQCC_WARNING, which is not MQCC_OK, so it would
  // end the step here before a message was ever read.
  connectQueue paymentIn;
  connectQueue paymentOut;

  // The bound is what stops a queue somebody is still feeding from holding the
  // batch window open indefinitely. The get asks MQGMO-NO-WAIT, so an empty
  // queue ends the drain rather than blocking on it.
  while inReason == 0 limit 10000 {
    getMessage paymentIn into request {
      totals.messagesRead = totals.messagesRead + 1;

      reply.replyKey = request.idempotencyKey;
      reply.replyAmount = request.requestAmount;
      reply.replyOutcome = acceptable(request.requestAmount);

      if reply.replyOutcome == "ACCEPT" {
        debit(request.requestAccountId, request.requestAmount);
        credit("PAYMENTS-CLEARING", request.requestAmount);
        totals.messagesAccepted = totals.messagesAccepted + 1;
        audit("PAYMENT_ACCEPTED", request.idempotencyKey);
      } else {
        totals.messagesRejected = totals.messagesRejected + 1;
        audit("PAYMENT_REJECTED", request.idempotencyKey);
      }

      // The reply goes under MQPMO-SYNCPOINT, like the get, so the answer and
      // the ledger posting commit together or not at all. A payment released
      // before its posting is committed is one the downstream system acts on
      // and the bank has not recorded.
      putMessage paymentOut from reply;

      if outReason != 0 {
        log "MQPUT FAILED, REASON ", outReason;
        raise "REPLY_UNDELIVERABLE";
      }
    } else {
      // 2033 is MQRC_NO_MSG_AVAILABLE — the ordinary end of a drain.
      log "QUEUE EMPTY";
    };
  }

  disconnectQueue paymentIn;
  disconnectQueue paymentOut;

  log "READ ", totals.messagesRead;
  log "ACCEPTED ", totals.messagesAccepted;
  log "REJECTED ", totals.messagesRejected;
}
