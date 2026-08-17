/**
 * Random valid BankTS programs, for the property the compiler actually claims.
 *
 * Every hand-written test is a shape somebody thought of, and the defect that
 * mattered most, a 31-character COBOL word, was in a shape nobody thought of,
 * because every fixture had short names. A
 * generator does not know what anyone had in mind.
 *
 * What it generates is *valid* input: the point is not to fuzz the parser but
 * to reach corners of the emitter that a curated suite does not. So every
 * program here compiles with no diagnostics by construction, and what is
 * asserted is what comes out: that it obeys the target's rules and that `cobc`
 * accepts it under the IBM-shaped dialect.
 *
 * Deterministic, because a property test that cannot be rerun is a bug report
 * with no reproduction. The seed is in the name of every generated program.
 */

/** A small deterministic generator: xorshift32, seeded per program. */
export class Random {
  private state: number;

  constructor(seed: number) {
    // Zero is a fixed point of xorshift, so it is moved off it.
    this.state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** A whole number in `[low, high]`. */
  between(low: number, high: number): number {
    return low + (this.next() % (high - low + 1));
  }

  pick<T>(values: readonly T[]): T {
    // Modulo the length, so the index is always in range for a non-empty list.
    return values[this.next() % values.length]!;
  }
}

/**
 * Name lengths that land on and around the boundary.
 *
 * A COBOL word is at most 30 characters and this compiler abbreviates to fit,
 * so 29, 30 and 31 are the three answers that differ. The generator uses them
 * far more often than a person would.
 */
const BOUNDARY_LENGTHS = [3, 8, 29, 30, 31, 40];

const ROUNDING_MODES = [
  "HALF_UP",
  "HALF_EVEN",
  "HALF_DOWN",
  "UP",
  "DOWN",
  "CEILING",
  "FLOOR",
] as const;

/** A camelCase identifier of a given length, deterministic in the seed. */
function identifier(random: Random, length: number, prefix: string): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let name = prefix;
  while (name.length < length) {
    // A capital every few characters, so the name has word boundaries for the
    // COBOL name generator to hyphenate at, which is where abbreviation and
    // the 30-character limit interact.
    const letter = letters[random.next() % letters.length]!;
    name +=
      name.length > prefix.length && random.next() % 4 === 0
        ? letter.toUpperCase()
        : letter;
  }
  return name.slice(0, Math.max(length, prefix.length + 1));
}

/** An upper-case COBOL-shaped name, for a module or record. */
function typeName(random: Random, length: number, prefix: string): string {
  const name = identifier(random, length, prefix);
  return `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

export interface GeneratedProgram {
  seed: number;
  source: string;
}

/**
 * One valid program.
 *
 * Everything it contains is chosen so the result has no diagnostics: precisions
 * that fit, scales that a rounding can reach, a bound on every loop, a balanced
 * pair of postings, an idempotency key, and an audit event.
 */
export function generateProgram(seed: number): GeneratedProgram {
  const random = new Random(seed);

  const module = typeName(random, random.between(4, 12), "Gen");
  const record = typeName(random, random.pick(BOUNDARY_LENGTHS), "Rec");
  const money = `currency<"BDT", 18, 2>`;

  const fieldCount = random.between(2, 6);
  const fields: string[] = [];
  const numerics: string[] = [];
  for (let index = 0; index < fieldCount; index += 1) {
    const name = identifier(random, random.pick(BOUNDARY_LENGTHS), `f${index}`);
    const shape = random.between(0, 4);
    if (shape === 0) {
      fields.push(`  ${name}: string<${random.between(1, 60)}>;`);
    } else if (shape === 1) {
      // Precision and scale on the boundary ARITH(COMPAT) allows.
      const precision = random.pick([1, 2, 9, 17, 18]);
      const scale = random.between(0, Math.min(precision, 4));
      fields.push(`  ${name}: decimal<${precision}, ${scale}>;`);
      if (scale === 2 && precision === 18) {
        numerics.push(name);
      }
    } else if (shape === 2) {
      fields.push(`  ${name}: ${money};`);
      numerics.push(name);
    } else if (shape === 3) {
      fields.push(`  ${name}: unsigned<${random.pick([1, 8, 9, 18])}, 0>;`);
    } else {
      // A table at one of its own boundaries: a single occurrence, or a large
      // one. Both are shapes an `OCCURS` gets wrong differently.
      fields.push(`  ${name}: decimal<9, 0>[${random.pick([1, 2, 99, 500])}];`);
    }
  }

  // Something to post and something to round. Both are added rather than
  // hoped for, so the program is always a transaction worth compiling.
  const amount = identifier(random, random.pick(BOUNDARY_LENGTHS), "amt");
  fields.push(`  ${amount}: ${money};`);
  numerics.push(amount);
  const account = identifier(random, random.pick(BOUNDARY_LENGTHS), "acct");
  fields.push(`  ${account}: string<16>;`);
  fields.push("  idempotencyKey: string<36>;");

  const mode = random.pick(ROUNDING_MODES);
  const rate = `0.0${random.between(1, 9)}${random.between(1, 9)}${random.between(1, 9)}`;
  const routine = identifier(random, random.pick(BOUNDARY_LENGTHS), "calc");
  const transaction = identifier(random, random.pick(BOUNDARY_LENGTHS), "run");
  const counter = identifier(random, random.pick(BOUNDARY_LENGTHS), "seen");

  const body: string[] = [
    `  ${counter} = 0;`,
    `  while ${counter} < 10 limit ${random.pick([1, 2, 1000, 999999])} {`,
    `    ${counter} = ${counter} + 1;`,
    "  }",
    `  rec.${amount} = ${routine}(rec.${amount});`,
    `  debit(rec.${account}, rec.${amount});`,
    `  credit("SUSPENSE", rec.${amount});`,
    `  audit("GENERATED", rec.idempotencyKey);`,
  ];

  const source = `module ${module};

record ${record} {
${fields.join("\n")}
}

function ${routine}(value: ${money}): ${money} {
  return round(value * ${rate}, "${mode}");
}

entry transaction ${transaction}(rec: ${record}, ${counter}: binary<9>) {
${body.join("\n")}
}
`;

  return { seed, source };
}

/** A batch of programs, one per seed. */
export function generatePrograms(count: number, from = 1): GeneratedProgram[] {
  return Array.from({ length: count }, (_, index) =>
    generateProgram(from + index),
  );
}
