module TaskFunc22;

// Written from `spec.json`. Specification: read student records of a name,
// marks and height from 'input.txt'; write the student with the highest marks
// to 'output-marks.txt' and the one with the greatest height to
// 'output-height.txt'.

// The input is fixed-width: twenty characters of name, three digits of marks,
// three of height. Declared as a record rather than picked apart with offsets.
record StudentLine {
  studentName: string<20>;
  studentMarks: unsigned<3, 0>;
  studentHeight: unsigned<3, 0>;
}

// Each answer is a name and the one number it was chosen for.
record MarksLine {
  marksName: string<20>;
  marksValue: unsigned<3, 0>;
}

record HeightLine {
  heightName: string<20>;
  heightValue: unsigned<3, 0>;
}

file inputTxt lineSequential input record StudentLine status inputTxtStatus;

file outputMarksTxt lineSequential output record MarksLine status outputMarksTxtStatus;

file outputHeightTxt lineSequential output record HeightLine status outputHeightTxtStatus;

entry transaction findExtremes(
  line: StudentLine,
  best: MarksLine,
  tallest: HeightLine,
  idempotencyKey: string<36>,
) {
  open inputTxt;
  open outputMarksTxt;
  open outputHeightTxt;

  // Both running maxima start at zero, which every real mark and height
  // exceeds. A file with no records leaves them at zero and writes a blank
  // name, which is the honest answer to "who scored highest" over nobody.
  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      if line.studentMarks > best.marksValue {
        best.marksName = line.studentName;
        best.marksValue = line.studentMarks;
      }

      if line.studentHeight > tallest.heightValue {
        tallest.heightName = line.studentName;
        tallest.heightValue = line.studentHeight;
      }
    }
  }

  write outputMarksTxt from best;
  write outputHeightTxt from tallest;

  close outputHeightTxt;
  close outputMarksTxt;
  close inputTxt;

  audit("EXTREMES_FOUND", idempotencyKey);
}
