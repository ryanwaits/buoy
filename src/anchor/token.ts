/**
 * The word that is wrong. A claim's range is the passage Drift read; the buoy
 * belongs on the identifier inside it that the spec does not have. Read-only.
 */

/** The smallest thing a reader would call one passage. */
export const BLOCK = 'p, li, td, th, dd, dt, pre, blockquote, h1, h2, h3, h4, h5, h6';

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HEADING = 'h1, h2, h3, h4, h5, h6';

/** Whole-word occurrences of `name` in `scope`, in order. `codeOnly` reads code spans and fences alone. */
function occurrences(scope: Element, name: string, codeOnly: boolean): Range[] {
  const doc = scope.ownerDocument;
  const walker = doc.createTreeWalker(scope, 4);
  const nodes: { node: Text; at: number }[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (codeOnly && !node.parentElement?.closest('code, pre')) {
      // A break, so a word cannot be assembled across the prose that was skipped.
      text += ' ';
      continue;
    }
    nodes.push({ node: node as Text, at: text.length });
    text += (node as Text).data;
  }
  const point = (offset: number): [Text, number] | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, at } = nodes[i];
      if (at <= offset) return offset - at <= node.data.length ? [node, offset - at] : null;
    }
    return null;
  };
  const found: Range[] = [];
  const re = new RegExp(`(?<![\\w$])${escapeRe(name)}(?![\\w$])`, 'g');
  for (const match of text.matchAll(re)) {
    const from = point(match.index);
    const to = point(match.index + name.length);
    if (!from || !to) continue;
    const range = doc.createRange();
    range.setStart(from[0], from[1]);
    range.setEnd(to[0], to[1]);
    found.push(range);
  }
  return found;
}

/** What a heading introduces: its following siblings, up to the next heading of its level or above. */
function sectionOf(heading: Element): Element[] {
  const level = Number(heading.tagName[1]);
  const out: Element[] = [];
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    const inner = el.matches(HEADING) ? el : el.querySelector(HEADING);
    if (inner && Number(inner.tagName[1]) <= level) break;
    out.push(el);
  }
  return out;
}

/**
 * The first of `names`, tried in order, that the page shows: at or after the claim
 * inside its block, else anywhere in the block. A claim on a heading stands for its
 * section, so the word is looked for there too, in code only: prose says "delete"
 * without meaning the method. `null` when the page does not show the word; the
 * claim's own range is then the best place.
 */
export function tokenRange(range: Range, names: string[]): Range | null {
  if (!names.length) return null;
  const start = range.commonAncestorContainer;
  const el = start.nodeType === 1 ? (start as Element) : start.parentElement;
  const block = el?.closest(BLOCK) ?? el;
  if (!block) return null;
  const section = block.matches(HEADING) ? sectionOf(block) : [];

  for (const name of names) {
    const here = occurrences(block, name, false);
    const at =
      here.find((r) => r.compareBoundaryPoints(Range.START_TO_START, range) >= 0) ?? here[0];
    if (at) return at;
    for (const scope of section) {
      const [first] = occurrences(scope, name, true);
      if (first) return first;
    }
  }
  return null;
}

/**
 * The line of code a node is on. Highlighters disagree about newlines (Docusaurus
 * and hand-rolled ones have none) but all of them give each line its own element
 * directly under the `<code>`: that element is the line. `null` for a plain fence,
 * where lines are told apart by newlines instead.
 */
export function codeLine(node: Node, pre: Element): Element | null {
  const holder = pre.querySelector('code') ?? pre;
  let el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (el && el.parentElement !== holder) el = el.parentElement;
  if (!el || holder.children.length < 2) return null;
  return el;
}
