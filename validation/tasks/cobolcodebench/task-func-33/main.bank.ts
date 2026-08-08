module TaskFunc33;

// Written from `spec.json`. Specification: read two weather files, write every
// record from both to 'weather-merged.txt' preserving the original format,
// carrying on with whichever file still has records when the other ends, and
// put a header record at the front.

// Fifteen rather than fourteen: the widest data line is fourteen characters and
// the header is fifteen, and one record description has to hold both. Line
// sequential drops the trailing blanks a shorter line is padded with.
record WeatherLine {
  weatherText: string<15>;
}

file weather1 lineSequential input record WeatherLine status weather1Status;

file weather2 lineSequential input record WeatherLine status weather2Status;

file weatherMerged
  lineSequential
  output
  record WeatherLine
  status weatherMergedStatus;

entry transaction mergeWeather(line: WeatherLine, idempotencyKey: string<36>) {
  open weather1;
  open weather2;
  open weatherMerged;

  line.weatherText = "Time    Weather";
  write weatherMerged from line;

  // One record from each file in turn, and neither file's ending stops the
  // other: the status is tested separately before each read and before each
  // write, so the longer file runs on alone once the shorter is exhausted.
  while weather1Status == "00" || weather2Status == "00" limit 100000 {
    if weather1Status == "00" {
      read weather1 into line;

      if weather1Status == "00" {
        write weatherMerged from line;
      }
    }

    if weather2Status == "00" {
      read weather2 into line;

      if weather2Status == "00" {
        write weatherMerged from line;
      }
    }
  }

  close weatherMerged;
  close weather2;
  close weather1;

  log "WEATHER MERGED";

  audit("WEATHER_MERGED", idempotencyKey);
}
