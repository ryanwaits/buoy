/** Content containers of the supported hosts, most specific first. Shared by the build and the overlay. */
export const ROOTS: string[] = [
  '.theme-doc-markdown',
  '.mdx-content',
  'article .prose',
  '.prose',
  'article',
  'main',
];

type Queryable<T> = { querySelector(selector: string): T | null };

/**
 * The host's article. Tried one selector at a time: a selector list matches in
 * document order, so `main` would win over the article it contains.
 */
export function findRoot<T>(doc: Queryable<T>, selector?: string): T | null {
  if (selector) return doc.querySelector(selector);
  for (const candidate of ROOTS) {
    const found = doc.querySelector(candidate);
    if (found) return found;
  }
  return null;
}
