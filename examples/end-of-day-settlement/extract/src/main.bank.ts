module EodExtract;

type MoneyBDT = currency<"BDT", 18, 2>;

// Step one of the night: read the day's captured transactions and write out
// the ones that settle, in the shape the posting program expects.
//
// It posts nothing. That is deliberate and it is the reason the night is
// several programs rather than one: an extract that wrote to the ledger could
// not be rerun after a bad selection, and a selection is the thing most likely
// to be wrong.
record RawTransaction {
  rawAccountId: string<16>;
  rawCounterparty: string<16>;
  rawAmount: MoneyBDT;
  rawKind: string<4>;
  rawStatus: string<1>;
}

// The record the sort orders and the posting program reads. All three programs
// hold the same layout, which on an estate is one copybook in a shared library
// rather than three declarations that agree today.
record SettlementItem {
  itemBranchId: string<8>;
  itemAccountId: string<16>;
  itemCounterparty: string<16>;
  itemAmount: MoneyBDT;
}

record ExtractTotals {
  transactionsRead: unsigned<9, 0>;
  itemsWritten: unsigned<9, 0>;
  valueExtracted: MoneyBDT;
  idempotencyKey: string<36>;
}

file dayTransactions sequential input record RawTransaction status dayStatus;

file settlementExtract sequential output record SettlementItem status extractStatus;

on error dayTransactions {
  log "DAYTRANSACTIONS FAILED, STATUS ", dayStatus;
  returnCode = 12;
}

on error settlementExtract {
  log "SETTLEMENTEXTRACT FAILED, STATUS ", extractStatus;
  returnCode = 12;
}

entry transaction extractDay(raw: RawTransaction, item: SettlementItem, totals: ExtractTotals) {
  on failure {
    audit("EXTRACT_FAILED", totals.idempotencyKey);
  }

  totals.transactionsRead = 0;
  totals.itemsWritten = 0;
  totals.valueExtracted = 0.00;

  open dayTransactions;

  if dayStatus != "00" {
    log "DAYTRANSACTIONS OPEN FAILED, STATUS ", dayStatus;
    raise "INPUT_OPEN_FAILED";
  }

  open settlementExtract;

  if extractStatus != "00" {
    log "SETTLEMENTEXTRACT OPEN FAILED, STATUS ", extractStatus;
    raise "OUTPUT_OPEN_FAILED";
  }

  while dayStatus == "00" limit 500000 {
    read dayTransactions into raw;

    if dayStatus == "00" {
      totals.transactionsRead = totals.transactionsRead + 1;

      // "A" is authorised. Anything else was reversed, declined, or is still
      // in flight, and none of those settle tonight.
      if raw.rawStatus == "A" {
        // The branch is the first eight characters of the account, which is
        // what the sort orders on and what the report breaks totals on.
        item.itemBranchId = substring(raw.rawAccountId, 1, 8);
        item.itemAccountId = raw.rawAccountId;
        item.itemCounterparty = raw.rawCounterparty;
        item.itemAmount = raw.rawAmount;

        write settlementExtract from item;

        if extractStatus != "00" {
          log "SETTLEMENTEXTRACT WRITE FAILED, STATUS ", extractStatus;
          raise "OUTPUT_WRITE_FAILED";
        }

        totals.itemsWritten = totals.itemsWritten + 1;
        totals.valueExtracted = totals.valueExtracted + raw.rawAmount;
      }
    }
  }

  close settlementExtract;
  close dayTransactions;

  log "READ ", totals.transactionsRead;
  log "EXTRACTED ", totals.itemsWritten, " WORTH ", totals.valueExtracted;

  // Nothing to settle is not a failure, but it is not a normal night either,
  // and the operator should not have to read the log to find out. 4 is the
  // conventional warning, and the next step still runs.
  if totals.itemsWritten == 0 {
    returnCode = 4;
  }

  audit("DAY_EXTRACTED", totals.idempotencyKey);
}
