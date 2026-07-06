module BatchInterestAccrual;

type MoneyBDT = decimal<18, 2>;

record InterestAccount {
  accountId: string<16>;
  balance: MoneyBDT;
}

function isEligibleForInterest(balance: MoneyBDT): bool {
  let projectedBalance: MoneyBDT = balance + 0000000000000025.00;

  if projectedBalance > 1000.00 {
    return true;
  } else {
    return false;
  }
}
