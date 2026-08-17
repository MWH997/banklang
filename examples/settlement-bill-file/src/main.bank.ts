module SettlementBillFile;

// A settlement extract with three record layouts on one file: a header naming
// the run, a detail line per counterparty, and a trailer carrying the control
// totals. It is what a clearing file looks like, and it is the shape BankTS
// could not express until `record Header, Detail, Trailer`.
//
// The variant is chosen by the record's type at each `write`, so a detail
// cannot reach a header's fields and a short layout writes its own length
// rather than the record area's. A file that is *read* still carries one
// layout: see `BANK-FILE-015`, and the reasoning in `docs/language/files.md`.
type GBP = currency<"GBP", 18, 2>;

// The feed this run settles, one movement per line.
record MovementLine {
  moveCounterparty: string<8>;
  moveAmount: zoned<13, 2>;
  idempotencyKey: string<36>;
}

// `H` in column one, then the run date. A reader of the file can tell the three
// apart by that first character, which is what a settlement contract states.
record ExtractHeader {
  headerTag: string<1>;
  headerTitle: string<19>;
  headerDate: date;
}

record ExtractDetail {
  detailTag: string<1>;
  detailCounterparty: string<8>;
  detailAmount: edited<zoned<13, 2>, "grouped">;
}

record ExtractTrailer {
  trailerTag: string<1>;
  trailerCount: edited<decimal<7, 0>, "plain">;
  trailerTotal: edited<zoned<13, 2>, "grouped">;
}

record RunTotals {
  settled: decimal<7, 0>;
  total: zoned<13, 2>;
}

file movementFeed lineSequential input record MovementLine status movementFeedStatus;

file settlementExtract lineSequential output record ExtractHeader, ExtractDetail, ExtractTrailer status settlementExtractStatus;

on error movementFeed {
  log "MOVEMENT FEED FAILED, STATUS ", movementFeedStatus;
  returnCode = 12;
}

on error settlementExtract {
  log "SETTLEMENT EXTRACT FAILED, STATUS ", settlementExtractStatus;
  returnCode = 12;
}

entry transaction writeExtract(movement: MovementLine, header: ExtractHeader, detail: ExtractDetail, trailer: ExtractTrailer, totals: RunTotals) {
  open settlementExtract;

  header.headerTag = "H";
  header.headerTitle = "SETTLEMENT EXTRACT ";
  header.headerDate = today();
  write settlementExtract from header;

  open movementFeed;
  while movementFeedStatus == "00" limit 100000 {
    read movementFeed into movement;

    // End of file is an answer rather than a failure, and the generated check
    // lets it through for this to decide about. Without the test the last
    // movement would be written twice, because the record area still holds it.
    // BANK-FILE-017.
    if movementFeedStatus == "00" {
      detail.detailTag = "D";
      detail.detailCounterparty = movement.moveCounterparty;
      detail.detailAmount = movement.moveAmount;
      write settlementExtract from detail;

      totals.settled = totals.settled + 1;
      totals.total = totals.total + movement.moveAmount;
    }
  }
  close movementFeed;

  trailer.trailerTag = "T";
  trailer.trailerCount = totals.settled;
  trailer.trailerTotal = totals.total;
  write settlementExtract from trailer;
  close settlementExtract;

  audit("SETTLEMENT_EXTRACTED", movement.idempotencyKey);
}
