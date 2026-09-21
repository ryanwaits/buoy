import type { Locator } from '../types';
import { normalize } from './text';

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

/** Same punctuation strip as Drift's `PageSlugger` (github-slugger rules). */
const SLUG_PUNCT: RegExp = /[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g;

function slug(value: string): string {
  return value.toLowerCase().replace(SLUG_PUNCT, '').replace(/ /g, '-');
}

function level(heading: Element): number {
  return Number(heading.tagName[1]);
}

/** Heading text without the host's anchor links and copy buttons. */
function headingText(heading: Element): string {
  const copy = heading.cloneNode(true) as Element;
  for (const el of copy.querySelectorAll('button, svg, .hash-link, [aria-hidden="true"]')) {
    el.remove();
  }
  return normalize(copy.textContent ?? '');
}

/**
 * The heading a locator points at. Hosts agree on github-style ids far more
 * often than not, so id wins; text and re-slugged text cover the rest.
 */
export function findHeading(root: ParentNode, locator: Locator): Element | null {
  const { headingId, headingText: wanted } = locator;
  if (!headingId && !wanted) return null;
  const headings = [...root.querySelectorAll(HEADINGS)];

  if (headingId) {
    const byId = headings.find(
      (h) =>
        h.id === headingId || [...h.querySelectorAll('[id]')].some((el) => el.id === headingId),
    );
    if (byId) return byId;
  }
  const text = wanted ? normalize(wanted) : null;
  return (
    headings.find((h) => {
      const own = headingText(h);
      return own === text || slug(own) === headingId;
    }) ?? null
  );
}

/**
 * Nodes from `heading` up to the next heading of the same or higher level, in
 * document order. Hosts wrap content in arbitrary containers, so this walks the
 * document rather than the heading's siblings. Without a heading, the whole root.
 */
export function sectionNodes(root: ParentNode, heading: Element | null): Node[] {
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 0x1 | 0x4);
  const nodes: Node[] = [];
  let inside = heading === null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === heading) {
      inside = true;
    } else if (inside && heading && node.nodeType === 1 && (node as Element).matches(HEADINGS)) {
      if (level(node as Element) <= level(heading)) break;
    }
    if (inside) nodes.push(node);
  }
  return nodes;
}
