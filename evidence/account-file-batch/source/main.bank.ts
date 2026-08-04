module AccountFileBatch;

type MoneyBDT = decimal<18, 2>;

record AccountRecord {
  accountId: string<16>;
  balance: MoneyBDT;
}

file accountInput sequential input record AccountRecord status accountInputStatus;

file postingOutput sequential output record AccountRecord status postingOutputStatus;

function isOverdrawn(balance: MoneyBDT): bool {
  return 0.00 > balance;
}
