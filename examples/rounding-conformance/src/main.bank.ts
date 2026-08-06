module RoundingConformance;

type MoneyBDT = currency<"BDT", 18, 2>;

type Rate = decimal<9, 4>;

// Every rounding mode over the same value, so the seven answers can be read
// side by side.
//
// Enterprise COBOL has one rounding phrase. `ROUNDED` is half-up away from
// zero, there is no `MODE IS` sub-phrase, and `NEAREST-EVEN` is not a word the
// Language Reference's reserved word table contains in any of its three
// columns. Five of the seven modes below are therefore arithmetic this compiler
// writes out, and the generated COBOL for each is worth reading beside the
// source it came from.
record RoundingSample {
  amount: MoneyBDT;
  rate: Rate;
  idempotencyKey: string<36>;
}

record RoundedAnswers {
  halfUp: MoneyBDT;
  halfEven: MoneyBDT;
  halfDown: MoneyBDT;
  awayFromZero: MoneyBDT;
  towardZero: MoneyBDT;
  ceilingValue: MoneyBDT;
  floorValue: MoneyBDT;
  modesShown: unsigned<9, 0>;
}

// `HALF_UP` is the phrase itself, so nothing is generated around it.
function halfUpOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "HALF_UP");
}

// Banker's rounding: on an exact tie, to the even last digit. The generated
// sequence truncates, takes the excess as `expression - truncated` in COBOL's
// own intermediate result, and steps one unit in the last place when the parity
// test says so.
function halfEvenOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "HALF_EVEN");
}

// The tie goes the other way: toward zero, not away from it.
function halfDownOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "HALF_DOWN");
}

// Away from zero whenever anything at all was discarded.
function upOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "UP");
}

// Toward zero, which is what leaving `ROUNDED` off does.
function downOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "DOWN");
}

// Toward positive infinity. `UP` and `CEILING` agree on a positive value and
// disagree on a negative one, which is why the run below does both signs — one
// sample would make them look like synonyms.
function ceilingOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "CEILING");
}

function floorOf(amount: MoneyBDT, rate: Rate): MoneyBDT {
  return round(amount * rate, "FLOOR");
}

// Returns the number of modes it filled in, because every routine in this
// language returns something — there is no `void`, and a paragraph that falls
// off its own end is the thing the single-exit rule exists to prevent.
function allModes(sample: RoundingSample, answers: RoundedAnswers): unsigned<9, 0> {
  answers.halfUp = halfUpOf(sample.amount, sample.rate);
  answers.halfEven = halfEvenOf(sample.amount, sample.rate);
  answers.halfDown = halfDownOf(sample.amount, sample.rate);
  answers.awayFromZero = upOf(sample.amount, sample.rate);
  answers.towardZero = downOf(sample.amount, sample.rate);
  answers.ceilingValue = ceilingOf(sample.amount, sample.rate);
  answers.floorValue = floorOf(sample.amount, sample.rate);

  log "HALF_UP   ", answers.halfUp;
  log "HALF_EVEN ", answers.halfEven;
  log "HALF_DOWN ", answers.halfDown;
  log "UP        ", answers.awayFromZero;
  log "DOWN      ", answers.towardZero;
  log "CEILING   ", answers.ceilingValue;
  log "FLOOR     ", answers.floorValue;

  return 7;
}

entry transaction showRounding(sample: RoundingSample, answers: RoundedAnswers) {
  // One unit at a rate of 1.0050 is 1.005000 exactly: half a unit past the
  // second decimal place, which is the only place the seven modes disagree.
  // The product is where the tie has to be made — a `round` of something
  // already at the receiver's scale has nothing to decide, and the compiler
  // would emit a plain MOVE.
  sample.amount = 1.00;
  sample.rate = 1.0050;
  log "TIE AT +1.005";
  answers.modesShown = allModes(sample, answers);

  // The same tie, negative. HALF_UP reaches -1.01 and HALF_DOWN -1.00; CEILING
  // stops at -1.00 where UP goes on to -1.01. On the positive tie those two
  // pairs agreed, which is exactly why one sample is not enough.
  sample.amount = 0.00 - 1.00;
  log "TIE AT -1.005";
  answers.modesShown = allModes(sample, answers);

  // Not a tie: 1.002000, two thousandths past, which only UP and CEILING carry
  // up and every half-mode leaves at 1.00.
  sample.amount = 1.00;
  sample.rate = 1.0020;
  log "PAST +1.002";
  answers.modesShown = allModes(sample, answers);

  audit("ROUNDING_SHOWN", sample.idempotencyKey);
}
