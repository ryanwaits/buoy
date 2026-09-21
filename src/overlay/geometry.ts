/**
 * Anchor → document-space boxes. The layer is absolutely positioned in the
 * document, so it scrolls with the page and only re-measures on layout change.
 */

import { BLOCK, fenceOf } from '../anchor/token';
import type { Anchor } from '../types';

export type Box = { x: number; y: number; w: number; h: number };

export type Layout = {
  /** One box per rendered line of the claim's text. Empty for gaps. */
  lines: Box[];
  pin: { x: number; y: number };
  /** What the finding is about, as one box: the hover ring, and the area that opens it. Absent for gaps. */
  ring?: Box;
  /** Gap only: the drawn insertion line. */
  rule?: Box;
};

export const PIN = 22;
const STEP = PIN + 4;

function toDoc(rect: DOMRect): Box {
  return { x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height };
}

/** Client rects arrive per inline box; one highlight per visual line reads cleaner. */
function mergeLines(rects: DOMRect[]): Box[] {
  const lines: Box[] = [];
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue;
    const box = toDoc(rect);
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (box.y + box.h / 2)) < box.h / 2);
    if (!line) {
      lines.push(box);
      continue;
    }
    const right = Math.max(line.x + line.w, box.x + box.w);
    const bottom = Math.max(line.y + line.h, box.y + box.h);
    line.x = Math.min(line.x, box.x);
    line.y = Math.min(line.y, box.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }
  return lines;
}

/** The extent of an element's text, which is narrower than the element when the text is short. */
function textBox(el: Element | null | undefined): Box | null {
  if (!el) return null;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return union(mergeLines([...range.getClientRects()]));
}

/** The column the article's text runs in: the extent of its headings, paragraphs, code and tables. */
function column(root: Element): Box {
  const boxes: Box[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, pre, ul, ol, table')) {
    // Nested blocks repeat their parent's extent; chrome in a nav or aside is not the article.
    if (el.closest('nav, aside, header, footer')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) boxes.push(toDoc(rect));
  }
  const found = union(boxes);
  if (found) return found;
  const box = toDoc(root.getBoundingClientRect());
  const style = getComputedStyle(root);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  box.x += padLeft;
  box.w -= padLeft + (Number.parseFloat(style.paddingRight) || 0);
  return box;
}

function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** A heading has free space after it. Asked of the range, not the claim: a heading's finding may sit on a word in its section. */
export function inHeading(range: Range): boolean {
  return range.startContainer.parentElement?.closest('h1, h2, h3, h4, h5, h6') != null;
}

/** Pins that would overlap step inward along their row. */
function clear(pin: Layout['pin'], placed: Layout[]): Layout['pin'] {
  const at = { ...pin };
  while (placed.some((o) => Math.abs(o.pin.x - at.x) < STEP && Math.abs(o.pin.y - at.y) < STEP)) {
    at.x -= STEP;
  }
  return at;
}

/** Pins stacked on one row keep reading order, left to right. */
function leftToRight(layouts: Layout[]): Layout[] {
  const rows = new Map<number, Layout[]>();
  for (const l of layouts) {
    const key = Math.round(l.pin.y);
    rows.set(key, [...(rows.get(key) ?? []), l]);
  }
  for (const row of rows.values()) {
    const xs = row.map((l) => l.pin.x).sort((a, b) => a - b);
    row.forEach((l, i) => {
      l.pin.x = xs[i];
      if (l.rule) l.rule.w = xs[i] - l.rule.x;
    });
  }
  return layouts;
}

/**
 * Pins never cover prose. Headings have free space after them; everything else
 * pins to the content's right edge on the claim's first line, like a margin mark.
 */
export function layout(marks: { anchor: Anchor }[], root: Element): Layout[] {
  // Marks belong to the text column, which is often narrower than the root: a host's root may be
  // its whole `<main>`. Measured from the content itself, the root's padded box when there is none.
  const bounds = column(root);
  const room = bounds.x + bounds.w + PIN <= document.documentElement.clientWidth + scrollX;
  const edge = bounds.x + bounds.w - (room ? 4 : PIN - 4);

  const out: Layout[] = [];
  for (const { anchor } of marks) {
    const { claim, range } = anchor;
    if (claim.kind === 'gap') {
      const block = toDoc(range.getBoundingClientRect());
      const y = block.y + block.h + 16;
      // A gap is an insertion: a line where the missing members would go, its buoy at the end.
      const pin = clear({ x: edge, y: y - PIN / 2 }, out);
      out.push({ lines: [], pin, rule: { x: bounds.x, y: pin.y, w: pin.x - bounds.x, h: PIN } });
      continue;
    }
    const lines = mergeLines([...range.getClientRects()]);
    const first = lines[0] ?? toDoc(range.getBoundingClientRect());
    const last = lines[lines.length - 1] ?? first;
    const fence = fenceOf(range.startContainer);

    let pin: Layout['pin'];
    if (inHeading(range)) {
      pin = { x: last.x + last.w + 8, y: last.y + last.h / 2 - PIN / 2 };
    } else if (fence) {
      // On the block's right edge, level with the line the claim is on, so a block
      // with many callouts reads down its margin instead of piling up at one corner.
      const pre = toDoc(fence.getBoundingClientRect());
      const y = Math.min(Math.max(first.y + first.h / 2, pre.y), pre.y + pre.h);
      pin = { x: pre.x + pre.w - PIN / 2, y: y - PIN / 2 };
    } else {
      pin = { x: edge, y: first.y + first.h / 2 - PIN / 2 };
    }
    // The block is the finding to the reader, and the target: a code block whole, prose by its paragraph.
    // Prose is measured by its text, not its element: a heading or a one-line label is ringed as wide
    // as its words, not as wide as the column.
    const holder = fence ?? range.startContainer.parentElement?.closest(BLOCK);
    const box = fence ? toDoc(fence.getBoundingClientRect()) : (textBox(holder) ?? union(lines));
    const ring = box ? { x: box.x - 5, y: box.y - 5, w: box.w + 10, h: box.h + 10 } : undefined;
    out.push({ lines, pin: clear(pin, out), ring });
  }
  return leftToRight(out);
}
