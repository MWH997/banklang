module OnlineEnquiry;

type BDT = currency<"BDT", 18, 2>;

// `UNAVAILABLE_DB` is a query that did not run, which is not an account that
// does not exist. Without it the two share an answer, and a customer is told
// their account is not there because Db2 was busy.
enum EnquiryOutcome {
  FOUND,
  NOT_FOUND,
  UNAVAILABLE,
  UNAVAILABLE_DB,
}

record EnquiryRequest {
  accountId: string<16>;
  requestedBy: string<20>;
  idempotencyKey: string<36>;
}

record AccountBalanceRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
  rowStatus: string<8>;
}

record BalanceReply {
  replyAccountId: string<16>;
  replyBalance: BDT;
  outcome: EnquiryOutcome;
}

// Db2 access is declared, not assembled at run time. Dynamic SQL is rejected.
sql fetchAccount(keyAccountId: string<16>): AccountBalanceRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAccountId
}

function isAvailable(status: string<8>): bool {
  return status == "OPEN";
}

// An online transaction: input arrives through the COMMAREA and control
// returns to CICS rather than to a caller.
cics transaction accountEnquiry(request: EnquiryRequest, row: AccountBalanceRow, reply: BalanceReply) {
  execute fetchAccount(request.accountId) into row;

  // Three outcomes, not two. `+100` is the only "no such account"; a negative
  // SQLCODE is Db2 saying the question was never answered — a deadlock the
  // thread lost (-911), a resource that was not available (-904), a package
  // that was never bound (-805). Collapsing those into the not-found branch is
  // BANK-SQL-007, and it is what turns an outage into a customer being told
  // their account does not exist.
  if sqlcode < 0 {
    reply.outcome = EnquiryOutcome.UNAVAILABLE_DB;
  } else {
    if sqlcode == 0 {
      reply.replyAccountId = row.rowAccountId;
      reply.replyBalance = row.rowBalance;

      if isAvailable(row.rowStatus) {
        reply.outcome = EnquiryOutcome.FOUND;
      } else {
        reply.outcome = EnquiryOutcome.UNAVAILABLE;
      }
    } else {
      reply.outcome = EnquiryOutcome.NOT_FOUND;
    }
  }

  // Every CICS command captures its response code; an unchecked outcome is
  // BANK-CICS-001.
  link "AUDITLOG" commarea reply resp linkResp;

  // A reply the transaction could not answer is not work to commit. Backing
  // out costs nothing on a read, and it is the right habit for the day this
  // transaction grows a write.
  if linkResp == 0 && sqlcode >= 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }

  audit("ENQUIRY_COMPLETED", request.idempotencyKey);
}
