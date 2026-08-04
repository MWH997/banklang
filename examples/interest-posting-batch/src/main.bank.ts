module InterestPostingBatch;

type MoneyBDT = decimal<18, 2>;

type Rate = decimal<9, 4>;

record InterestAccount {
  accountId: string<16>;
  branchCode: string<8>;
  balance: MoneyBDT;
  accruedInterest: MoneyBDT;
  idempotencyKey: string<36>;
}

record PostingAdvice {
  accountId: string<16>;
  interestAmount: MoneyBDT;
  idempotencyKey: string<36>;
}

file accountFeed sequential input record InterestAccount status accountFeedStatus;

file adviceOutput sequential output record PostingAdvice status adviceOutputStatus;

// An account earns interest only when it is funded and not dormant.
function isEligible(balance: MoneyBDT, minimumBalance: MoneyBDT): bool {
  return balance >= minimumBalance && balance > 0.00;
}

// Tiered rate: larger balances earn the premium rate.
function rateFor(balance: MoneyBDT, threshold: MoneyBDT): Rate {
  if balance >= threshold {
    return 0.0450;
  } else {
    return 0.0125;
  }
}

// Interest is balance * rate, rounded to the currency scale with banker's
// rounding. The rounding mode is required by the compiler, not optional.
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}

// A fee is only applied when it does not take the account negative.
function feeFor(balance: MoneyBDT, fee: MoneyBDT): MoneyBDT {
  if balance - fee >= 0.00 {
    return fee;
  } else {
    return 0.00;
  }
}

transaction postInterest(account: InterestAccount, advice: PostingAdvice) {
  let minimumBalance: MoneyBDT = 100.00;
  let premiumThreshold: MoneyBDT = 500000.00;
  let maintenanceFee: MoneyBDT = 25.00;
  let interest: MoneyBDT = 0.00;
  let fee: MoneyBDT = 0.00;

  if isEligible(account.balance, minimumBalance) {
    interest = accrue(account.balance, rateFor(account.balance, premiumThreshold));
    fee = feeFor(account.balance, maintenanceFee);
  } else {
    interest = 0.00;
    fee = 0.00;
  }

  // Interest credited to the customer is funded from the interest expense
  // account, so the posting balances.
  credit(account.accountId, interest);
  debit("INTEREST-EXPENSE", interest);

  // The fee moves the other way.
  debit(account.accountId, fee);
  credit("FEE-INCOME", fee);

  advice.accountId = account.accountId;
  advice.interestAmount = interest;
  advice.idempotencyKey = account.idempotencyKey;

  audit("INTEREST_POSTED", account.idempotencyKey);
}

transaction runBatch(account: InterestAccount, advice: PostingAdvice) {
  open accountFeed;
  open adviceOutput;

  // The limit is mandatory: an unbounded loop in a transaction is BANK-TXN-004.
  while accountFeedStatus == "00" limit 100000 {
    read accountFeed into account;
    write adviceOutput from advice;
  }

  close accountFeed;
  close adviceOutput;

  audit("INTEREST_BATCH_COMPLETED", account.idempotencyKey);
}
