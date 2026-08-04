module OnlineEnquiry;

type BDT = currency<"BDT", 18, 2>;

enum EnquiryOutcome {
  FOUND,
  NOT_FOUND,
  UNAVAILABLE,
}

record EnquiryRequest {
  accountId: string<16>;
  requestedBy: string<20>;
  idempotencyKey: string<36>;
}

record AccountRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
  rowStatus: string<8>;
}

record EnquiryReply {
  replyAccountId: string<16>;
  replyBalance: BDT;
  outcome: EnquiryOutcome;
}

// Db2 access is declared, not assembled at run time. Dynamic SQL is rejected.
sql fetchAccount(keyAccountId: string<16>): AccountRow {
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
cics transaction accountEnquiry(request: EnquiryRequest, row: AccountRow, reply: EnquiryReply) {
  execute fetchAccount(request.accountId) into row;

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

  // Every CICS command captures its response code; an unchecked outcome is
  // BANK-CICS-001.
  link "AUDITLOG" commarea reply resp linkResp;

  if linkResp == 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }

  audit("ENQUIRY_COMPLETED", request.idempotencyKey);
}
