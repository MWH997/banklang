module VsamBrowse;

type MoneyBDT = currency<"BDT", 18, 2>;

// The most common thing a real program does to a KSDS, and the one shape no
// example had: position on a partial key, then walk forward until the key
// stops matching.
//
// A customer's accounts are not contiguous in the primary key and there is no
// query language here to find them, so the file carries an alternate index on
// the customer. `START` positions on the first record at or after the key,
// KEY IS NOT LESS THAN, which is what makes a browse from a partial key
// possible at all, and `readNext` walks from there. The walk has to stop
// itself: the file does not end where the customer's records do, so a browse
// that only tests for end-of-file reads the rest of the estate's accounts into
// this customer's total.
record AccountRecord {
  accountRecordId: string<16>;
  customerId: string<10>;
  branchId: string<8>;
  accountBalance: MoneyBDT;
}

record BrowseRequest {
  wantedCustomerId: string<10>;
  idempotencyKey: string<36>;
}

record BrowseTotals {
  accountsFound: unsigned<9, 0>;
  balanceHeld: MoneyBDT;
}

file accountMaster indexed input record AccountRecord key accountRecordId alternate customerId, branchId status masterStatus;

entry transaction browseCustomer(request: BrowseRequest, account: AccountRecord, totals: BrowseTotals) {
  on failure {
    audit("BROWSE_FAILED", request.idempotencyKey);
  }

  totals.accountsFound = 0;
  totals.balanceHeld = 0.00;

  open accountMaster;

  if masterStatus != "00" {
    log "ACCOUNTMASTER OPEN FAILED, STATUS ", masterStatus;
    raise "MASTER_OPEN_FAILED";
  }

  // The key the browse starts from. Setting it on the record is how COBOL's
  // START names a key: the field in the record area is the operand, not an
  // argument to the statement, and naming an alternate key's field is what
  // makes the browse walk that index.
  account.customerId = request.wantedCustomerId;
  start accountMaster key account.customerId;

  // 23 from a START is "no record at or after that key", which for a browse is
  // an empty result rather than a failure: a customer with no accounts is a
  // customer, not an error.
  if masterStatus == "23" {
    log "NO ACCOUNTS FOR ", request.wantedCustomerId;
  }

  if masterStatus == "00" {
    // The bound is the file's size, not the customer's. The condition is what
    // ends an ordinary walk: still reading cleanly, and still on this
    // customer's records.
    while masterStatus == "00" && account.customerId == request.wantedCustomerId limit 100000 {
      readNext accountMaster into account;

      if masterStatus == "00" {
        if account.customerId == request.wantedCustomerId {
          totals.accountsFound = totals.accountsFound + 1;
          totals.balanceHeld = totals.balanceHeld + account.accountBalance;
        }
      }
    }

    // 10 is the end of the file, which a browse that walked to the last record
    // reaches legitimately. Anything else stopped the walk early, and a total
    // over some of a customer's accounts is worse than no total.
    if masterStatus != "00" {
      if masterStatus != "10" {
        log "BROWSE FAILED, STATUS ", masterStatus;
        raise "BROWSE_FAILED";
      }
    }
  }

  close accountMaster;

  log "CUSTOMER ", request.wantedCustomerId;
  log "ACCOUNTS ", totals.accountsFound, " HOLDING ", totals.balanceHeld;
  audit("CUSTOMER_BROWSED", request.idempotencyKey);
}
