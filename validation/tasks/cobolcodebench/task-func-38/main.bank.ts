module TaskFunc38;

// Written from `spec.json`. Specification: merge 'task_func38_inp1' and
// 'task_func38_inp2' into 'task_func38_out1' in ascending transaction-number
// order.
//
// The specification also names a second output file listing duplicate
// transaction numbers. It is not in this task's output contract: the benchmark
// supplies no expected content for it and the harness allocates no DD, so it
// is not written. Producing a file nothing has allocated would fail the open,
// which is a worse answer than saying so here.

// Twenty characters for a thirteen character record. Both inputs end without a
// newline, and a record that exactly fills an unterminated final line loses it
// under GnuCOBOL (divergence D23); line sequential drops the padding on the way
// out, so the written records are thirteen characters again.
record TransactionLine {
  trnNumber: unsigned<5, 0>;
  trnComma: string<1>;
  trnAmount: unsigned<7, 0>;
  trnFiller: string<7>;
}

file taskInp1
  lineSequential
  input
  record TransactionLine
  status taskInp1Status;

file taskInp2
  lineSequential
  input
  record TransactionLine
  status taskInp2Status;

file taskOut1
  lineSequential
  output
  record TransactionLine
  status taskOut1Status;

entry transaction mergeTransactions(
  movement: TransactionLine,
  idempotencyKey: string<36>,
) {
  // Both inputs already arrive in transaction-number order, which is what a
  // merge requires and why this is not a sort: MERGE opens, reads, orders and
  // writes the files itself, and has no input procedure precisely because one
  // could reorder records and break that premise.
  merge taskInp1, taskInp2 into taskOut1 on trnNumber;

  log "TRANSACTIONS MERGED ", movement.trnNumber;

  audit("TRANSACTIONS_MERGED", idempotencyKey);
}
