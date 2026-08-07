import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  citationAuthor,
  parseFrontMatter,
  posts,
  renderAbout,
  renderFeed,
  renderIndex,
  renderPost,
  rfc822,
} from "../tools/build-blog";
import { servedUrl } from "../tools/build-site";

/**
 * The writing, held to the rules the writing is supposed to follow.
 *
 * A blog is the one part of a project nobody tests, which is why it is where
 * the standard slips first: a post with no description, a title that is also an
 * `<h1>` somewhere else, a link that rotted when a page moved. All of it is
 * checkable, and none of it is checkable by reading the post again next year.
 *
 * The prose rules that used to live here are in `tests/prose.test.ts` now, and
 * they apply to the documentation and the site copy as well. H2 is why.
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
 * House style, the half that is specific to a post.
 *
 * The two prose rules used to live here and to apply to five files. H2 moved
 * the phrase list to `tests/prose.test.ts`, which applies it to the
 * documentation and the site copy as well, and dropped the em-dash rule
 * outright — the reasoning for both is written at the top of that file. What is
 * left here is what is about a post rather than about prose in general.
 */
describe("how the posts are written", () => {
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
      // D2. The exact URL the host serves, not the file's name. Cloudflare
      // Pages answers `/blog/foo.html` with a 308 to `/blog/foo`, so declaring
      // the `.html` form canonical pointed every post at a redirect.
      expect(page, post.slug).toContain(
        `rel="canonical" href="${servedUrl(`blog/${post.slug}.html`)}"`,
      );
      expect(page, post.slug).not.toContain(`/blog/${post.slug}.html"`);
      expect(page, post.slug).toContain('name="description"');
      expect(page, post.slug).toContain('property="og:type" content="article"');
      expect(page, post.slug).toContain('type="application/ld+json"');
      expect(page, post.slug).toContain('"@type": "BlogPosting"');
      expect(page, post.slug).toContain(`"datePublished": "${post.date}"`);
      expect(page, post.slug).toContain('<html lang="en">');
      expect(page, post.slug).toContain(
        'rel="alternate" type="application/rss+xml"',
      );
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

/**
 * H1. Five essays arguing for a change in how banks build core systems,
 * published with no byline, while `CITATION.cff` held the name, the email and
 * an ORCID and the string "Wahid" appeared nowhere on the built site.
 *
 * Required rather than optional front matter, and held to the citation file, so
 * there is one record of who wrote this rather than two that can disagree.
 */
describe("the byline", () => {
  const AUTHOR = citationAuthor();

  it("is on every post, and is the person the citation names", () => {
    for (const post of ALL) {
      expect(post.author, post.slug).toBe(AUTHOR.name);
      const page = renderPost(post);
      expect(page, post.slug).toContain(AUTHOR.name);
      expect(page, post.slug).toContain('href="../about/"');
      expect(page, post.slug).toContain('"@type": "Person"');
    }
  });

  it("is required, so it cannot be added to four posts and not the fifth", () => {
    expect(() =>
      parseFrontMatter(
        '---\ntitle: "A title"\ndescription: "A description"\ndate: 2026-01-01\n---\nBody.\n',
      ),
    ).toThrow(/author/);
  });

  it("lands on an about page built from the same file", () => {
    const about = renderAbout();
    expect(about).toContain(AUTHOR.name);
    expect(about).toContain(AUTHOR.email);
    expect(about).toContain(AUTHOR.orcid);
    expect(about).toContain(AUTHOR.github);
    // The page says the two things a reader arriving from a byline is owed and
    // the rest of the site says elsewhere: how it was written, and what has
    // never been done.
    expect(about).toMatch(/AI coding assistant/);
    expect(about).toMatch(/never run on z\/OS/);
  });
});

/**
 * H3 and H4. Every post closed with the same italic paragraph about BankLang,
 * which reads as a template in one sitting, and each one dead-ended: no way
 * from one essay to the next, and nothing saying whether a sixth was coming.
 */
describe("what follows an essay", () => {
  it("is where to go next, rather than what BankLang is", () => {
    for (const post of ALL) {
      const page = renderPost(post);
      expect(page, post.slug).toContain('class="post__related"');
      expect(page, post.slug).not.toContain("post__next");
      // The paragraph that was there. Its opening words are what made five
      // posts look like one template.
      expect(post.text, post.slug).not.toMatch(
        /BankLang (is|has|emits|grades|requires) /,
      );
    }
  });

  it("names two other posts, and neither is this one", () => {
    const slugs = new Set(ALL.map((post) => post.slug));
    for (const post of ALL) {
      expect(post.related, post.slug).toHaveLength(2);
      expect(new Set(post.related).size, post.slug).toBe(2);
      for (const slug of post.related) {
        expect(slug, post.slug).not.toBe(post.slug);
        expect(slugs, post.slug).toContain(slug);
      }
      const page = renderPost(post);
      for (const slug of post.related) {
        expect(page, post.slug).toContain(`href="${slug}.html"`);
      }
    }
  });

  it("names the documentation page the essay is the argument for", () => {
    for (const post of ALL) {
      expect(
        existsSync(resolve("docs", post.reading)),
        `${post.slug} reads on to docs/${post.reading}`,
      ).toBe(true);
      expect(renderPost(post), post.slug).toContain(
        `href="../docs/${post.reading.replace(/\.md$/, ".html")}"`,
      );
    }
  });

  it("says on the index what happens next, since five in five days does not", () => {
    const index = renderIndex(ALL);
    expect(index).toContain("post__cadence");
    expect(index).toContain('href="feed.xml"');
  });
});

/**
 * D5. A section called "Writing" with five essays aimed at engineers, and no
 * way to subscribe to it.
 */
describe("the feed", () => {
  const FEED = renderFeed(ALL);

  it("has one item per post, with a date a reader can parse", () => {
    const items = [...FEED.matchAll(/<item>/g)];
    expect(items).toHaveLength(ALL.length);
    for (const post of ALL) {
      expect(FEED).toContain(`<title>${post.title}</title>`);
      expect(FEED).toContain(servedUrl(`blog/${post.slug}.html`));
      expect(FEED).toContain(`<pubDate>${rfc822(post.date)}</pubDate>`);
    }
    // RFC 822, which is what RSS 2.0 requires and what an ISO date is not.
    expect(rfc822("2026-08-07")).toBe("Fri, 07 Aug 2026 00:00:00 GMT");
  });

  it("declares where it is, which is what a validator asks for", () => {
    expect(FEED).toContain(
      '<atom:link href="https://banklang.mwhassan.com/blog/feed.xml" rel="self" type="application/rss+xml" />',
    );
    expect(FEED.trimStart().startsWith("<?xml")).toBe(true);
  });

  it("escapes what a title or a description may contain", () => {
    // Every description here has an apostrophe in it somewhere, and two have a
    // quotation mark. An unescaped `&` is what makes a feed unparseable.
    const body = FEED.slice(FEED.indexOf("<item>"));
    expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
  });
});
