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

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error requestInput {
  log "REQUESTINPUT FAILED, STATUS ", requestStatus;
  returnCode = 12;
}

file resultOutput sequential output record WithdrawalResult status resultStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error resultOutput {
  log "RESULTOUTPUT FAILED, STATUS ", resultStatus;
  returnCode = 12;
}

// Declared over the base record, so it works for any account that extends
// CurrentAccount. The call site below passes a SavingsAccount: its leading
// fields sit at the offsets this parameter describes, which is what `extends`
// guarantees and what makes passing it here safe.
function ledgerBalanceOf(account: CurrentAccount): MoneyBDT {
  return account.balance;
}

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
  // End of file is not a failure. The generated status check lets 10 through
  // for the program to decide about, so it has to be decided about here. An
  // empty request dataset otherwise leaves `account` holding whatever working
  // storage was initialised to, and the withdrawal below debits an account id
  // of spaces for nothing and reports success. BANK-FILE-017.
  if requestStatus != "00" {
    log "NO WITHDRAWAL REQUEST TO PROCESS, STATUS ", requestStatus;
    raise "NO_REQUEST";
  }
  close requestInput;

  let allowed: MoneyBDT = permittedAmount(account, account.requested);

  // Cash leaves the customer's account and lands in the branch till, so the
  // two postings balance.
  debit(account.accountId, allowed);
  credit("BRANCH-TILL", allowed);

  // Reads the derived record through a parameter declared over the base.
  account.balance = ledgerBalanceOf(account) - allowed;

  result.accountId = account.accountId;
  result.paidOut = allowed;
  result.closingBalance = account.balance;
  result.idempotencyKey = account.idempotencyKey;

  open resultOutput;
  write resultOutput from result;
  close resultOutput;

  audit("WITHDRAWAL_POSTED", account.idempotencyKey);
}
