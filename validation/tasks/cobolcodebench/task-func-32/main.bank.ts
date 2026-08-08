module TaskFunc32;

// Written from `spec.json`. Specification: read vehicle type and speed records
// from 'input.txt', accumulate a total and a count per type, and write each
// type with its average speed to 'output.txt'.

// Thirty characters for a twenty-three character record: the input's last line
// has no newline, and a record that exactly fills one loses it under GnuCOBOL
// (divergence D23). The speed is three digits holding tenths, which is what
// makes 355 read as 35.5 and the fixture's averages come out exact.
record SpeedLine {
  vehType: string<20>;
  vehTenths: unsigned<3, 0>;
  vehFiller: string<7>;
}

record Kind {
  kindType: string<20>;
  kindTenths: unsigned<9, 0>;
  kindCount: unsigned<9, 0>;
}

record KindTable {
  kindRows: Kind[20];
  kindUsed: unsigned<9, 0>;
}

record AverageLine {
  outType: string<20>;
  outAverage: edited<decimal<4, 2>, "plain">;
}

file inputTxt lineSequential input record SpeedLine status inputTxtStatus;

file outputTxt lineSequential output record AverageLine status outputTxtStatus;

entry transaction averageSpeeds(
  line: SpeedLine,
  table: KindTable,
  average: AverageLine,
  idempotencyKey: string<36>,
) {
  open inputTxt;

  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      let at: unsigned<9, 0> = 1;
      let found: bool = false;

      while at <= table.kindUsed limit 20 {
        if table.kindRows[at].kindType == line.vehType {
          // Arithmetic in BankTS keeps the operands' own width, so the
          // three-digit reading is widened to the accumulator's shape before it
          // is added rather than being allowed to fit.
          let reading: decimal<9, 0> = integerPart(line.vehTenths);

          table.kindRows[at].kindTenths = integerPart(
            table.kindRows[at].kindTenths + reading
          );
          table.kindRows[at].kindCount = table.kindRows[at].kindCount + 1;
          found = true;
          at = table.kindUsed;
        }

        at = at + 1;
      }

      if !found {
        if table.kindUsed < 20 {
          table.kindUsed = table.kindUsed + 1;
          table.kindRows[table.kindUsed].kindType = line.vehType;
          table.kindRows[table.kindUsed].kindTenths = integerPart(
            line.vehTenths
          );
          table.kindRows[table.kindUsed].kindCount = 1;
        }
      }
    }
  }

  close inputTxt;

  open outputTxt;

  let row: unsigned<9, 0> = 1;

  while row <= table.kindUsed limit 20 {
    // The total is in tenths and the divisor is the count, so the average is
    // the total over ten times the count. Every average in the fixture is
    // exact at two places; the mode is stated because the compiler requires
    // one and because the day one is not exact somebody has to have decided.
    let total: decimal<9, 0> = integerPart(table.kindRows[row].kindTenths);
    let scaled: decimal<9, 0> = table.kindRows[row].kindCount * 10;
    let mean: decimal<4, 2> = divide(total, scaled, "HALF_EVEN");

    average.outType = table.kindRows[row].kindType;
    average.outAverage = mean;
    write outputTxt from average;

    row = row + 1;
  }

  close outputTxt;

  audit("SPEEDS_AVERAGED", idempotencyKey);
}
