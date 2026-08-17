module TaskFunc37;

// Written from `spec.json`. Specification: read records from 'task_func37_inp',
// drop the ones whose quantity is not positive, sort the rest ascending on the
// department field, reformat them, and write them to 'task_func37_out', using
// an input procedure to filter and an output procedure to reformat.

// Twenty characters for a fourteen character record: the input ends without a
// newline, and a record that exactly fills one loses it under GnuCOBOL
// (divergence D23).
record RawLine {
  rawPart: string<5>;
  rawCommaOne: string<1>;
  rawQuantity: unsigned<5, 0>;
  rawCommaTwo: string<1>;
  rawDepartment: string<2>;
  rawFiller: string<6>;
}

// The same three fields in the order the output contract puts them.
record SortedLine {
  outDepartment: string<2>;
  outCommaOne: string<1>;
  outPart: string<5>;
  outCommaTwo: string<1>;
  outQuantity: unsigned<5, 0>;
}

file task7Inp lineSequential input record RawLine status task7InpStatus;

file task7Out lineSequential output record SortedLine status task7OutStatus;

entry transaction reorderParts(
  raw: RawLine,
  sorted: SortedLine,
  idempotencyKey: string<36>,
) {
  // The record the sort moves is the one it reads, so the keys and both
  // procedure variables are `RawLine`; the destination holds `SortedLine`
  // because the output procedure writes it rather than `GIVING`.
  sort task7Inp into task7Out on rawDepartment input raw {
    if raw.rawQuantity > 0 {
      release raw;
    }
  } output raw {
    sorted.outDepartment = raw.rawDepartment;
    sorted.outCommaOne = ",";
    sorted.outPart = raw.rawPart;
    sorted.outCommaTwo = ",";
    sorted.outQuantity = raw.rawQuantity;
    write task7Out from sorted;
  };

  audit("PARTS_REORDERED", idempotencyKey);
}
