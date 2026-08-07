import { describe, expect, it } from "vitest";

import {
  parseFrontMatter,
  posts,
  renderIndex,
  renderPost,
} from "../tools/build-blog";

/**
 * The writing, held to the rules the writing is supposed to follow.
 *
 * A blog is the one part of a project nobody tests, which is why it is where
 * the standard slips first: a post with no description, a title that is also an
 * `<h1>` somewhere else, a link that rotted when a page moved. All of it is
 * checkable, and none of it is checkable by reading the post again next year.
 *
 * The prose rules below are house style rather than universal truth. They exist
 * because these posts are the first thing a stranger reads, and because the
 * phrasing they forbid is the phrasing that makes a reader stop believing the
 * author wrote it.
 */

const ALL = posts();

describe("the posts", () => {
  it("there are some, and each has what a search result needs", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(5);

    for (const post of ALL) {
      expect(post.title.length, `${post.slug} title`).toBeGreaterThan(15);
      // Google truncates a title around 60 characters and a description around
      // 160. Longer than that is not wrong; it is text nobody will see.
      expect(post.title.length, `${post.slug} title`).toBeLessThanOrEqual(75);
      expect(
        post.description.length,
        `${post.slug} description`,
      ).toBeGreaterThan(60);
      expect(
        post.description.length,
        `${post.slug} description`,
      ).toBeLessThanOrEqual(180);
      expect(post.date, `${post.slug} date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post.slug, `${post.slug} slug`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has a distinct title, slug and description for each", () => {
    const unique = (values: string[]): number => new Set(values).size;
    expect(unique(ALL.map((post) => post.slug))).toBe(ALL.length);
    expect(unique(ALL.map((post) => post.title))).toBe(ALL.length);
    expect(unique(ALL.map((post) => post.description))).toBe(ALL.length);
  });

  it("is long enough to be worth the click and short enough to finish", () => {
    for (const post of ALL) {
      const words = post.text.split(" ").length;
      expect(words, `${post.slug} is ${String(words)} words`).toBeGreaterThan(
        600,
      );
      expect(words, `${post.slug} is ${String(words)} words`).toBeLessThan(
        2500,
      );
    }
  });

  it("opens with prose rather than a heading", () => {
    // A post whose first element is an `<h2>` reads as a document, not as
    // writing, and gives a search engine no snippet to show.
    for (const post of ALL) {
      expect(post.html.trimStart().startsWith("<p>"), post.slug).toBe(true);
    }
  });

  it("uses one h1, supplied by the renderer rather than the body", () => {
    for (const post of ALL) {
      expect(post.html, post.slug).not.toContain("<h1>");
      expect(renderPost(post).match(/<h1>/g)?.length ?? 0).toBe(1);
    }
  });
});

/**
 * House style.
 *
 * Two rules, both about the same thing: writing that reads as though nobody
 * chose the words. The em dash is here because it is the punctuation mark a
 * language model reaches for, and a reader who has noticed that stops reading.
 * The phrase list is the rest of the same tell.
 */
describe("how the posts are written", () => {
  it("uses no em or en dashes", () => {
    for (const post of ALL) {
      const found = [...post.text].filter(
        (character) => character === "—" || character === "–",
      );
      expect(
        found.length,
        `${post.slug} contains ${String(found.length)}`,
      ).toBe(0);
    }
  });

  const FORBIDDEN = [
    "delve",
    "seamless",
    "leverage",
    "game-chang",
    "cutting-edge",
    "in today's",
    "it's not just",
    "unlock the",
    "elevate",
    "embark",
    "realm of",
    "testament to",
    "tapestry",
    "dive into",
    "deep dive",
    "at the end of the day",
    "plays a crucial role",
    "plays a vital role",
    "it is important to note",
    "in conclusion",
    "comprehensive guide",
    "harness the",
    "streamline",
    "empower",
    "revolutioniz",
    "navigating the",
    "ever-evolving",
    "robust solution",
    "best-in-class",
    "paradigm shift",
  ];

  it("avoids the phrases that read as filler", () => {
    for (const post of ALL) {
      const lower = post.text.toLowerCase();
      const found = FORBIDDEN.filter((phrase) => lower.includes(phrase));
      expect(found, `${post.slug}`).toEqual([]);
    }
  });

  it("says something specific in the first paragraph", () => {
    // Not a style rule so much as a structural one: a post that opens by
    // explaining what it is about has wasted the paragraph a reader decides on.
    for (const post of ALL) {
      const opening = post.text.slice(0, 300).toLowerCase();
      expect(opening, post.slug).not.toContain("in this post");
      expect(opening, post.slug).not.toContain("this article");
      expect(opening, post.slug).not.toContain("we will explore");
    }
  });
});

describe("the rendered pages", () => {
  it("carry the metadata a search engine reads", () => {
    for (const post of ALL) {
      const page = renderPost(post);
      expect(page, post.slug).toContain('<link rel="canonical"');
      expect(page, post.slug).toContain(
        `https://banklang.mwhassan.com/blog/${post.slug}.html`,
      );
      expect(page, post.slug).toContain('name="description"');
      expect(page, post.slug).toContain('property="og:type" content="article"');
      expect(page, post.slug).toContain('type="application/ld+json"');
      expect(page, post.slug).toContain('"@type": "BlogPosting"');
      expect(page, post.slug).toContain(`"datePublished": "${post.date}"`);
      expect(page, post.slug).toContain('<html lang="en">');
    }
  });

  it("has an index listing every post, newest first", () => {
    const index = renderIndex(ALL);
    for (const post of ALL) {
      expect(index).toContain(`${post.slug}.html`);
      expect(index).toContain(post.description);
    }
    const dates = ALL.map((post) => post.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("refuses a post with no front matter", () => {
    expect(() => parseFrontMatter("# Just a heading\n")).toThrow(
      /front matter/,
    );
    expect(() =>
      parseFrontMatter('---\ntitle: "A title"\n---\nBody.\n'),
    ).toThrow(/description/);
  });
});
