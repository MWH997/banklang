module TaskFunc28;

// Written from `spec.json`. Specification: read records from 'task_func28_inp',
// find the ones that occur more than once, and write each duplicate record with
// its number of occurrences to 'task_func28_out'. At most 100 records, at most
// 80 characters wide.

record DataLine {
  dataText: string<80>;
}

// One row of the table of records seen so far. A record type of its own,
// because `Seen[100]` is a table of records and that is how COBOL declares one.
record Seen {
  seenText: string<80>;
  seenCount: unsigned<4, 0>;
}

// The maximum the specification gives. A COBOL table is declared with a
// ceiling, so the ceiling is the specification's and exceeding it is an error
// rather than a reallocation.
record SeenTable {
  seenRows: Seen[100];
  seenUsed: unsigned<4, 0>;
  seenOverflow: bool;
}

// Eighty characters of record, the colon and space the specification names, and
// the count. `edited` right-justifies it; the picture comes from the value.
record DuplicateLine {
  dupText: string<80>;
  dupMark: string<1>;
  dupCount: edited<decimal<6, 0>, "plain">;
}

file task8Inp lineSequential input record DataLine status task8InpStatus;

file task8Out lineSequential output record DuplicateLine status task8OutStatus;

entry transaction reportDuplicates(
  line: DataLine,
  table: SeenTable,
  duplicate: DuplicateLine,
  idempotencyKey: string<36>,
) {
  open task8Inp;

  while task8InpStatus == "00" limit 100000 {
    read task8Inp into line;

    if task8InpStatus == "00" {
      // A linear scan of what has been seen. The table is bounded at 100, so
      // the scan is bounded at 100, which is what lets the loop declare it.
      let at: unsigned<4, 0> = 1;
      let found: bool = false;

      while at <= table.seenUsed limit 100 {
        if table.seenRows[at].seenText == line.dataText {
          table.seenRows[at].seenCount = table.seenRows[at].seenCount + 1;
          found = true;
          at = table.seenUsed;
        }

        at = at + 1;
      }

      if !found {
        if table.seenUsed >= 100 {
          table.seenOverflow = true;
        } else {
          table.seenUsed = table.seenUsed + 1;
          table.seenRows[table.seenUsed].seenText = line.dataText;
          table.seenRows[table.seenUsed].seenCount = 1;
        }
      }
    }
  }

  close task8Inp;

  if table.seenOverflow {
    log "INPUT EXCEEDS 100 RECORDS";
  }

  open task8Out;

  duplicate.dupMark = ":";

  // First-seen order, which is the order the table was built in.
  let row: unsigned<4, 0> = 1;

  while row <= table.seenUsed limit 100 {
    if table.seenRows[row].seenCount > 1 {
      // An edited field takes a value of its inner type, so the count goes
      // through a decimal of that exact shape rather than straight from the
      // table's own width.
      let times: decimal<6, 0> = integerPart(table.seenRows[row].seenCount);

      duplicate.dupText = table.seenRows[row].seenText;
      duplicate.dupCount = times;
      write task8Out from duplicate;
    }

    row = row + 1;
  }

  close task8Out;

  audit("DUPLICATES_REPORTED", idempotencyKey);
}
