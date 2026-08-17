import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { notesFor } from "../tools/release-notes";

/**
 * The release body.
 *
 * A release wants a tag matching the changelog. The way that goes wrong is
 * never a crash: it is a release page carrying the previous version's notes, or
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
   * The manifest names the last release during ordinary development and the
   * release being cut only in the release commit. In the first state newer
   * work belongs under Unreleased and publishing the old notes must be refused;
   * in the second state those entries have been folded into the new section
   * and its body must be substantial enough to publish.
   */
  it("keeps the manifest version in one of the two valid release states", () => {
    const version = (
      JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    ).version;
    try {
      const notes = notesFor(version);
      expect(notes.length).toBeGreaterThan(200);
      // The lede, not just a bare heading with bullets under it.
      expect(notes).not.toMatch(/^#/);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `CHANGELOG.md still has entries under Unreleased. Releasing ${version} now publishes notes that leave every one of them out. Fold them into ${version}, or release the next version instead.`,
      );
    }
  });
});
