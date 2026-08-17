/**
 * The two string helpers `main.ts` builds every panel out of.
 *
 * Here rather than in `main.ts` because `main.ts` boots the page when it is
 * imported, so nothing in it can be tested without a DOM, and both of these
 * are pure functions with a rule in them that was wrong.
 */

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] as string,
  );
}

/**
 * One summary chip: a count, and what it counts.
 *
 * Two defects in one line. The gap between the number and the word was
 * `margin-right` on the `<b>`, so it existed in the layout and not in the
 * text: `textContent` read `1records`, which is what a screen reader announced
 * and what a copy and paste produced. And the labels were written as plurals at
 * the call sites, so a module with one record said "1 records".
 *
 * The label is given in the singular and pluralised here. Every one of them
 * takes a plain `s`; a label that does not can be handled where that becomes
 * true, and this should stay the one place that decides.
 */
export function statChip(singular: string, value: number): string {
  const label = value === 1 ? singular : `${singular}s`;
  return `<span class="stat"><b>${String(value)}</b> ${escapeHtml(label)}</span>`;
}
