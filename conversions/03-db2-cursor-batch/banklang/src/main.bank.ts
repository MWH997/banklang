module BrAccr;

type MoneyBDT = currency<"BDT", 15, 2>;

type Rate = decimal<5, 4>;

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: MoneyBDT;
  rowStatus: string<8>;
}

record AccrualCounts {
  rowsRead: unsigned<7, 0>;
  rowsPosted: unsigned<7, 0>;
  interestPosted: MoneyBDT;
}

// The cursor is a declaration, and the OPEN and CLOSE are generated around the
// loop that reads it. The original could, and in a later release did, return
// from inside `2000-FETCH` and leave the cursor open, holding Db2 locks for the
// rest of the batch window.
cursor accountsInBranch(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  ORDER BY ACCOUNT_ID
}

function interestOn(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}

// `PERFORM 2000-FETCH UNTIL SQLCODE = 100` is unbounded and, worse, exits on
// exactly one value: a -911 deadlock leaves SQLCODE at -911 and the loop
// fetches again, forever, against a cursor Db2 has closed under it.
entry transaction accrueBranch(row: AccountRow, counts: AccrualCounts, branchId: string<8>, idempotencyKey: string<36>) {
  counts.rowsRead = 0;
  counts.rowsPosted = 0;
  counts.interestPosted = 0.00;

  for each row in accountsInBranch(branchId) limit 100000 {
    counts.rowsRead = counts.rowsRead + 1;

    if row.rowStatus == "OPEN" {
      let interest: MoneyBDT = interestOn(row.rowBalance, 0.0025);

      // The original credited the account and debited nothing. Interest is an
      // expense to the bank and the other side of it has to go somewhere;
      // `BANK-LED-001` will not compile a transaction whose postings do not
      // balance, which is what turned this up.
      credit(row.rowAccountId, interest);
      debit("INTEREST-EXPENSE", interest);

      counts.rowsPosted = counts.rowsPosted + 1;
      counts.interestPosted = counts.interestPosted + interest;
    }
  }

  commit;

  log "ROWS   ", counts.rowsRead;
  log "POSTED ", counts.rowsPosted;
  audit("BRANCH_ACCRUED", idempotencyKey);
}
