module AccountFileBatch;

type MoneyBDT = decimal<18, 2>;

record AccountRecord {
  accountId: string<16>;
  balance: MoneyBDT;
}

record PostingRecord {
  postingAccountId: string<16>;
  postingBalance: MoneyBDT;
  postingFlag: string<1>;
}

file accountInput sequential input record AccountRecord status accountInputStatus;

file postingOutput sequential output record PostingRecord status postingOutputStatus;

function isOverdrawn(balance: MoneyBDT): bool {
  return 0.00 > balance;
}

// The point of the example is the reading and writing, and what happens when a
// file does not open. A batch that ignores a failed OPEN writes an empty output
// file and ends with a return code of zero, which looks exactly like a night
// with nothing to post.
entry transaction postAccounts(account: AccountRecord, posting: PostingRecord, idempotencyKey: string<36>) {
  open accountInput;
  open postingOutput;

  // The bound is what stops a corrupt file spinning the job until the operator
  // cancels it; the status test is what ends the loop normally.
  while accountInputStatus == "00" limit 1000000 {
    read accountInput into account;

    if accountInputStatus == "00" {
      posting.postingAccountId = account.accountId;
      posting.postingBalance = account.balance;

      if isOverdrawn(account.balance) {
        posting.postingFlag = "O";
      } else {
        posting.postingFlag = " ";
      }

      write postingOutput from posting;
    }
  }

  close postingOutput;
  close accountInput;

  audit("ACCOUNTS_POSTED", idempotencyKey);
}
