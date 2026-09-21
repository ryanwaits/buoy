/**
 * Anchoring: Drift locators are source-markdown coordinates; the overlay needs
 * DOM ranges. Find each claim's section by heading, then its text inside it.
 *
 * Read-only. Nothing here mutates the host's DOM: React hosts re-render and
 * would either wipe injected nodes or fail hydration.
 */

import type { Anchor, AnchorResult, JudgedClaim } from '../types';
import { findHeading, sectionNodes } from './section';
import { indexText, normalize, occurrences, rangeAt, stripMarkdown, type TextIndex } from './text';

type Section = { nodes: Node[]; index: TextIndex; taken: Set<number>; spans: Map<string, number> };

/** Where a claim kind may land. A wrong place is worse than no place. */
function allowed(claim: JudgedClaim, start: Node): boolean {
  const el = start.parentElement;
  if (!el) return false;
  const inFence = el.closest('pre') !== null;
  switch (claim.kind) {
    case 'fence':
      return inFence;
    case 'heading':
      return el.closest('h1, h2, h3, h4, h5, h6') !== null;
    case 'table-key':
      return !inFence && el.closest('td, th, li, dt') !== null;
    default:
      return !inFence;
  }
}

/** Last element of the section that holds content: where a gap line is drawn under. */
function lastBlock(nodes: Node[]): Element | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.nodeType !== 3 || !normalize((node as Text).data)) continue;
    const blocks = nodes.filter((n): n is Element => n.nodeType === 1 && n.contains(node));
    // Outermost ancestor still inside the section; nodes are in document order.
    return blocks[0] ?? null;
  }
  return null;
}

function place(claim: JudgedClaim, section: Section, heading: Element | null): Range | null {
  if (claim.kind === 'gap') {
    // A gap belongs to a section. Without one its only home is the page's end, which is nowhere.
    const block = heading ? lastBlock(section.nodes) : null;
    if (!block) return null;
    const range = block.ownerDocument.createRange();
    range.selectNode(block);
    return range;
  }
  const needle = normalize(claim.kind === 'fence' ? claim.text : stripMarkdown(claim.text));
  // Two rules can fire on one span (`<LivelyProvider serverUrl>`: unknown prop, and a missing one).
  // They are the same place in the source, so they are the same place on the page.
  const { start, end } = claim.locator;
  const span = `${start.line}:${start.col}-${end.line}:${end.col}`;
  const shared = section.spans.get(span);
  if (shared !== undefined) return rangeAt(section.index, shared, needle.length);
  const found = occurrences(section.index, needle);
  const take = (ok: (node: Node) => boolean): Range | null => {
    for (const at of found) {
      // Claims arrive in source order, so the nth identical span takes the nth match.
      if (section.taken.has(at) || !ok(section.index.map[at].node)) continue;
      section.taken.add(at);
      section.spans.set(span, at);
      return rangeAt(section.index, at, needle.length);
    }
    return null;
  };
  // Drift calls a name on an import line `inline` too. Prose first; failing that, the fence it sits in.
  return (
    take((node) => allowed(claim, node)) ??
    (claim.kind === 'inline' ? take((node) => node.parentElement?.closest('pre') != null) : null)
  );
}

/**
 * Locate claims in `root`, the host's rendered article.
 *
 * @example
 * ```ts
 * const { placed, unplaced } = anchorClaims(document.querySelector('article')!, page.claims);
 * ```
 */
export function anchorClaims(root: ParentNode, claims: JudgedClaim[]): AnchorResult {
  const sections = new Map<Element | null, Section>();
  const placed: Anchor[] = [];
  const unplaced: JudgedClaim[] = [];

  const ordered = [...claims].sort((a, b) => a.locator.start.line - b.locator.start.line);
  for (const claim of ordered) {
    const heading = findHeading(root, claim.locator);
    let section = sections.get(heading);
    if (!section) {
      const nodes = sectionNodes(root, heading);
      section = { nodes, index: indexText(nodes), taken: new Set(), spans: new Map() };
      sections.set(heading, section);
    }
    const range = place(claim, section, heading);
    if (range) placed.push({ claim, range });
    else unplaced.push(claim);
  }
  return { placed, unplaced };
}
