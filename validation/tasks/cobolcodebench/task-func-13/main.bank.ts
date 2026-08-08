module TaskFunc13;

// Written from `spec.json`. Specification: read customer names from
// 'input.txt', reject any name containing a numeric character, sort the rest
// ascending, and write them to 'output.txt'.

record NameLine {
  custName: string<20>;
}

record Counts {
  readNames: unsigned<9, 0>;
  invalidNames: unsigned<9, 0>;
}

file inputTxt lineSequential input record NameLine status inputTxtStatus;

file outputTxt lineSequential output record NameLine status outputTxtStatus;

// True when the name holds no digit.
//
// `isNumeric` asks whether the whole field is a number, which is the opposite
// question. `replaceChars` is INSPECT CONVERTING: mapping every digit to a
// character no name contains and comparing against the original says whether
// any digit was there, in one statement rather than ten counts.
function hasNoDigit(custName: string<20>): bool {
  let folded: string<20> = replaceChars(custName, "0123456789", "??????????");
  return folded == custName;
}

entry transaction sortValidNames(
  line: NameLine,
  counts: Counts,
  idempotencyKey: string<36>,
) {
  // The sort reads the file, the input procedure sees each record, and only the
  // names that pass are released — so the ordering happens over valid names
  // alone. `GIVING` writes the output file, which is why nothing opens it here.
  sort inputTxt into outputTxt on custName input line {
    counts.readNames = counts.readNames + 1;

    if hasNoDigit(line.custName) {
      release line;
    } else {
      counts.invalidNames = counts.invalidNames + 1;
    }
  };

  log "RECORDS READ ", counts.readNames;
  log "INVALID NAMES ", counts.invalidNames;

  audit("NAMES_SORTED", idempotencyKey);
}
