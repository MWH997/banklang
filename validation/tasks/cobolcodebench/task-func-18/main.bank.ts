module TaskFunc18;

// Written from `spec.json`. Specification: read customer records of name,
// street, city, state and zip from 'task_func18_inp'; write mailing labels with
// the address duplicated side by side, each label separated by a line of
// dashes.

// Seventy characters for a sixty-three character record: the input's last line
// has no newline, and a record that exactly fills one loses it under GnuCOBOL
// (divergence D23).
record CustomerLine {
  cusName: string<20>;
  cusCommaOne: string<1>;
  cusStreet: string<20>;
  cusCommaTwo: string<1>;
  cusCity: string<10>;
  cusCommaThree: string<1>;
  cusState: string<3>;
  cusCommaFour: string<1>;
  cusZip: string<5>;
  cusFiller: string<8>;
}

// One record for every line the label file holds, because a file has one record
// description and the rule, the name line and the address line are all lines.
// Line sequential drops the trailing blanks, so a shorter line is still short.
record LabelLine {
  labText: string<80>;
}

file task8Inp lineSequential input record CustomerLine status task8InpStatus;

file task8Out lineSequential output record LabelLine status task8OutStatus;

entry transaction printLabels(
  customer: CustomerLine,
  label: LabelLine,
  idempotencyKey: string<36>
) {
  open task8Inp;
  open task8Out;

  // The label is two copies of the address thirty-six characters apart, so each
  // line is the field, the padding that carries it to column 37, the field
  // again, and the padding that fills the record. `concat` adds the widths, so
  // the compiler checks the arithmetic of the layout rather than a reader.
  while task8InpStatus == "00" limit 100000 {
    read task8Inp into customer;

    if task8InpStatus == "00" {
      label.labText =
        "--------------------------------------------------------------------------------";
      write task8Out from label;

      label.labText = concat(
        customer.cusName,
        "                ",
        customer.cusName,
        "                        "
      );
      write task8Out from label;

      label.labText = concat(
        customer.cusStreet,
        "                ",
        customer.cusStreet,
        "                        "
      );
      write task8Out from label;

      // The state field carries a trailing space between the commas of the
      // input and does not carry it into the label, so two characters of it are
      // taken rather than the field.
      label.labText = concat(
        customer.cusCity,
        ",",
        substring(customer.cusState, 1, 2),
        ",",
        customer.cusZip,
        "                 ",
        customer.cusCity,
        ",",
        substring(customer.cusState, 1, 2),
        ",",
        customer.cusZip,
        "                         "
      );
      write task8Out from label;
    }
  }

  label.labText =
    "--------------------------------------------------------------------------------";
  write task8Out from label;

  close task8Out;
  close task8Inp;

  audit("LABELS_PRINTED", idempotencyKey);
}
