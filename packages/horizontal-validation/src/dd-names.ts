/**
 * Turning a set of logical file names into legal, distinct DD names.
 *
 * A benchmark names its files the way a Unix program does (`input.txt`,
 * `task_func03_out1`) and a COBOL file is reached through a DD name, which is
 * one to eight alphanumeric characters. Something has to map between them, and
 * the something has to be a function of *the whole set* rather than of each
 * name alone.
 *
 * That was the defect. The first version truncated each name independently:
 *
 *     task_func03_inp   -> TASKFUNC03INP  -> TASKFUNC
 *     task_func03_out1  -> TASKFUNC03OUT1 -> TASKFUNC
 *     task_func03_out2  -> TASKFUNC03OUT2 -> TASKFUNC
 *
 * `TASKFUNC` is exactly eight characters, so the truncation landed precisely at
 * the end of the shared prefix and threw away every character that
 * distinguished the three files. Nineteen of CobolCodeBench's forty-six tasks
 * name their files that way, and all nineteen became unrunnable: a run whose
 * three files are one file measures nothing. The largest single blocker in the
 * benchmark was this function.
 *
 * Two ideas fix it. Keep the *tail* as well as the head, because the tail is
 * where names differ; and resolve whatever still collides against the rest of
 * the set rather than pretending each name is alone.
 */

/** The characters a DD name may contain, and how many. */
const DD_LIMIT = 8;

/**
 * A logical name reduced to the alphabet a DD name allows.
 *
 * Everything that is not a letter or a digit goes, and what is left is
 * uppercased. Unicode survives only in so far as it is `[A-Za-z0-9]`, so a name
 * of entirely non-ASCII characters reduces to nothing, which `allocate` then
 * has to give a name to rather than crash on.
 */
export function ddBase(logicalName: string): string {
  return logicalName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * A DD name has to start with a letter, so one is supplied when it must be.
 *
 * `M3input.ps` reduces to `M3INPUTPS` and is fine; `9leading-digit` reduces to
 * `9LEADINGDIGIT` and is not. Caught by the test that runs every file-name
 * shape in the corpus through the allocator.
 */
function leadingLetter(base: string): string {
  return /^[0-9]/.test(base) ? `D${base}` : base;
}

/**
 * The plain form: the first eight characters.
 *
 * What almost every name gets, and what every name got before collisions were
 * handled. `output.txt` is `OUTPUTTX` here and stays `OUTPUTTX`, because a file
 * that collides with nothing has no reason to be renamed.
 */
export function ddCandidate(base: string): string {
  return leadingLetter(base).slice(0, DD_LIMIT);
}

/**
 * The form that keeps both ends, used only when the plain form collides.
 *
 * `TASKFUNC03OUT1` becomes `TASKOUT1` rather than `TASKFUNC`: four from the
 * front, so a reader can tell which family the file belongs to, and four from
 * the back, which is where a generated name says what it *is*. This is what
 * separates the three files of a CobolCodeBench task, whose shared prefix is
 * exactly eight characters long.
 */
export function ddEndsCandidate(base: string): string {
  const legal = leadingLetter(base);
  if (legal.length <= DD_LIMIT) {
    return legal;
  }
  return `${legal.slice(0, 4)}${legal.slice(-4)}`;
}

/**
 * DD names for a set of logical names, distinct and stable.
 *
 * Deterministic in the strong sense the validation harness needs: the answer
 * depends on the *set* of names and nothing else. The input is sorted before
 * anything is allocated, so the order the caller happened to read the files in
 * (a JSON object's key order, a directory listing) cannot change a name.
 *
 * Three rounds, each disturbing less than the next. A name whose first eight
 * characters are already unique in the set keeps them, which is the case for
 * almost every file and is why adding this allocator renamed nothing that was
 * working. A name that collides there tries head-and-tail, which is what
 * separates `task_func03_inp` from `task_func03_out1`. Anything still colliding
 * takes a counter.
 *
 * Collisions are resolved by counting, not by hashing. A hash would be stable
 * and unreadable, and `TASKOUT1` is worth more to somebody reading a failing
 * run than `TASK7F3A`. The counter is base-36, so a group of more than ten
 * still fits in one character.
 *
 * A name that reduces to nothing, punctuation only or non-ASCII only, is
 * given `DD` and the same treatment, because refusing it would make the harness
 * fail on a corpus rather than measure it.
 */
export function allocateDdNames(
  logicalNames: readonly string[],
): Map<string, string> {
  const unique = [...new Set(logicalNames)].sort();
  const allocated = new Map<string, string>();
  const taken = new Set<string>();

  const bases = new Map(unique.map((name) => [name, ddBase(name)]));
  const tally = (pick: (base: string) => string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const name of unique) {
      if (allocated.has(name)) {
        continue;
      }
      const candidate = pick(bases.get(name) as string) || "DD";
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
    return counts;
  };

  for (const pick of [ddCandidate, ddEndsCandidate]) {
    const counts = tally(pick);
    for (const name of unique) {
      if (allocated.has(name)) {
        continue;
      }
      const candidate = pick(bases.get(name) as string) || "DD";
      if (counts.get(candidate) === 1 && !taken.has(candidate)) {
        allocated.set(name, candidate);
        taken.add(candidate);
      }
    }
  }

  let index = 0;
  for (const name of unique) {
    if (allocated.has(name)) {
      continue;
    }
    const candidate = ddEndsCandidate(bases.get(name) as string) || "DD";
    let chosen: string;
    do {
      const suffix = index.toString(36).toUpperCase();
      chosen = `${candidate.slice(0, DD_LIMIT - suffix.length)}${suffix}`;
      index += 1;
    } while (taken.has(chosen));
    allocated.set(name, chosen);
    taken.add(chosen);
  }

  return allocated;
}

/** True for a name a DD statement can carry. */
export function isLegalDdName(name: string): boolean {
  return /^[A-Z][A-Z0-9]{0,7}$/.test(name);
}
