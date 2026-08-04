module WithdrawalWithRecovery;

type MoneyBDT = currency<"BDT", 18, 2>;

// A savings account is a current account plus the fields savings adds. The
// base fields are laid out first, so an existing CurrentAccount copybook still
// reads the leading bytes of a SavingsAccount record correctly.
record CurrentAccount {
  accountId: string<16>;
  balance: MoneyBDT;
  idempotencyKey: string<36>;
}

record SavingsAccount extends CurrentAccount {
  minimumBalance: MoneyBDT;
  requested: MoneyBDT;
}

record WithdrawalResult {
  accountId: string<16>;
  paidOut: MoneyBDT;
  closingBalance: MoneyBDT;
  idempotencyKey: string<36>;
}

file requestInput sequential input record SavingsAccount status requestStatus;

file resultOutput sequential output record WithdrawalResult status resultStatus;

// A withdrawal is only permitted when it leaves the account at or above its
// minimum balance. The check raises rather than returning a sentinel, so a
// caller cannot forget to test a failure that abandons the transaction.
function permittedAmount(account: SavingsAccount, requested: MoneyBDT): MoneyBDT {
  if requested <= 0.00 {
    raise "NON_POSITIVE_AMOUNT";
  }

  if account.balance - requested < account.minimumBalance {
    raise "BELOW_MINIMUM_BALANCE";
  }

  return requested;
}

entry transaction withdraw(account: SavingsAccount, result: WithdrawalResult) {
  on failure {
    // Runs when anything in the body raises, including inside permittedAmount.
    // The generated COBOL asks the ledger to unwind the unit of work before this
    // block runs, so a rejected withdrawal leaves no half-posted money behind.
    audit("WITHDRAWAL_REJECTED", account.idempotencyKey);
  }

  open requestInput;
  read requestInput into account;
  close requestInput;

  let allowed: MoneyBDT = permittedAmount(account, account.requested);

  // Cash leaves the customer's account and lands in the branch till, so the
  // two postings balance.
  debit(account.accountId, allowed);
  credit("BRANCH-TILL", allowed);

  account.balance = account.balance - allowed;

  result.accountId = account.accountId;
  result.paidOut = allowed;
  result.closingBalance = account.balance;
  result.idempotencyKey = account.idempotencyKey;

  open resultOutput;
  write resultOutput from result;
  close resultOutput;

  audit("WITHDRAWAL_POSTED", account.idempotencyKey);
}
