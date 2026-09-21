/**
 * Rendered-text index for a slice of the DOM.
 *
 * Docs hosts split text across token spans (shiki, prism) and wrap headings in
 * anchors and copy buttons. The index flattens that into one normalized string
 * with a map back to `(node, offset)` so a match becomes a `Range`.
 */

/** Host chrome that renders inside content but is not content. */
const SKIP = 'button, script, style, svg, [aria-hidden="true"], .hash-link, .sr-only';

const BLOCK =
  'address, article, aside, blockquote, dd, details, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, li, main, ol, p, pre, section, table, tbody, td, th, thead, tr, ul';

const ZERO_WIDTH: RegExp = /[​-‍⁠﻿]/;
const SPACE: RegExp = /\s/;

type Pos = { node: Text; offset: number };

export type TextIndex = {
  text: string;
  /** `map[i]` is the source position of `text[i]`; virtual spaces point at the next real char. */
  map: Pos[];
};

/** Collapse whitespace and drop zero-width chars. Same rules as the index. */
export function normalize(value: string): string {
  return value.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/** Strip inline markdown so a source span compares against rendered text. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*+/g, '')
    .replace(/(^|\s)_+(?=\S)|(?<=\S)_+(?=\s|$)/g, '$1');
}

/** Index the text nodes among `nodes`, in document order. */
export function indexText(nodes: Iterable<Node>): TextIndex {
  let text = '';
  const map: Pos[] = [];
  let lastBlock: Element | null = null;
  let pendingBreak = false;

  for (const node of nodes) {
    if (node.nodeType === 1) {
      if ((node as Element).tagName === 'BR') pendingBreak = true;
      continue;
    }
    if (node.nodeType !== 3) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) continue;

    const block = parent.closest(BLOCK);
    const boundary = pendingBreak || (lastBlock !== null && block !== lastBlock);
    pendingBreak = false;
    lastBlock = block;

    const push = (ch: string, offset: number): void => {
      // Whitespace runs collapse to one space; none leads the index.
      if (ch === ' ' && (text === '' || text.endsWith(' '))) return;
      text += ch;
      map.push({ node: node as Text, offset });
    };

    // Block and <br> boundaries read as whitespace even when the DOM has none.
    if (boundary) push(' ', 0);
    const data = (node as Text).data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ZERO_WIDTH.test(ch)) continue;
      push(SPACE.test(ch) ? ' ' : ch, i);
    }
  }
  return { text, map };
}

/** Every start index of `needle` in the index, in order. */
export function occurrences(index: TextIndex, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let at = index.text.indexOf(needle); at !== -1; at = index.text.indexOf(needle, at + 1)) {
    out.push(at);
  }
  return out;
}

/** Range covering `length` normalized chars from `start`. */
export function rangeAt(index: TextIndex, start: number, length: number): Range {
  const from = index.map[start];
  const to = index.map[start + length - 1];
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset + 1);
  return range;
}
