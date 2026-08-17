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

// The commarea, field for field: what the caller passes in and what it reads
// back out. CICS gives a program one communication area, not one in and one
// out. `DFHCOMMAREA` is the caller's own storage, so the request fields and
// the reply fields are the same block, and the transaction answers by writing
// into the record it was asked with.
//
// A separate reply record would be working storage, and working storage is
// gone when the task ends.
record EnquiryCommarea {
  caAccountId: string<16>;
  caRequestedBy: string<20>;
  caBalance: BDT;
  caOutcome: EnquiryOutcome;
  idempotencyKey: string<36>;
}

record AccountBalanceRow {
  rowAccountId: string<16>;
  rowBalance: BDT;
  rowStatus: string<8>;
}

// What the audit program is told. This one is working storage and is meant to
// be: it goes out through the `link`, not back to the caller.
record AuditEntry {
  auditAccountId: string<16>;
  auditRequestedBy: string<20>;
  auditOutcome: EnquiryOutcome;
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
// returns to CICS rather than to a caller. The first record parameter is the
// commarea (`MOVE DFHCOMMAREA TO ENQUIRY-COMMAREA` on entry, `MOVE
// ENQUIRY-COMMAREA TO DFHCOMMAREA` on the way out) so it is the one place an
// answer can go. Anything else is working storage, and the task ends with it.
cics transaction accountEnquiry(enquiry: EnquiryCommarea, row: AccountBalanceRow, auditEntry: AuditEntry) {
  execute fetchAccount(enquiry.caAccountId) into row;

  // Three outcomes, not two. `+100` is the only "no such account"; a negative
  // SQLCODE is Db2 saying the question was never answered: a deadlock the
  // thread lost (-911), a resource that was not available (-904), a package
  // that was never bound (-805). Collapsing those into the not-found branch is
  // BANK-SQL-007, and it is what turns an outage into a customer being told
  // their account does not exist.
  if sqlcode < 0 {
    enquiry.caOutcome = EnquiryOutcome.UNAVAILABLE_DB;
    enquiry.caBalance = 0.00;
  } else {
    if sqlcode == 0 {
      enquiry.caBalance = row.rowBalance;

      if isAvailable(row.rowStatus) {
        enquiry.caOutcome = EnquiryOutcome.FOUND;
      } else {
        enquiry.caOutcome = EnquiryOutcome.UNAVAILABLE;
      }
    } else {
      enquiry.caOutcome = EnquiryOutcome.NOT_FOUND;
      enquiry.caBalance = 0.00;
    }
  }

  auditEntry.auditAccountId = enquiry.caAccountId;
  auditEntry.auditRequestedBy = enquiry.caRequestedBy;
  auditEntry.auditOutcome = enquiry.caOutcome;

  // Every CICS command captures its response code; an unchecked outcome is
  // BANK-CICS-001.
  link "AUDITLOG" commarea auditEntry resp linkResp;

  // A reply the transaction could not answer is not work to commit. Backing
  // out costs nothing on a read, and it is the right habit for the day this
  // transaction grows a write.
  if linkResp == 0 && sqlcode >= 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }

  audit("ENQUIRY_COMPLETED", enquiry.idempotencyKey);
}
