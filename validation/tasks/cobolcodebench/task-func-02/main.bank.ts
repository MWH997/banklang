module TaskFunc02;

// Written from `spec.json`. Specification: read filenames from 'input.txt',
// keep the ones whose extension is 'txt', 'doc' or 'docx', write those
// filenames to 'output.txt', and display how many were kept.

record NameLine {
  lineName: string<30>;
}

// The two halves a filename splits into at the dot. `split` is UNSTRING, which
// writes into fixed fields, so both are declared at their full width.
record NameParts {
  partBase: string<26>;
  partExtension: string<4>;
}

record KeptCount {
  keptLines: unsigned<9, 0>;
}

file inputTxt lineSequential input record NameLine status inputTxtStatus;

file outputTxt lineSequential output record NameLine status outputTxtStatus;

function isWanted(partExtension: string<4>): bool {
  if partExtension == "txt" {
    return true;
  } else {
    if partExtension == "doc" {
      return true;
    } else {
      if partExtension == "docx" {
        return true;
      } else {
        return false;
      }
    }
  }
}

entry transaction keepDocuments(
  line: NameLine,
  parts: NameParts,
  counts: KeptCount,
  idempotencyKey: string<36>,
) {
  open inputTxt;
  open outputTxt;

  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      split line.lineName by "." into parts.partBase, parts.partExtension;

      if isWanted(parts.partExtension) {
        write outputTxt from line;
        counts.keptLines = counts.keptLines + 1;
      }
    }
  }

  close outputTxt;
  close inputTxt;

  log "FILENAMES MOVED ", counts.keptLines;

  audit("DOCUMENTS_KEPT", idempotencyKey);
}
