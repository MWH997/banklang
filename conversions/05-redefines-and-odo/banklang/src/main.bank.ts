module CustRead;

// Everything from `record CmParty` down to the end of `CustomerRecord` is what
// `bankc copybook import CUSTREC.cpy` wrote, unedited. The importer refuses to
// write anything at all unless the record it produced lays out byte for byte
// like the copybook it read, so what is below is the same storage the estate's
// programs are already using.
record CmParty {
  cmPerson: string<30>;
  reserved 20;
}

record CmCompany {
  cmRegNo: string<12>;
  cmTradingName: string<38>;
}

record CmAddresses {
  cmAddrLine1: string<35>;
  cmAddrLine2: string<35>;
  cmAddrPostcode: string<8>;
}

record CustomerRecord {
  cmCustNo: string<10>;
  cmName: string<40>;
  cmKind: string<1>;
  cmParty: CmParty;
  cmCompany: CmCompany redefines cmParty;
  cmOpened: unsigned<8, 0>;
  cmBalance: decimal<15, 2>;
  cmAddrCount: unsigned<2, 0>;
  cmAddresses: CmAddresses[5] depending on cmAddrCount;
}

record ReadTotals {
  customersRead: unsigned<7, 0>;
  personal: unsigned<7, 0>;
  corporate: unsigned<7, 0>;
  addressLines: unsigned<7, 0>;
  idempotencyKey: string<36>;
}

file customerMaster sequential input record CustomerRecord
  status masterStatus;

on error customerMaster {
  log "CUSTMAST FAILED, STATUS ", masterStatus;
  returnCode = 12;
}

// A program that reads the imported record, to show it is a record and not a
// picture of one: the variant is chosen, the table is walked to the count the
// record carries, and the reserved bytes are untouchable.
entry transaction readCustomers(
  customer: CustomerRecord,
  totals: ReadTotals,
) {
  on failure {
    audit("CUSTOMER_READ_FAILED", totals.idempotencyKey);
  }

  totals.customersRead = 0;
  totals.personal = 0;
  totals.corporate = 0;
  totals.addressLines = 0;

  open customerMaster;

  if masterStatus != "00" {
    log "CUSTMAST OPEN FAILED, STATUS ", masterStatus;
    raise "MASTER_OPEN_FAILED";
  }

  while masterStatus == "00" limit 500000 {
    read customerMaster into customer;

    if masterStatus == "00" {
      totals.customersRead = totals.customersRead + 1;

      // `CM-PERSONAL` and `CM-CORPORATE` were 88-levels on `CM-KIND`. BankTS
      // has `enum` for a field with a fixed set of values, and the importer
      // does not turn 88s into one — it would have to decide that the levels
      // it saw are the whole set, and a copybook does not say so. The test is
      // written out here instead, against the same letters.
      if customer.cmKind == "P" {
        totals.personal = totals.personal + 1;
      } else {
        totals.corporate = totals.corporate + 1;
      }

      // `OCCURS 1 TO 5 DEPENDING ON CM-ADDR-COUNT`. The bound is the declared
      // maximum and the count is what the record is using, and reading past
      // the count reads whatever the last customer left in the buffer.
      for each addr in customer.cmAddresses {
        totals.addressLines = totals.addressLines + 1;
      }
    }
  }

  close customerMaster;

  log "CUSTOMERS ", totals.customersRead;
  log "PERSONAL  ", totals.personal;
  log "CORPORATE ", totals.corporate;
  log "ADDRESSES ", totals.addressLines;
  audit("CUSTOMERS_READ", totals.idempotencyKey);
}
