module BranchAccrualCursor;

type BDT = currency<"BDT", 18, 2>;

record AccrualRequest {
  branchId: string<8>;
  accrualRate: decimal<5, 4>;
  idempotencyKey: string<36>;
}

record AccountRow {
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

// A cursor returns a stream of rows rather than one. The INTO clause names
// where a row lands; the compiler moves it onto the generated FETCH, which is
// the statement Db2 delivers a row to.
cursor accountsInBranch(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  ORDER BY ACCOUNT_ID
}

file summaryOutput sequential output record AccrualSummary status summaryStatus;

function interestOn(balance: BDT, rate: decimal<5, 4>): BDT {
  return round(balance * rate, "HALF_EVEN");
}

entry transaction accrueBranch(request: AccrualRequest, row: AccountRow, summary: AccrualSummary) {
  summary.summaryBranchId = request.branchId;
  summary.idempotencyKey = request.idempotencyKey;

  // The bound is mandatory, and the OPEN and CLOSE are generated around the
  // body. A cursor left open holds Db2 locks for the rest of the batch window,
  // so the language does not offer a way to write one.
  for each row in accountsInBranch(request.branchId) limit 5000 {
    summary.accountsRead = summary.accountsRead + 1;

    if row.rowStatus == "OPEN" {
      let interest: BDT = interestOn(row.rowBalance, request.accrualRate);

      credit(row.rowAccountId, interest);
      debit("INTEREST-EXPENSE", interest);

      summary.accountsAccrued = summary.accountsAccrued + 1;
      summary.interestPosted = summary.interestPosted + interest;
    }
  }

  open summaryOutput;
  write summaryOutput from summary;
  close summaryOutput;

  audit("BRANCH_ACCRUAL_COMPLETED", request.idempotencyKey);
}
