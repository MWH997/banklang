module TaskFunc16;

// Written from `spec.json`. Specification: read timestamps in
// 'YYYY-MM-DDThh:mm:ss.sss' form from 'task_func16_inp', average the difference
// in seconds between consecutive timestamps ignoring the date, and write the
// formatted average to 'task_func16_out'.

record StampLine {
  stampText: string<30>;
}

// Fifteen characters: eleven integer positions, a point and three decimals,
// which is what the output contract shows. `edited` renders it; the picture is
// generated from the value's own precision and scale.
record AverageLine {
  averageSeconds: edited<decimal<14, 3>, "plain">;
}

file task6Inp lineSequential input record StampLine status task6InpStatus;

file task6Out lineSequential output record AverageLine status task6OutStatus;

// The clock part of an ISO timestamp, as a count of seconds since midnight.
// The positions are fixed by the format the specification names, which is what
// lets `substring` take literal bounds.
function secondsOfDay(stampText: string<30>): decimal<9, 0> {
  let hours: decimal<9, 0> = integerPart(toNumber(substring(stampText, 12, 2)));
  let minutes: decimal<9, 0> = integerPart(
    toNumber(substring(stampText, 15, 2))
  );
  let seconds: decimal<9, 0> = integerPart(
    toNumber(substring(stampText, 18, 2))
  );

  return hours * 3600 + minutes * 60 + seconds;
}

entry transaction averageGap(
  line: StampLine,
  average: AverageLine,
  idempotencyKey: string<36>
) {
  open task6Inp;
  open task6Out;

  let previous: decimal<9, 0> = 0;
  let total: decimal<9, 0> = 0;
  let gaps: decimal<9, 0> = 0;
  let seen: decimal<9, 0> = 0;

  while task6InpStatus == "00" limit 100000 {
    read task6Inp into line;

    if task6InpStatus == "00" {
      let current: decimal<9, 0> = secondsOfDay(line.stampText);

      if seen > 0 {
        total = total + current - previous;
        gaps = gaps + 1;
      }

      previous = current;
      seen = seen + 1;
    }
  }

  // Fewer than two timestamps means no difference to average, and zero is the
  // honest answer rather than a division by nothing.
  // An edited field is a rendering and takes a value of its inner type, so the
  // quotient lands in a decimal of that exact shape first.
  let mean: decimal<14, 3> = 0.000;

  if gaps > 0 {
    mean = divide(total, gaps, "HALF_EVEN");
  }

  average.averageSeconds = mean;

  write task6Out from average;

  close task6Out;
  close task6Inp;

  audit("GAP_AVERAGED", idempotencyKey);
}
