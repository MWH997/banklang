module ZunitTestedPosting;

type MoneyBDT = currency<"BDT", 18, 2>;

// A posting the job is told to make. Everything this program does is decided by
// its PARM, which is what lets a generated zUnit case pin it down exactly: a
// program that reads a dataset is testable too, but then what it posts depends
// on the dataset rather than on the test.
entry transaction postOne(account: string<16>, amount: MoneyBDT, idempotencyKey: string<36>) {
  debit(account, amount);
  credit("SUSPENSE", amount);
  audit("POSTED", idempotencyKey);
}

// `bankc zunit examples/zunit-tested-posting` writes the three artifacts this
// becomes: the configuration, the test case program, and the job that runs
// them. Nothing of it reaches the COBOL that ships.
//
// What a test may say is what a zUnit driver can see. It runs in its own
// program, so this program's WORKING-STORAGE is not reachable. `given` is the
// PARM the step is started with, and `expect` is the calls it makes, in order.
test postsBothLegs for postOne {
  given account = "0001234567890123";
  given amount = 100.00;
  given idempotencyKey = "IDEM-0001";
  expect debit("0001234567890123", 100.00);
  expect credit("SUSPENSE", 100.00);
  expect audit("POSTED", "IDEM-0001");
}
