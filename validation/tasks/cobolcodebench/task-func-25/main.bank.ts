module TaskFunc25;

// Written from `spec.json`. Specification: read a column name — Age, Salary or
// Experience — from 'task_func25_inp1'; read employee records from
// 'task_func25_inp2'; take that column's values; and write their sum, mean,
// minimum and maximum to 'task_func25_out' as CSV.
//
// The output file is what made this task a language gap until now: a heading
// line of text and a detail line of four right-justified numbers cannot share
// one record description, and an `edited` field renders a number rather than
// holding text. A file carrying two layouts is what COBOL does here and what
// BankTS now expresses — the write chooses between them by the record's type.

// The input line, read as text and taken apart by position.
//
// Not as fields: the first line of the file is the column heading
// `Age,Salary,Experience`, whose bytes in the numeric positions are letters.
// Reading that through `unsigned` fields moves letters into zoned items, which
// is undefined on the target and a data exception in practice (divergence
// D24). Twenty-four characters because the heading is twenty-one and a record
// shorter than the line it reads loses the rest of it.
record StatLine {
  lineText: string<24>;
}

// Twelve characters for the ten of `Experience`. The file holds the one word
// and ends without a newline, and GnuCOBOL loses a final unterminated record
// that exactly fills the record area — divergence D23. A record wider than the
// longest column name is delivered by both engines.
record ColumnName {
  wanted: string<12>;
}

record StatHeading {
  headingText: string<16>;
}

record StatDetail {
  sumOut: edited<decimal<12, 2>, "plain">;
  commaOne: string<1>;
  meanOut: edited<decimal<12, 2>, "plain">;
  commaTwo: string<1>;
  minOut: edited<decimal<10, 0>, "plain">;
  commaThree: string<1>;
  maxOut: edited<decimal<10, 0>, "plain">;
}

record Totals {
  seen: unsigned<9, 0>;
  total: decimal<12, 2>;
  smallest: decimal<12, 2>;
  largest: decimal<12, 2>;
  // The minimum and maximum are written without decimals, and narrowing a
  // scale is a rounding decision, so the narrowing has a name and a mode
  // rather than happening inside the assignment to the edited field.
  smallestWhole: decimal<10, 0>;
  largestWhole: decimal<10, 0>;
  value: decimal<12, 2>;
  mean: decimal<12, 2>;
  headerSeen: string<1>;
  known: string<1>;
}

file taskInp1 lineSequential input record ColumnName status taskInp1Status;

file taskInp2 lineSequential input record StatLine status taskInp2Status;

file task5Out
  lineSequential
  output
  record StatHeading, StatDetail
  status task5OutStatus;

// The value of the requested column, from one record's text.
//
// The columns are fixed-width and comma-separated: age at 1, salary at 5,
// experience at 16. `toNumber` reads the digits; a column name the
// specification does not list leaves the result at zero and is reported by the
// caller rather than silently treated as Age.
function columnValue(lineText: string<24>, wanted: string<12>): decimal<12, 2> {
  if wanted == "Age" {
    return toNumber(substring(lineText, 1, 3));
  } else {
    if wanted == "Salary" {
      return toNumber(substring(lineText, 5, 10));
    } else {
      return toNumber(substring(lineText, 16, 2));
    }
  }
}

entry transaction summariseColumn(
  column: ColumnName,
  line: StatLine,
  heading: StatHeading,
  detail: StatDetail,
  counts: Totals,
  idempotencyKey: string<36>,
) {
  open taskInp1;
  read taskInp1 into column;
  if taskInp1Status != "00" {
    log "COLUMN NAME NOT READ ", taskInp1Status;
    raise "NO_COLUMN";
  }
  close taskInp1;

  if column.wanted == "Age" {
    counts.known = "Y";
  }
  if column.wanted == "Salary" {
    counts.known = "Y";
  }
  if column.wanted == "Experience" {
    counts.known = "Y";
  }
  if counts.known != "Y" {
    log "INVALID COLUMN ", column.wanted;
    raise "BAD_COLUMN";
  }

  open taskInp2;
  counts.headerSeen = "N";
  while taskInp2Status == "00" limit 100000 {
    read taskInp2 into line;
    if taskInp2Status == "00" {
      // The first line names the columns rather than holding a record.
      if counts.headerSeen == "N" {
        counts.headerSeen = "Y";
      } else {
        counts.value = columnValue(line.lineText, column.wanted);
        counts.total = counts.total + counts.value;
        if counts.seen == 0 {
          counts.smallest = counts.value;
          counts.largest = counts.value;
        } else {
          if counts.value < counts.smallest {
            counts.smallest = counts.value;
          }
          if counts.value > counts.largest {
            counts.largest = counts.value;
          }
        }
        counts.seen = counts.seen + 1;
      }
    }
  }
  close taskInp2;

  if counts.seen == 0 {
    log "NO EMPLOYEE RECORDS ", counts.seen;
    raise "NO_RECORDS";
  }

  counts.mean = divide(counts.total, counts.seen, "HALF_UP");

  open task5Out;
  heading.headingText = "Sum,Mean,Min,Max";
  write task5Out from heading;

  detail.sumOut = counts.total;
  detail.commaOne = ",";
  detail.meanOut = counts.mean;
  detail.commaTwo = ",";
  counts.smallestWhole = round(counts.smallest, "DOWN");
  detail.minOut = counts.smallestWhole;
  detail.commaThree = ",";
  counts.largestWhole = round(counts.largest, "DOWN");
  detail.maxOut = counts.largestWhole;
  write task5Out from detail;
  close task5Out;

  audit("COLUMN_SUMMARISED", idempotencyKey);
}
