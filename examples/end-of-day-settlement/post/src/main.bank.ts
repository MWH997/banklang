module EodPost;

type MoneyBDT = currency<"BDT", 18, 2>;

// Step three: the money moves.
//
// It reads what the sort step ordered, not what the extract wrote, and the
// difference matters — the postings arrive in branch and account order, which
// is what makes the report's control breaks work and what keeps the ledger's
// index from being written all over the disk.
//
// This is the step with a restart position, because it is the one that cannot
// simply be rerun: the extract can be run again over the same input and the
// report can be printed twice, but posting the first forty thousand items a
// second time is forty thousand duplicate entries.
record SettlementItem {
  itemBranchId: string<8>;
  itemAccountId: string<16>;
  itemCounterparty: string<16>;
  itemAmount: MoneyBDT;
}

record PostedItem {
  postedBranchId: string<8>;
  postedAccountId: string<16>;
  postedAmount: MoneyBDT;
}

record RestartPoint {
  jobStep: string<8>;
  lastAccountId: string<16>;
}

record PostTotals {
  itemsPosted: unsigned<9, 0>;
  valuePosted: MoneyBDT;
  idempotencyKey: string<36>;
}

file sortedSettlement sequential input record SettlementItem status sortedStatus;

file postedSettlement sequential output record PostedItem status postedStatus;

// Keyed rather than sequential, and rewritten in place. A sequential restart
// file is rewritten from the start by the next OPEN, so a rerun that died
// before its own first checkpoint would destroy the position it was resuming
// from.
file restartFile indexed update record RestartPoint key jobStep status restartStatus;

on error sortedSettlement {
  log "SORTEDSETTLEMENT FAILED, STATUS ", sortedStatus;
  returnCode = 12;
}

on error postedSettlement {
  log "POSTEDSETTLEMENT FAILED, STATUS ", postedStatus;
  returnCode = 12;
}

entry transaction postSettlement(item: SettlementItem, posted: PostedItem, point: RestartPoint, totals: PostTotals) {
  on failure {
    log "STOPPED AFTER ", totals.itemsPosted, " AT ", point.lastAccountId;
    audit("POSTING_ABANDONED", totals.idempotencyKey);
  }

  totals.itemsPosted = 0;
  totals.valuePosted = 0.00;

  open restartFile;
  point.jobStep = "POST";

  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "STARTING FROM THE TOP";
  }

  open sortedSettlement;

  if sortedStatus != "00" {
    log "SORTEDSETTLEMENT OPEN FAILED, STATUS ", sortedStatus;
    raise "INPUT_OPEN_FAILED";
  }

  open postedSettlement;

  if postedStatus != "00" {
    log "POSTEDSETTLEMENT OPEN FAILED, STATUS ", postedStatus;
    raise "OUTPUT_OPEN_FAILED";
  }

  while sortedStatus == "00" limit 500000 {
    read sortedSettlement into item;

    if sortedStatus == "00" {
      debit(item.itemAccountId, item.itemAmount);
      credit(item.itemCounterparty, item.itemAmount);

      posted.postedBranchId = item.itemBranchId;
      posted.postedAccountId = item.itemAccountId;
      posted.postedAmount = item.itemAmount;

      write postedSettlement from posted;

      if postedStatus != "00" {
        log "POSTEDSETTLEMENT WRITE FAILED, STATUS ", postedStatus;
        raise "OUTPUT_WRITE_FAILED";
      }

      totals.itemsPosted = totals.itemsPosted + 1;
      totals.valuePosted = totals.valuePosted + item.itemAmount;

      // Every thousand items, so a rerun redoes at most a thousand. More often
      // costs I/O on every one; less often costs work on the rerun.
      point.lastAccountId = item.itemAccountId;
      checkpoint restartFile from point every 1000;
    }
  }

  close postedSettlement;
  close sortedSettlement;
  close restartFile;

  log "POSTED ", totals.itemsPosted, " WORTH ", totals.valuePosted;
  audit("SETTLEMENT_POSTED", totals.idempotencyKey);
}
