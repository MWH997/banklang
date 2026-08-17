/**
 * What may be copied into this repository, decided rather than assumed.
 *
 * "Open source" is not "public domain", and a dataset that gathers other
 * people's repositories does not relicense them by gathering them. X-COBOL is
 * published under CC-BY-4.0 and contains 5,195 files from 168 repositories, none
 * of which agreed to that; the licence covers the compilation. Copying those
 * files in because the record says CC-BY would be this project asserting a
 * permission nobody granted it.
 *
 * So the gate below is deliberately conservative in one direction only. An
 * unrecognised licence is never a refusal to *measure*. Every file is still
 * read, analysed and counted, and the statistics are this project's own. It is
 * a refusal to *redistribute*. What lands in git for such a corpus is hashes,
 * provenance and numbers.
 *
 * `excluded-license-unknown` is a real answer here and is reported as its own
 * row. Guessing would be the failure: a wrong guess in the permissive direction
 * is a licence violation, and a wrong guess in the other direction quietly
 * shrinks a denominator, which is the thing this whole exercise is organised
 * against.
 */

/**
 * Licences whose terms permit this repository to carry the material.
 *
 * Attribution licences are here on the understanding that the corpus registry's
 * `citation` field and the evidence bundle's provenance record are what
 * discharges the attribution. Copyleft is deliberately absent, and absent is
 * not the same as forbidden: including GPL COBOL in an MIT repository is a
 * decision with consequences for everyone downstream, so it needs a person
 * rather than a table.
 */
const REDISTRIBUTABLE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
]);

/**
 * Licences recognised but not automatically vendored.
 *
 * Recorded separately from "unknown" because the distinction is worth
 * publishing: a file under GPL-3.0 has a licence this project read and declined
 * to copy, and a file with no licence at all has nobody to ask.
 */
const RECOGNISED_NOT_VENDORED = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "AGPL-3.0",
  "MPL-2.0",
  "EPL-2.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
]);

export type RedistributionVerdict =
  "redistributable" | "excluded-license-copyleft" | "excluded-license-unknown";

export interface LicenceDetermination {
  /** SPDX identifier where one could be established, else null. */
  spdx: string | null;
  verdict: RedistributionVerdict;
  /** How the identifier was arrived at, so a reader can check it. */
  basis: string;
}

/**
 * Whether material under an SPDX identifier may be committed here.
 *
 * `null` and an unrecognised string are the same answer deliberately: this
 * function never reasons about a licence it does not have a rule for.
 */
export function classifyLicence(
  spdx: string | null,
  basis: string,
): LicenceDetermination {
  if (spdx === null || spdx === "" || spdx === "NOASSERTION") {
    return { spdx: null, verdict: "excluded-license-unknown", basis };
  }
  if (REDISTRIBUTABLE.has(spdx)) {
    return { spdx, verdict: "redistributable", basis };
  }
  if (RECOGNISED_NOT_VENDORED.has(spdx)) {
    return { spdx, verdict: "excluded-license-copyleft", basis };
  }
  return { spdx, verdict: "excluded-license-unknown", basis };
}

/**
 * Patterns that identify a licence from the text of a LICENSE file.
 *
 * Ordered, and the order matters: "GNU Lesser General Public License" contains
 * "General Public License", so the narrower name has to be tested first. Each
 * pattern is matched against the whole file rather than its first line, because
 * a licence file commonly opens with a copyright holder's name.
 *
 * This is identification, not interpretation. It answers "which licence is
 * this" and nothing about whether the terms were complied with.
 */
const LICENCE_SIGNATURES: { spdx: string; pattern: RegExp }[] = [
  { spdx: "AGPL-3.0", pattern: /GNU AFFERO GENERAL PUBLIC LICENSE/i },
  {
    spdx: "LGPL-3.0",
    pattern: /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i,
  },
  {
    spdx: "LGPL-2.1",
    pattern: /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2/i,
  },
  { spdx: "GPL-3.0", pattern: /GNU GENERAL PUBLIC LICENSE\s+Version 3/i },
  { spdx: "GPL-2.0", pattern: /GNU GENERAL PUBLIC LICENSE\s+Version 2/i },
  { spdx: "MPL-2.0", pattern: /Mozilla Public License Version 2\.0/i },
  { spdx: "EPL-2.0", pattern: /Eclipse Public License - v ?2\.0/i },
  { spdx: "Apache-2.0", pattern: /Apache License\s+Version 2\.0/i },
  {
    spdx: "BSD-3-Clause",
    pattern: /Neither the name of .{0,80}may be used to endorse/is,
  },
  {
    spdx: "BSD-2-Clause",
    pattern: /Redistribution and use in source and binary forms/i,
  },
  {
    spdx: "ISC",
    pattern:
      /Permission to use, copy, modify, and(?:\/or)? distribute this software/i,
  },
  {
    spdx: "0BSD",
    pattern:
      /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i,
  },
  {
    spdx: "Unlicense",
    pattern:
      /This is free and unencumbered software released into the public domain/i,
  },
  { spdx: "CC0-1.0", pattern: /CC0 1\.0 Universal/i },
  {
    spdx: "CC-BY-SA-4.0",
    pattern: /Creative Commons Attribution-ShareAlike 4\.0/i,
  },
  { spdx: "CC-BY-4.0", pattern: /Creative Commons Attribution 4\.0/i },
  { spdx: "MIT", pattern: /Permission is hereby granted, free of charge/i },
];

/**
 * The SPDX identifier a licence file declares, or null.
 *
 * Null is a legitimate outcome and the caller must treat it as one. Most of the
 * 168 repositories behind X-COBOL have no licence file at all, and that is the
 * finding, rather than something to paper over with a default.
 */
export function detectLicence(text: string): LicenceDetermination {
  for (const signature of LICENCE_SIGNATURES) {
    if (signature.pattern.test(text)) {
      return classifyLicence(
        signature.spdx,
        `matched the ${signature.spdx} text in the supplied licence file`,
      );
    }
  }
  return classifyLicence(null, "no recognised licence text in the file");
}

/** Every SPDX identifier this gate has a rule for, for tests and reports. */
export function knownLicences(): string[] {
  return [...REDISTRIBUTABLE, ...RECOGNISED_NOT_VENDORED].sort();
}
