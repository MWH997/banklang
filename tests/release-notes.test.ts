import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { notesFor } from "../tools/release-notes";

/**
 * The release body.
 *
 * R2 asks for a tag "matching the changelog". The way that goes wrong is not a
 * crash — it is a release page carrying the previous version's notes, or
 * nothing, or notes that leave out everything written since they were drafted.
 * So most of what follows is about refusing rather than extracting.
 */

/** A changelog in the state a release is meant to be cut from. */
const SAMPLE = `# Changelog

Preamble that belongs to no version.

## [Unreleased]

## [0.9.0] - 2026-08-07

### Added

- The first thing.
- The second thing.

### Fixed

- A third thing.

## [0.8.0] - 2026-07-01

### Added

- An older thing.
`;

/** The same changelog with work written after 0.9.0's section was drafted. */
const WITH_UNRELEASED = SAMPLE.replace(
  "## [Unreleased]\n",
  "## [Unreleased]\n\n### Fixed\n\n- Something written after 0.9.0 was written up.\n",
);

describe("the notes a release is published with", () => {
  it("is the section for that version, and stops at the next one", () => {
    const notes = notesFor("0.9.0", SAMPLE);
    expect(notes).toContain("The first thing.");
    expect(notes).toContain("A third thing.");
    expect(notes).not.toContain("An older thing.");
    expect(notes).not.toContain("Preamble");
  });

  it("does not carry the heading, which the release page prints itself", () => {
    expect(notesFor("0.9.0", SAMPLE).startsWith("### Added")).toBe(true);
  });

  it("reads the last section too, where there is no next heading", () => {
    expect(notesFor("0.8.0", SAMPLE)).toContain("An older thing.");
  });

  it("refuses a version the changelog does not mention", () => {
    expect(() => notesFor("1.0.0", SAMPLE)).toThrow(/no section for 1\.0\.0/);
  });

  it("refuses a section that is only a heading", () => {
    expect(() =>
      notesFor("0.7.0", `## [0.7.0] - 2026-01-01\n\n## [0.6.0]\n`),
    ).toThrow(/empty/);
  });

  /**
   * What a person does when they mean to release and have not renamed the
   * heading: they write the version beside `Unreleased` rather than instead of
   * it. The lookup finds it, and the notes are then filed under a heading that
   * says they are not released.
   */
  it("refuses a version still filed under Unreleased", () => {
    expect(() =>
      notesFor("0.9.0", `## [Unreleased] 0.9.0\n\n- Work.\n`),
    ).toThrow(/still filed under Unreleased/);
  });

  /**
   * The failure that is not a crash.
   *
   * The notes for the version being released extract perfectly well while
   * everything written since sits under Unreleased. Those entries then appear
   * on no release page at all: not on this one, and by the next release they
   * are old news nobody re-reads.
   */
  it("refuses to release the newest version while Unreleased has entries", () => {
    expect(() => notesFor("0.9.0", SAMPLE)).not.toThrow();
    expect(() => notesFor("0.9.0", WITH_UNRELEASED)).toThrow(
      /still has entries under Unreleased/,
    );
  });

  it("does not apply that to an older version, which is a lookup", () => {
    // Asking for 0.8.0's notes is reading history, not cutting a release.
    expect(() => notesFor("0.8.0", WITH_UNRELEASED)).not.toThrow();
  });

  /**
   * This repository, today.
   *
   * `## [0.9.0]` is written and `## [Unreleased]` above it is not empty, which
   * is exactly the state above: tagging `v0.9.0` now would publish notes that
   * omit every change made since that section was written. The refusal is the
   * point, and it is why `release.yml` runs this before it builds anything.
   */
  it("stops this repository from tagging v0.9.0 as it stands", () => {
    const version = (
      JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    ).version;
    expect(() => notesFor(version)).toThrow(/Unreleased/);
  });
});
