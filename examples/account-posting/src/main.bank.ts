module AccountPosting;

type MoneyBDT = decimal<18, 2>;

record PostTransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: MoneyBDT;
  idempotencyKey: string<36>;
}

transaction postTransfer(request: PostTransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}
