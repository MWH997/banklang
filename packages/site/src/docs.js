/*
 * Search across the documentation, and nothing else.
 *
 * The whole corpus is one prebuilt JSON file that the browser scans. Forty-two
 * documents is small enough for that to be instant, and it is the only design
 * that keeps the promise the rest of this site makes: no request to another
 * host, no search service, no runtime dependency for anyone to audit.
 *
 * Fetched on first keystroke rather than on load, so a reader who never
 * searches never pays for the index.
 */
(() => {
  const input = document.getElementById("q");
  const results = document.getElementById("results");
  const tree = document.getElementById("tree");
  if (!input || !results || !tree) {
    return;
  }

  /*
   * The form exists for `role="search"` and for the Enter key; it has nothing
   * to submit to, and submitting it would navigate away from the results.
   *
   * This was an `onsubmit="return false"` attribute in the markup, which is an
   * inline event handler, the one thing a hash-based Content-Security-Policy
   * cannot allow, because hashes cover script *elements* and handlers are
   * attributes. Dropping `unsafe-inline` from `script-src` with the attribute
   * still there would have left Enter submitting the form on all forty-five
   * documentation pages: search typed, results shown, and gone on the keypress
   * that feels like asking for them.
   */
  document.getElementById("search")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  // `/docs/` deep or shallow: the index sits beside the stylesheet, and the
  // page already knows how to get there.
  const stylesheet = document.querySelector('link[href$="docs.css"]');
  const base = stylesheet
    ? stylesheet.getAttribute("href").replace(/docs\.css$/, "")
    : "../assets/";
  const indexUrl = `${base}search-index.json`;
  const docsRoot = new URL("../docs/", new URL(base, location.href)).href;

  let index = null;
  let loading = null;

  const load = () => {
    if (index) return Promise.resolve(index);
    loading ??= fetch(indexUrl)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        index = data;
        return index;
      })
      .catch(() => {
        index = [];
        return index;
      });
    return loading;
  };

  const escape = (text) =>
    text.replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  /**
   * Title matches first, then body matches.
   *
   * Deliberately not a relevance score. A reader searching the documentation of
   * a compiler is nearly always looking for a page by name (`EIBRESP`,
   * `rounding`, `BANK-LED-001`) and a title hit is what they meant.
   */
  const search = (query) => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];

    const titles = [];
    const bodies = [];
    for (const entry of index) {
      if (entry.t.toLowerCase().includes(needle)) {
        titles.push(entry);
      } else if (entry.b.includes(needle)) {
        bodies.push(entry);
      }
    }
    return [...titles, ...bodies].slice(0, 12);
  };

  const render = (matches, query) => {
    if (query.trim().length < 2) {
      results.hidden = true;
      tree.hidden = false;
      results.innerHTML = "";
      return;
    }

    tree.hidden = true;
    results.hidden = false;

    if (matches.length === 0) {
      results.innerHTML = `<p class="none">Nothing matches ${escape(query.trim())}.</p>`;
      return;
    }

    results.innerHTML = matches
      .map(
        (entry) =>
          `<a href="${docsRoot}${entry.u}">${escape(entry.t)}<span class="where">${escape(entry.g)}</span></a>`,
      )
      .join("");
  };

  let queued = null;
  input.addEventListener("input", () => {
    const query = input.value;
    load().then(() => {
      // Only render the latest keystroke: the index resolves out of order the
      // first time, and a stale render is worse than a late one.
      if (queued !== null) cancelAnimationFrame(queued);
      queued = requestAnimationFrame(() => render(search(query), query));
    });
  });

  // Escape clears the box and puts the navigation back, so a keyboard user is
  // never stranded in a result list.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      render([], "");
    }
    if (event.key === "ArrowDown") {
      const first = results.querySelector("a");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  results.addEventListener("keydown", (event) => {
    const links = [...results.querySelectorAll("a")];
    const at = links.indexOf(document.activeElement);
    if (at < 0) return;
    if (event.key === "ArrowDown" && links[at + 1]) {
      event.preventDefault();
      links[at + 1].focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      (links[at - 1] ?? input).focus();
    }
    if (event.key === "Escape") {
      input.focus();
      input.value = "";
      render([], "");
    }
  });
})();

/*
 * The contents button, for narrow screens.
 *
 * Separate from the search block above because it is a different concern and
 * because it must work whether or not the index ever loads.
 */
(() => {
  const button = document.getElementById("nav-toggle");
  const side = document.getElementById("side");
  if (!button || !side) {
    return;
  }
  button.addEventListener("click", () => {
    const open = side.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      side.querySelector("input")?.focus();
    }
  });
})();
