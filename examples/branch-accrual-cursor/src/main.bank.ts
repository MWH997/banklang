module BranchAccrualCursor;

type BDT = currency<"BDT", 18, 2>;

record AccrualRequest {
  branchId: string<8>;
  accrualRate: decimal<5, 4>;
  idempotencyKey: string<36>;
}

record AccountBalanceRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
  rowStatus: string<8>;
}

record AccrualSummary {
  summaryBranchId: string<8>;
  accountsRead: decimal<9, 0>;
  accountsAccrued: decimal<9, 0>;
  interestPosted: BDT;
  idempotencyKey: string<36>;
}

// The restart control record: one keyed record, rewritten in place by each
// checkpoint. A rerun reads it and resumes from the account after the last one
// that was committed.
record RestartPoint {
  jobName: string<8>;
  lastAccountId: string<16>;
}

// A cursor returns a stream of rows rather than one. The INTO clause names
// where a row lands; the compiler moves it onto the generated FETCH, which is
// the statement Db2 delivers a row to.
//
// `hold` is DECLARE ... CURSOR WITH HOLD FOR, and it is what makes the
// checkpoint below legal. Db2 closes a cursor that is not held when the unit of
// work commits, so without it the FETCH after the first checkpoint answers
// -501, cursor not open, having already posted and committed part of the
// branch. BANK-SQL-008 refuses that combination.
//
// `ACCOUNT_ID > :resumeAfter` is how the rerun resumes. On a first run the
// restart record is spaces, which is below every account number, so the cursor
// opens on the whole branch.
cursor accountsInBranch(keyBranch: string<8>, resumeAfter: string<16>) hold: AccountBalanceRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  AND ACCOUNT_ID > :resumeAfter
  ORDER BY ACCOUNT_ID
}

file summaryOutput sequential output record AccrualSummary status summaryStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error summaryOutput {
  log "SUMMARYOUTPUT FAILED, STATUS ", summaryStatus;
  returnCode = 12;
}

file restartFile indexed update record RestartPoint key jobName status restartStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error restartFile {
  log "RESTARTFILE FAILED, STATUS ", restartStatus;
  returnCode = 12;
}

function interestOn(balance: BDT, rate: decimal<5, 4>): BDT {
  return round(balance * rate, "HALF_EVEN");
}

entry transaction accrueBranch(request: AccrualRequest, row: AccountBalanceRow, summary: AccrualSummary, point: RestartPoint) {
  summary.summaryBranchId = request.branchId;
  summary.idempotencyKey = request.idempotencyKey;

  open restartFile;
  point.jobName = "BRACCRUE";

  // Read the position before the cursor opens, because the cursor's own host
  // variables are read at OPEN and one of them is this.
  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "STARTING FROM THE TOP";
  }

  // The bound is mandatory, and the OPEN and CLOSE are generated around the
  // body. A cursor left open holds Db2 locks for the rest of the batch window,
  // so the language does not offer a way to write one.
  for each row in accountsInBranch(request.branchId, point.lastAccountId) limit 5000 {
    summary.accountsRead = summary.accountsRead + 1;

    if row.rowStatus == "OPEN" {
      let interest: BDT = interestOn(row.rowBalance, request.accrualRate);

      credit(row.rowAccountId, interest);
      debit("INTEREST-EXPENSE", interest);

      summary.accountsAccrued = summary.accountsAccrued + 1;
      summary.interestPosted = summary.interestPosted + interest;
    }

    // Position first, commit after. A commit that landed before the position
    // was written would leave a rerun resuming from further back than the work
    // that is already durable, and every account in between would be accrued
    // twice.
    point.lastAccountId = row.rowAccountId;
    checkpoint restartFile from point every 100;
  }

  close restartFile;

  open summaryOutput;
  write summaryOutput from summary;
  close summaryOutput;

  audit("BRANCH_ACCRUAL_COMPLETED", request.idempotencyKey);
}
