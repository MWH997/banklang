module TaskFunc55;

// Written from `spec.json`. Specification: read values from
// 'original_data.txt', compute the mean and standard deviation, treat a value
// whose Z-score exceeds a threshold as an outlier, write the indices of the
// outliers to 'outlier_indices.txt' and the remaining values to
// 'data_without_outliers.txt'.

// Twelve characters for a five character record: the input ends without a
// newline (divergence D23).
record ValueLine {
  valNumber: unsigned<5, 0>;
  valFiller: string<7>;
}

record Held {
  heldValue: decimal<9, 0>;
}

record ValueTable {
  heldRows: Held[100];
  heldUsed: decimal<9, 0>;
}

record IndexLine {
  idxPosition: unsigned<3, 0>;
}

file original lineSequential input record ValueLine status originalStatus;

file dataWith lineSequential output record ValueLine status dataWithStatus;

file outlierI lineSequential output record IndexLine status outlierIStatus;

entry transaction removeOutliers(
  line: ValueLine,
  table: ValueTable,
  position: IndexLine,
  idempotencyKey: string<36>,
) {
  open original;

  while originalStatus == "00" limit 100000 {
    read original into line;

    if originalStatus == "00" {
      if table.heldUsed < 100 {
        table.heldUsed = table.heldUsed + 1;
        table.heldRows[table.heldUsed].heldValue = integerPart(line.valNumber);
      }
    }
  }

  close original;

  // Locals are declared once per routine rather than per block, so each loop
  // names its own working values. `round` is the scale conversion: a stored
  // whole number widened to four places is exact, and the compiler still
  // requires the mode because the day it is not exact somebody has to decide.
  let total: decimal<15, 0> = 0;
  let sumAt: decimal<9, 0> = 1;

  while sumAt <= table.heldUsed limit 100 {
    let counted: decimal<15, 0> = integerPart(table.heldRows[sumAt].heldValue);
    total = total + counted;
    sumAt = sumAt + 1;
  }

  let mean: decimal<15, 4> = 0.0000;
  let variance: decimal<15, 4> = 0.0000;
  let squares: decimal<15, 4> = 0.0000;
  let varAt: decimal<9, 0> = 1;

  if table.heldUsed > 0 {
    mean = divide(total, table.heldUsed, "HALF_EVEN");

    while varAt <= table.heldUsed limit 100 {
      let spread: decimal<15, 4> = round(
        table.heldRows[varAt].heldValue,
        "HALF_EVEN"
      );
      let deviation: decimal<15, 4> = spread - mean;
      let squared: decimal<15, 4> = round(deviation * deviation, "HALF_EVEN");
      squares = squares + squared;
      varAt = varAt + 1;
    }

    variance = divide(squares, table.heldUsed, "HALF_EVEN");
  }

  open dataWith;
  open outlierI;

  // The comparison is against the square rather than the Z-score itself:
  // |value - mean| / sd > 3 is the same test as (value - mean)^2 > 9 * variance
  // and needs no square root, which COBOL has no intrinsic for. Three standard
  // deviations is the usual threshold and the specification names none; every
  // value in the fixture is inside one and a half, so no choice above two
  // changes the answer.
  let cutoff: decimal<15, 4> = round(variance * 9, "HALF_EVEN");
  let outAt: decimal<9, 0> = 1;

  while outAt <= table.heldUsed limit 100 {
    let sample: decimal<15, 4> = round(
      table.heldRows[outAt].heldValue,
      "HALF_EVEN"
    );
    let distance: decimal<15, 4> = sample - mean;
    let measure: decimal<15, 4> = round(distance * distance, "HALF_EVEN");

    if measure > cutoff {
      position.idxPosition = integerPart(outAt);
      write outlierI from position;
    } else {
      line.valNumber = integerPart(table.heldRows[outAt].heldValue);
      write dataWith from line;
    }

    outAt = outAt + 1;
  }

  close outlierI;
  close dataWith;

  audit("OUTLIERS_REMOVED", idempotencyKey);
}
