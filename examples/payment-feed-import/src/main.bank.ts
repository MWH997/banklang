module PaymentFeedImport;

type BDT = zoned<13, 2>;

// The file a counterparty sends: text, one payment a line, no mainframe on the
// other end of it. Every field is `zoned` or `string` rather than the packed
// decimal a dataset would carry, because Enterprise COBOL requires a
// line-sequential record to hold only USAGE DISPLAY items: a packed field here
// is `BANK-FILE-014` rather than a file nobody can read.
record PaymentLine {
  payReference: string<16>;
  payAccount: string<16>;
  payAmount: BDT;
  payValueDate: date;
}

// What the import produces for the ledger to post from. Written as text as
// well, so the reconciliation team can read it beside the file it came from.
record AcceptedLine {
  acceptedReference: string<16>;
  acceptedAccount: string<16>;
  acceptedAmount: BDT;
}

record ImportTotals {
  linesRead: unsigned<9, 0>;
  linesAccepted: unsigned<9, 0>;
  linesRejected: unsigned<9, 0>;
  amountAccepted: BDT;
}

file paymentFeed lineSequential input record PaymentLine status paymentFeedStatus;

file acceptedFeed lineSequential output record AcceptedLine status acceptedFeedStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error acceptedFeed {
  log "ACCEPTEDFEED FAILED, STATUS ", acceptedFeedStatus;
  returnCode = 12;
}

// A payment with no reference cannot be reconciled and a payment of nothing is
// not a payment. Both are rejections rather than failures: a feed from outside
// is expected to contain some rubbish, and a job that abends on the first bad
// line leaves the good ones unposted.
function isAcceptable(reference: string<16>, amount: BDT): bool {
  if reference == " " {
    return false;
  } else {
    if amount > 0.00 {
      return true;
    } else {
      return false;
    }
  }
}

entry transaction importFeed(line: PaymentLine, accepted: AcceptedLine, totals: ImportTotals, idempotencyKey: string<36>) {
  open paymentFeed;
  open acceptedFeed;

  // The bound is what stops a corrupt feed spinning the job until an operator
  // cancels it; the status test is what ends the loop normally.
  while paymentFeedStatus == "00" limit 1000000 {
    read paymentFeed into line;

    if paymentFeedStatus == "00" {
      totals.linesRead = totals.linesRead + 1;

      if isAcceptable(line.payReference, line.payAmount) {
        accepted.acceptedReference = line.payReference;
        accepted.acceptedAccount = line.payAccount;
        accepted.acceptedAmount = line.payAmount;
        write acceptedFeed from accepted;

        totals.linesAccepted = totals.linesAccepted + 1;
        totals.amountAccepted = totals.amountAccepted + line.payAmount;
      } else {
        totals.linesRejected = totals.linesRejected + 1;
      }
    }
  }

  close acceptedFeed;
  close paymentFeed;

  log "FEED READ ", totals.linesRead;
  log "FEED ACCEPTED ", totals.linesAccepted;
  log "FEED REJECTED ", totals.linesRejected;

  audit("PAYMENT_FEED_IMPORTED", idempotencyKey);
}
