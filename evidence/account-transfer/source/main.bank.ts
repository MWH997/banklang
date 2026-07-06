module AccountTransfer;

type MoneyBDT = decimal<18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
}

function validateAmount(amount: MoneyBDT): bool {
  return amount > 0.00;
}
