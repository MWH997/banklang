module TaskFunc43;

// Written from `spec.json` — the task's prose, its input file and its expected
// output file. The benchmark's own COBOL is in `validation/sealed/`, which is
// gitignored and which the authoring path does not read.
//
// The specification: read numbers from 'input.txt', decide which are prime, and
// write the primes to 'output.txt'.

// Five digits, which is the width the input file uses. `unsigned` rather than
// `decimal`, because a line-sequential record may hold only DISPLAY items and
// `decimal` is packed — `BANK-FILE-014` if you forget.
record NumberLine {
  numberValue: unsigned<5, 0>;
}

file inputTxt lineSequential input record NumberLine status inputTxtStatus;

file outputTxt lineSequential output record NumberLine status outputTxtStatus;

// Trial division to the square root, which is the whole of the arithmetic here.
// One and everything below it are not prime; two is, and is the only even one.
function isPrime(candidate: unsigned<5, 0>): bool {
  let divisor: unsigned<5, 0> = 2;
  let divisible: bool = false;

  while divisor * divisor <= candidate limit 400 {
    if mod(candidate, divisor) == 0 {
      divisible = true;
      // Ends the loop without a second exit: the bound is the condition.
      divisor = candidate;
    } else {
      divisor = divisor + 1;
    }
  }

  if candidate < 2 {
    return false;
  } else {
    if divisible {
      return false;
    } else {
      return true;
    }
  }
}

entry transaction findPrimes(line: NumberLine, idempotencyKey: string<36>) {
  open inputTxt;
  open outputTxt;

  // The bound stops a corrupt file spinning the job; the status ends the loop.
  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      if isPrime(line.numberValue) {
        write outputTxt from line;
      }
    }
  }

  close outputTxt;
  close inputTxt;

  audit("PRIMES_WRITTEN", idempotencyKey);
}
