module TaskFunc17;

// Written from `spec.json`. Specification: read phone numbers from 'input.ps',
// give each a country code from its first digit ('2' is India (+91), '1' is
// the UK (+44)) and write them to 'output.ps' as `+XX (XXX) XXX XXXX`.

// Twelve characters for a ten-digit number, and the two spare are the point.
// `input.ps` ends without a newline, and GnuCOBOL loses an unterminated final
// record whose length exactly fills the record area, which is divergence D23. A record
// wider than the longest line is the documented way round it, and is what a
// program reading somebody else's feed should declare anyway.
record PhoneLine {
  phoneDigits: string<12>;
}

// The output layout, as a record rather than a concatenation. Every piece has a
// fixed width and a fixed position, which is what a record describes; building
// the same 18 characters with `concat` would say less and check nothing.
record FormattedLine {
  fmtPlus: string<1>;
  fmtCountry: string<2>;
  fmtSpaceOne: string<1>;
  fmtOpen: string<1>;
  fmtArea: string<3>;
  fmtClose: string<1>;
  fmtSpaceTwo: string<1>;
  fmtExchange: string<3>;
  fmtSpaceThree: string<1>;
  fmtSubscriber: string<4>;
}

file inputPs lineSequential input record PhoneLine status inputPsStatus;

file outputPs lineSequential output record FormattedLine status outputPsStatus;

// The specification gives two countries and nothing else, so anything that is
// not India is the UK. A third leading digit would be a change to the contract
// rather than a case to guess at.
function countryOf(phoneDigits: string<12>): string<2> {
  let leading: string<1> = substring(phoneDigits, 1, 1);

  if leading == "2" {
    return "91";
  } else {
    return "44";
  }
}

entry transaction formatNumbers(
  line: PhoneLine,
  formatted: FormattedLine,
  counts: PhoneCount,
  idempotencyKey: string<36>,
) {
  open inputPs;
  open outputPs;

  formatted.fmtPlus = "+";
  formatted.fmtSpaceOne = " ";
  formatted.fmtOpen = "(";
  formatted.fmtClose = ")";
  formatted.fmtSpaceTwo = " ";
  formatted.fmtSpaceThree = " ";

  while inputPsStatus == "00" limit 100000 {
    read inputPs into line;

    if inputPsStatus == "00" {
      formatted.fmtCountry = countryOf(line.phoneDigits);
      formatted.fmtArea = substring(line.phoneDigits, 1, 3);
      formatted.fmtExchange = substring(line.phoneDigits, 4, 3);
      formatted.fmtSubscriber = substring(line.phoneDigits, 7, 4);
      write outputPs from formatted;
      counts.phonesSeen = counts.phonesSeen + 1;
    }
  }

  close outputPs;
  close inputPs;

  log "NUMBERS PROCESSED ", counts.phonesSeen;

  audit("NUMBERS_FORMATTED", idempotencyKey);
}

record PhoneCount {
  phonesSeen: unsigned<9, 0>;
}
