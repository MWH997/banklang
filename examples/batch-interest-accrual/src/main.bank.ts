module BatchInterestAccrual;

type MoneyBDT = decimal<18, 2>;

record InterestAccount {
  accountId: string<16>;
  balance: MoneyBDT;
}

function isEligibleForInterest(balance: MoneyBDT): bool {
  if balance > 1000.00 {
    return true;
  } else {
    return false;
  }
}
