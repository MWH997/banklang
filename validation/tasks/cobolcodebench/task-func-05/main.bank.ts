module TaskFunc05;

// Written from `spec.json`: the prose, the input file and the expected output.
// The benchmark's own COBOL is in the gitignored `validation/sealed/`, which the
// authoring path does not read.
//
// Specification: read records of a filename and a status from 'input.txt', and
// write the filename to 'output.txt' where the status is 'processed'.

// The input is a fixed-width record, so it is declared as one rather than
// picked apart with offsets. The status column starts at 21 in the file.
record StatusLine {
  lineName: string<20>;
  lineStatus: string<13>;
}

record NameLine {
  outName: string<20>;
}

file inputTxt lineSequential input record StatusLine status inputTxtStatus;

file outputTxt lineSequential output record NameLine status outputTxtStatus;

// `not processed` also contains `processed`, so the test is equality against
// the whole field rather than a search for the word.
function isProcessed(lineStatus: string<13>): bool {
  return lineStatus == "processed";
}

entry transaction selectProcessed(
  line: StatusLine,
  out: NameLine,
  idempotencyKey: string<36>,
) {
  open inputTxt;
  open outputTxt;

  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      if isProcessed(line.lineStatus) {
        out.outName = line.lineName;
        write outputTxt from out;
      }
    }
  }

  close outputTxt;
  close inputTxt;

  audit("PROCESSED_SELECTED", idempotencyKey);
}
