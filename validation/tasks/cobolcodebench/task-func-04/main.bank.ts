module TaskFunc04;

// Written from `spec.json` — the prose, the input files and the expected output
// file. The benchmark's own COBOL is in the gitignored `validation/sealed/`,
// which the authoring path does not read.
//
// Specification: read filenames from 'input.txt'; move the ones whose extension
// is txt, csv or xlsx to 'output.txt'; record the rest in 'error.txt' with the
// reason; display both counts.

record NameLine {
  lineName: string<30>;
}

// The two halves a filename splits into at the dot. `split` is UNSTRING, which
// writes into fixed fields, so the extension is declared wide enough for the
// longest one the specification names.
record NameParts {
  partBase: string<26>;
  partExtension: string<4>;
}

// The rejection, laid out as a record rather than concatenated, because it is a
// fixed-width report line and that is what a record is for.
record ErrorLine {
  errLabel: string<28>;
  errName: string<30>;
  errReason: string<30>;
}

record Counts {
  movedFiles: unsigned<9, 0>;
  rejectedFiles: unsigned<9, 0>;
}

file inputTxt lineSequential input record NameLine status inputTxtStatus;

file outputTxt lineSequential output record NameLine status outputTxtStatus;

file errorTxt lineSequential output record ErrorLine status errorTxtStatus;

function isAccepted(partExtension: string<4>): bool {
  if partExtension == "txt" {
    return true;
  } else {
    if partExtension == "csv" {
      return true;
    } else {
      if partExtension == "xlsx" {
        return true;
      } else {
        return false;
      }
    }
  }
}

entry transaction moveByExtension(
  line: NameLine,
  parts: NameParts,
  rejected: ErrorLine,
  counts: Counts,
  idempotencyKey: string<36>,
) {
  open inputTxt;
  open outputTxt;
  open errorTxt;

  rejected.errLabel = "Invalid extension for file: ";
  rejected.errReason = "  Expected txt, csv, or xlsx";

  // The status ends the loop; the bound stops a corrupt file spinning the job.
  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      split line.lineName by "." into parts.partBase, parts.partExtension;

      if isAccepted(parts.partExtension) {
        write outputTxt from line;
        counts.movedFiles = counts.movedFiles + 1;
      } else {
        rejected.errName = line.lineName;
        write errorTxt from rejected;
        counts.rejectedFiles = counts.rejectedFiles + 1;
      }
    }
  }

  close errorTxt;
  close outputTxt;
  close inputTxt;

  log "FILES MOVED ", counts.movedFiles;
  log "FILES REJECTED ", counts.rejectedFiles;

  audit("EXTENSIONS_FILTERED", idempotencyKey);
}
