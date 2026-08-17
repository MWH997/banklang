module TaskFunc14;

// Written from `spec.json`. Specification: read the CSV 'task_func14_inp',
// extract the records whose date matches the current date, sort those by value
// ascending, and write them to 'task_func14_out'.
//
// The fixture's dates are all in 2024 and the expected output is the header
// alone, which is what a run on any later day produces. That the answer depends
// on the day the job runs is the task's own design, not this implementation's.

record CsvLine {
  csvText: string<20>;
}

record CsvParts {
  partDate: string<10>;
  partValue: string<10>;
}

// The bridge from text to a calendar value, and the reason this task is
// expressible at all. BankTS's `date` is a closed type: `today()` and
// `accept date` produce one, two of them compare, and nothing converts a number
// or a string into one. A `date` redefining eight characters is how COBOL has
// always done it, the same bytes read as a date, so a date parsed out of a
// feed can be compared with the clock.
record Stamp {
  stampDigits: string<8>;
  stampDate: date redefines stampDigits;
  stampToday: date;
}

record Row {
  rowValue: decimal<9, 0>;
  rowText: string<20>;
}

record RowTable {
  rowsHeld: Row[100];
  rowsUsed: decimal<9, 0>;
}

file task4Inp lineSequential input record CsvLine status task4InpStatus;

file task4Out lineSequential output record CsvLine status task4OutStatus;

entry transaction todaysRows(
  line: CsvLine,
  parts: CsvParts,
  stamp: Stamp,
  table: RowTable,
  idempotencyKey: string<36>,
) {
  open task4Inp;
  open task4Out;

  stamp.stampToday = today();

  // The first record is the column heading, which the output contract carries
  // through unchanged and which is not a row to be matched.
  read task4Inp into line;

  if task4InpStatus == "00" {
    write task4Out from line;
  }

  while task4InpStatus == "00" limit 100000 {
    read task4Inp into line;

    if task4InpStatus == "00" {
      split line.csvText by "," into parts.partDate, parts.partValue;

      stamp.stampDigits = concat(
        substring(parts.partDate, 1, 4),
        substring(parts.partDate, 6, 2),
        substring(parts.partDate, 9, 2)
      );

      if stamp.stampDate == stamp.stampToday {
        if table.rowsUsed < 100 {
          table.rowsUsed = table.rowsUsed + 1;
          table.rowsHeld[table.rowsUsed].rowValue = integerPart(
            toNumber(parts.partValue)
          );
          table.rowsHeld[table.rowsUsed].rowText = line.csvText;
        }
      }
    }
  }

  close task4Inp;

  // A selection sort over the kept rows. The table is bounded at a hundred, so
  // both loops are, which is what lets them be written at all. `sort` is the
  // statement for ordering a file, and these rows are in storage.
  let outer: decimal<9, 0> = 1;

  while outer < table.rowsUsed limit 100 {
    let inner: decimal<9, 0> = outer + 1;

    while inner <= table.rowsUsed limit 100 {
      if table.rowsHeld[inner].rowValue < table.rowsHeld[outer].rowValue {
        let heldValue: decimal<9, 0> = table.rowsHeld[outer].rowValue;
        let heldText: string<20> = table.rowsHeld[outer].rowText;

        table.rowsHeld[outer].rowValue = table.rowsHeld[inner].rowValue;
        table.rowsHeld[outer].rowText = table.rowsHeld[inner].rowText;
        table.rowsHeld[inner].rowValue = heldValue;
        table.rowsHeld[inner].rowText = heldText;
      }

      inner = inner + 1;
    }

    outer = outer + 1;
  }

  let at: decimal<9, 0> = 1;

  while at <= table.rowsUsed limit 100 {
    line.csvText = table.rowsHeld[at].rowText;
    write task4Out from line;
    at = at + 1;
  }

  close task4Out;

  audit("TODAYS_ROWS", idempotencyKey);
}
