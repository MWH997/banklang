module TaskFunc34;

// Written from `spec.json`. Specification: read a sales-tax file of zip codes
// and tax rates from 'task_func34_inp1'; read customers (number, unit price,
// quantity, address, zip) from 'task_func34_inp2'; compute the subtotal, look
// the rate up by the customer's zip, work out the tax and the total; and write
// a formatted bill file to 'task_func34_out1'.
//
// As task_func_25, the bill file is what made this a language gap: a heading
// line, blank lines and detail lines are three shapes on one file, and a BankTS
// file used to carry one record description.

// Twelve characters for a nine-character line, and twenty-four for a
// forty-two-character one: both inputs end without a newline, and GnuCOBOL
// loses a final unterminated record that exactly fills the record area
// (divergence D23). Read as text and taken apart by position, because the
// fields are fixed-width between the commas.
record TaxLine {
  taxText: string<12>;
}

record CustomerLine {
  customerText: string<48>;
}

// The three shapes the bill file carries.
record BillHeading {
  headingText: string<98>;
}

record BillGap {
  gapText: string<1>;
}

record BillDetail {
  leftMargin: string<18>;
  billCustomer: string<5>;
  gapOne: string<10>;
  billPrice: string<6>;
  gapTwo: string<10>;
  billQuantity: edited<decimal<3, 0>, "plain">;
  gapThree: string<14>;
  billTax: edited<decimal<4, 2>, "plain">;
  gapFour: string<16>;
  billTotal: edited<decimal<5, 2>, "plain">;
}

// The tax table, held in storage because every customer looks a rate up in it.
record TaxTable {
  rateText: string<5>;
  zips: string<5>[50];
  rates: decimal<5, 3>[50];
  used: unsigned<3, 0>;
}

record Working {
  zip: string<5>;
  priceText: string<6>;
  rate: decimal<5, 3>;
  found: string<1>;
  index: unsigned<3, 0>;
  price: decimal<7, 2>;
  quantity: decimal<3, 0>;
  subtotal: decimal<9, 2>;
  taxAmount: decimal<9, 2>;
  total: decimal<9, 2>;
  taxDue: decimal<4, 2>;
  totalDue: decimal<5, 2>;
}

file taskInp1 lineSequential input record TaxLine status taskInp1Status;

file taskInp2 lineSequential input record CustomerLine status taskInp2Status;

file taskOut1
  lineSequential
  output
  record BillHeading, BillGap, BillDetail
  status taskOut1Status;

entry transaction billCustomers(
  taxLine: TaxLine,
  customer: CustomerLine,
  heading: BillHeading,
  gap: BillGap,
  detail: BillDetail,
  table: TaxTable,
  work: Working,
  idempotencyKey: string<36>,
) {
  // The rate is three digits of thousandths: `046` is 0.046, which is 4.6%.
  // `toNumber` reads the digits and takes the scale of what it is assigned to,
  // so `toNumber("046")` into a `decimal<5,3>` is forty-six, not forty-six
  // thousandths. The point goes in the text, where the data means it.
  open taskInp1;
  while taskInp1Status == "00" limit 50 {
    read taskInp1 into taxLine;
    if taskInp1Status == "00" {
      table.used = table.used + 1;
      table.zips[table.used] = substring(taxLine.taxText, 1, 5);
      table.rateText = concat("0.", substring(taxLine.taxText, 7, 3));
      table.rates[table.used] = toNumber(table.rateText);
    }
  }
  close taskInp1;

  open taskOut1;
  heading.headingText =
    "                  CUSTOMER       UNIT PRICE          QTY             SALES TAX               TOTAL";
  write taskOut1 from heading;
  gap.gapText = " ";
  write taskOut1 from gap;

  open taskInp2;
  while taskInp2Status == "00" limit 100000 {
    read taskInp2 into customer;
    if taskInp2Status == "00" {
      work.zip = substring(customer.customerText, 38, 5);
      work.rate = 0.000;
      work.found = "N";
      work.index = 0;
      while work.index < table.used limit 50 {
        work.index = work.index + 1;
        if table.zips[work.index] == work.zip {
          if work.found == "N" {
            work.rate = table.rates[work.index];
            work.found = "Y";
          }
        }
      }
      if work.found == "N" {
        log "NO TAX RATE FOR ZIP ", work.zip;
        raise "NO_RATE";
      }

      // `01299` is 012.99: three whole units and two decimals, with no decimal
      // point in the data. The printed column keeps its leading zero, which no
      // edited picture in this language produces, so the text is assembled from
      // the digits, and then read back as the number, which puts the point
      // where the data means it rather than dividing by a hundred.
      work.priceText = concat(
        substring(customer.customerText, 7, 3),
        ".",
        substring(customer.customerText, 10, 2)
      );
      work.price = toNumber(work.priceText);
      work.quantity = toNumber(substring(customer.customerText, 13, 3));
      work.subtotal = round(work.price * work.quantity, "DOWN");
      work.taxAmount = round(work.subtotal * work.rate, "DOWN");
      work.total = work.subtotal + work.taxAmount;
      work.taxDue = round(work.taxAmount, "DOWN");
      work.totalDue = round(work.total, "DOWN");

      // A blank line before every detail, which with the one written after the
      // heading gives the two blank lines the output contract shows between
      // the heading and the first bill and the one between each bill after it.
      write taskOut1 from gap;

      detail.leftMargin = "                  ";
      detail.billCustomer = substring(customer.customerText, 1, 5);
      detail.gapOne = "          ";
      detail.billPrice = work.priceText;
      detail.gapTwo = "          ";
      detail.billQuantity = work.quantity;
      detail.gapThree = "              ";
      detail.billTax = work.taxDue;
      detail.gapFour = "                ";
      detail.billTotal = work.totalDue;
      write taskOut1 from detail;
    }
  }
  close taskInp2;
  close taskOut1;

  audit("BILLS_WRITTEN", idempotencyKey);
}
