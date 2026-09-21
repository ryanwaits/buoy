/**
 * The overlay: buoys, one popover, one toolbar with its two panels. Lives in a shadow root appended to
 * <body>; the host's content is measured, never touched.
 */

import { anchorClaims } from '../anchor';
import { BLOCK, codeLine, fenceOf } from '../anchor/token';
import { checkCommand, offending, sentence, signatureOf, toPrompt, truthSlice } from '../output';
import {
  type Evidence,
  evidenceOf,
  isFinding,
  isHidden,
  issueCount,
  issueKey,
  KINDS,
  type Kind,
  kindOf,
  maxScore,
} from '../policy';
import { findRoot } from '../roots';
import { loadStore } from '../store';
import type { Anchor, JudgedClaim, JudgedPage, Manifest, SpecSlice } from '../types';
import { inHeading, type Layout, layout, PIN } from './geometry';
import { type Mark, toMarks } from './marks';
import { STYLES } from './styles';

export type MountOptions = {
  /** Pages for this document, or a `buoy build` manifest resolved by `location.pathname`. */
  data: JudgedPage[] | Manifest;
  /** The host's rendered article, as a selector. Defaults to the first known docs container. */
  root?: string;
};

const esc = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m] ?? m,
  );

const svg = (d: string, size = 24): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON = {
  // A pillar buoy heeled 8deg. The mask sinks the hull below the waterline and clears a gap around the wave.
  buoy: svg(
    '<mask id="sea" maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32" stroke="none"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/><path d="M-4 17.5H2q2.5-1.6 5 0t5 0 5 0 5 0h6V28H-4Z" fill="#000"/><path d="M2 17.5q2.5-1.6 5 0t5 0 5 0 5 0" stroke="#000" stroke-width="3.5"/></mask>' +
      '<g mask="url(#sea)"><g transform="rotate(8 12 17.5)"><path d="M6.31 21.5 8.95 10.27Q9.24 9 10.55 9h2.91q1.3 0 1.59 1.27L17.69 21.5M8.15 13.68h7.7M12 9V7"/><circle cx="12" cy="5.5" r="1.5" style="fill:var(--mark)"/></g></g>' +
      '<path d="M2 17.5q2.5-1.6 5 0t5 0 5 0 5 0M7 20.72q2.5 1.6 5 0t5 0"/>',
  ),
  down: svg('<path d="M8 10l4 4 4-4"/>', 20),
  filter: svg('<path d="M5 7h14M8 12h8M10.5 17h3"/>'),
  pages: svg(
    '<rect x="5.5" y="5" width="13" height="14" rx="2.5"/><path d="M9 9.5h6M9 12.5h6M9 15.5h3.5"/>',
  ),
  copy: svg(
    '<rect x="9" y="9" width="10" height="10" rx="2.5"/><path d="M15 9V7.5A2.5 2.5 0 0012.5 5h-5A2.5 2.5 0 005 7.5v5A2.5 2.5 0 007.5 15H9"/>',
  ),
  undo: svg('<path d="M8 8L5 11l3 3"/><path d="M5 11h9a5 5 0 010 10h-3"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  done: svg('<path d="M6 12.5l4 4 8-9"/>'),
  chevron:
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>',
  check:
    '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>',
};

/** A sentence from `output.sentence`: escaped, its backticked identifiers as code, the wrong word washed. */
const say = (text: string, word = ''): string =>
  esc(text).replace(
    /`([^`]+)`/g,
    (_, code: string) => `<code${code === esc(word) ? ' class="w"' : ''}>${code}</code>`,
  );

const clip = (text: string, max = 160): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Proved or likely, and for likely the odds. The only place the two are told apart. `aside` is where you are: "2 here", "1 of 3". */
function evidenceHTML(claims: JudgedClaim[], aside: string): string {
  const proved = claims.some((c) => c.rule);
  const top = Math.round(Math.max(...claims.map((c) => maxScore(c))) * 100);
  const head = proved
    ? '<b>Proved</b><span>code checked it</span>'
    : `<b>Likely</b><span>a model's read · ${top}%</span>`;
  return `<div class="pop-h">${head}${aside}</div>`;
}

/** A signature's parameters, split at the top level: `f(a: T, b?: { x: U }): R` gives `a: T` and `b?: { x: U }`. */
export function paramsOf(signature: string): { name: string; text: string }[] {
  const open = signature.indexOf('(');
  if (open < 0) return [];
  const parts: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < signature.length; i++) {
    const ch = signature[i];
    if ('([{<'.includes(ch)) depth++;
    else if (')]}'.includes(ch) || (ch === '>' && signature[i - 1] !== '=')) depth--;
    if (depth === 1 && ch === ',') {
      parts.push(signature.slice(from, i));
      from = i + 1;
    }
    if (depth === 0) {
      parts.push(signature.slice(from, i));
      break;
    }
  }
  return parts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ name: /^(?:\.\.\.)?([\w$]+)/.exec(text)?.[1] ?? text, text }));
}

/**
 * The one fact that settles a finding, shown before anything is unfolded. Picked by
 * what the finding is: the members a type does have, the spec's own deprecation note,
 * the parameters the rule names with the rest counted. `whole` says the line is the
 * full signature already, so Details need not repeat it.
 */
function proofOf(
  claim: JudgedClaim,
  signature: string | null,
): { label: string; html: string; whole: boolean } | null {
  const has = claim.jev?.has ?? [];
  if (has.length) {
    const more = has.length > 12 ? `<span class="dim"> · ${has.length - 12} more</span>` : '';
    return { label: 'has', html: `${esc(has.slice(0, 12).join(' · '))}${more}`, whole: false };
  }
  const ref = claim.specRef;
  if (ref?.deprecated && ref.deprecationNote)
    return {
      label: 'spec',
      html: `@deprecated ${esc(clip(ref.deprecationNote, 140))}`,
      whole: false,
    };
  if (!signature) return null;
  const params = paramsOf(signature);
  const named = new Set(offending(claim));
  const hit = params.filter((p) => named.has(p.name));
  const shown = hit.length ? hit.map((p) => p.text) : params.slice(0, 4).map((p) => p.name);
  const rest = params.length - shown.length;
  if (signature.length <= 72 || !shown.length)
    return { label: 'spec', html: esc(clip(signature, 96)), whole: signature.length <= 96 };
  const more = rest > 0 ? `<span class="dim"> · ${rest} more</span>` : '';
  return { label: 'spec', html: `${esc(shown.join(', '))}${more}`, whole: false };
}

/** The passage as the page shows it, with the word that is wrong marked. */
function docsRow(mark: Mark): string | null {
  const { claim, range } = mark.anchor;
  if (mark.token) {
    const word = range.toString();
    // What Drift read is the best quote when it is short and has the word in it.
    const quote = claim.text.replace(/\s+/g, ' ').trim();
    const inQuote = quote.length <= 160 ? quote.indexOf(word) : -1;
    if (inQuote >= 0)
      return `${esc(quote.slice(0, inQuote))}<mark>${esc(word)}</mark>${esc(quote.slice(inQuote + word.length))}`;
    const parent = range.startContainer.parentElement;
    const block = fenceOf(parent) ?? parent?.closest(BLOCK);
    if (!block) return null;
    // Code is read a line at a time.
    const code = fenceOf(block) === block;
    const unit = (code ? codeLine(range.startContainer, block) : null) ?? block;
    // Where the word sits, measured rather than searched: the same word may come earlier.
    const before = range.cloneRange();
    before.selectNodeContents(unit);
    before.setEnd(range.startContainer, range.startOffset);
    const raw = unit.textContent ?? '';
    const at = before.toString().length;
    const next = raw.indexOf('\n', at);
    const line = code ? [raw.lastIndexOf('\n', at - 1) + 1, next < 0 ? raw.length : next] : null;
    // Prose, and code that turns out to be one long line, are read as the words around it.
    const [from, to] =
      line && line[1] - line[0] <= 140
        ? line
        : [Math.max(0, at - 70), Math.min(raw.length, at + word.length + 70)];
    const cut = !line || line[1] - line[0] > 140;
    const tidy = (text: string): string => esc(text.replace(/\s+/g, ' '));
    const lead = tidy(raw.slice(from, at)).trimStart();
    const tail = tidy(raw.slice(at + word.length, to)).trimEnd();
    return `${cut && from > 0 ? '…' : ''}${lead}<mark>${esc(word)}</mark>${tail}${cut && to < raw.length ? '…' : ''}`;
  }
  const text = claim.text.replace(/\s+/g, ' ').trim();
  const ref = claim.specRef;
  if (!text || text === ref?.export || text === ref?.member) return null;
  return esc(clip(text));
}

type PopoverInput = {
  mark: Mark;
  page: JudgedPage | undefined;
  slices: SpecSlice[];
  note: string;
  /** Position among the places that show the same issue. */
  same: { at: number; of: number };
};

function popoverHTML({ mark, page, slices, note, same }: PopoverInput): string {
  const { claims } = mark;
  const first = claims[0];
  const context = mark.anchor.range.startContainer.parentElement?.closest(BLOCK)?.textContent ?? '';
  const gaps = first.kind === 'gap';
  const word = mark.token ? mark.anchor.range.toString() : '';
  const types = [...new Set(claims.map((c) => c.specRef?.export).filter(Boolean))];
  const lead = gaps
    ? `<p class="say">${claims.length === 1 ? say(sentence(first)) : `${claims.length} members of ${types.map((t) => `<code>${esc(String(t))}</code>`).join(', ')} are never mentioned in this section.`}</p>`
    : claims.length === 1
      ? `<p class="say">${say(sentence(first, context), word)}</p>`
      : '';
  const list =
    claims.length > 1
      ? `<ul class="says">${claims
          .map((c) => {
            const label = gaps
              ? `<code class="mono">${esc(signatureOf(truthSlice(c, slices)) ?? c.specRef?.member ?? c.text)}</code>`
              : `<span class="say">${say(sentence(c, context), word)}</span>`;
            return `<li>${label}<button type="button" data-act="dismiss" data-id="${esc(c.id)}" aria-label="Not a problem: ${esc(c.specRef?.member ?? c.text)}">dismiss</button></li>`;
          })
          .join('')}</ul>`
      : '';
  const docs = gaps ? null : docsRow(mark);
  const signature = gaps && claims.length > 1 ? null : signatureOf(truthSlice(first, slices));
  const proof = gaps ? null : proofOf(first, signature);
  const declared = first.specRef ? page?.declared?.[first.specRef.export] : undefined;
  const ref = first.specRef;
  const rows = [
    docs ? `<dt>docs</dt><dd>${docs}</dd>` : '',
    signature && !proof?.whole ? `<dt>spec</dt><dd>${esc(clip(signature, 320))}</dd>` : '',
    // The spec's own words on a deprecation are the evidence; at rest they are the proof line.
    ref?.deprecated && proof?.label !== 'spec'
      ? `<dt></dt><dd>@deprecated ${esc(clip(ref.deprecationNote ?? '', 160))}</dd>`
      : '',
    declared ? `<dt>source</dt><dd>${esc(declared)}</dd>` : '',
    `<dt>check</dt><dd>${esc(checkCommand(first, page))}</dd>`,
  ].join('');
  // Where you are: among the places that show this issue, else among the findings here.
  const aside =
    same.of > 1
      ? `<button type="button" class="where" data-act="same" aria-label="Same issue in ${same.of} places. Go to the next">${same.at} of ${same.of} ›</button>`
      : claims.length > 1
        ? `<i>${claims.length} here</i>`
        : '';
  // The trimmed spec line gives way to the full one when unfolded.
  const trimmed = proof && signature && proof.label === 'spec' && !proof.whole && !ref?.deprecated;
  // A card with a note opens unfolded: what the reader wrote is never hidden from them.
  const unfolded = note.trim() !== '';
  return `${evidenceHTML(claims, aside)}${lead}${list}
    ${proof ? `<dl class="facts mono${trimmed ? ' trimmed' : ''}"><dt>${proof.label}</dt><dd>${proof.html}</dd></dl>` : ''}
    <div class="fold${unfolded ? ' open' : ''}"><div>
      <dl class="facts mono">${rows}</dl>
      <textarea class="note" rows="1" data-note="${esc(first.id)}" aria-label="Note for the writer" placeholder="Add a note for the writer">${esc(note)}</textarea>
    </div></div>
    <div class="pop-f"><button type="button" class="more" data-act="more" aria-expanded="${unfolded}">Details${ICON.chevron}</button><button type="button" class="pill" data-act="dismiss-mark">Not a problem</button><button type="button" class="pill go" data-act="copy-mark">Copy for agent</button></div>`;
}

/**
 * Any CSS colour as sRGB bytes. Computed styles come back as `lab()`, `oklch()`
 * or `color()` on modern hosts (Tailwind 4), so parsing the string is not enough.
 */
function toRgba(color: string): [number, number, number, number] | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

/** Dark when the host paints a dark ground, whatever mechanism it uses to theme. */
function hostTheme(): { theme: 'light' | 'dark'; ground: string } {
  for (const el of [document.body, document.documentElement]) {
    const ground = getComputedStyle(el).backgroundColor;
    const rgba = toRgba(ground);
    if (!rgba || rgba[3] === 0) continue;
    const [r, g, b] = rgba;
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    return { theme: dark ? 'dark' : 'light', ground };
  }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return { theme: dark ? 'dark' : 'light', ground: dark ? '#0f0f10' : '#fff' };
}

/** WCAG contrast ratio of two sRGB colours. */
function contrast(a: number[], b: number[]): number {
  const lum = ([r, g, b]: number[]): number => {
    const f = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A buoy belongs to the page it sits on: the host's heading ink on the host's
 * paper. `null` when the pair would not read; the stylesheet's own pair is used then.
 */
function hostInk(root: Element, ground: string): { ink: string; paper: string } | null {
  const heading = root.querySelector('h1, h2, h3') ?? document.body;
  const ink = getComputedStyle(heading).color;
  const a = toRgba(ink);
  const b = toRgba(ground);
  if (!a || !b || a[3] < 255 || contrast(a, b) < 4.5) return null;
  return { ink, paper: ground };
}

const EVIDENCE: Record<Evidence, [string, string]> = {
  proved: ['Proved', 'code checked it'],
  likely: ['Likely', "a model's read"],
};

const routeOf = (pathname: string): string => pathname.replace(/(.)\/$/, '$1');

/**
 * Mount the review overlay. Returns an unmount function.
 *
 * @example
 * ```ts
 * import { mount } from '@driftdev/buoy';
 * const unmount = mount({ data: manifest });
 * ```
 */
export function mount(options: MountOptions): () => void {
  const { data } = options;

  // Client-side routers swap the article and the route under us; resolve both per sync.
  const currentRoot = (): Element => findRoot<Element>(document, options.root) ?? document.body;
  /** `null` when the manifest has no entry for this route: unchecked, which is not clean. */
  const currentPages = (): JudgedPage[] | null => {
    if (Array.isArray(data)) return data;
    return data.routes[routeOf(location.pathname)] ?? null;
  };

  const store = loadStore();
  const host = document.createElement('buoy-overlay');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLES}</style><div class="layer"></div><div class="navlayer"></div>
    <div class="dock"><div class="bar" role="toolbar" aria-label="Docs review"><button type="button" class="bar-ic" data-act="review">${ICON.buoy}</button><div class="bar-in"></div></div><span class="badge"></span></div>`;
  document.body.append(host);

  const layer = shadow.querySelector('.layer') as HTMLElement;
  const navLayer = shadow.querySelector('.navlayer') as HTMLElement;
  const dock = shadow.querySelector('.dock') as HTMLElement;
  const bar = shadow.querySelector('.bar') as HTMLElement;
  const barIn = shadow.querySelector('.bar-in') as HTMLElement;
  const barIcon = shadow.querySelector('.bar-ic') as HTMLElement;
  const badge = shadow.querySelector('.badge') as HTMLElement;

  let review = true;
  let selected: string | null = null;
  type Panel = 'filter' | 'pages' | 'dismissed';
  let panel: Panel | null = null;
  let anchors: Anchor[] = [];
  let marks: Mark[] = [];
  let unplaced: JudgedClaim[] = [];
  let layouts: Layout[] = [];
  let pages: JudgedPage[] = [];
  let checked = true;

  // Stable ids for the nodes marks hang on, so a mark keeps its identity across syncs.
  const blockIds = new WeakMap<Node, number>();
  let nextBlockId = 0;
  const blockId = (block: Node): number => {
    if (!blockIds.has(block)) blockIds.set(block, nextBlockId++);
    return blockIds.get(block) ?? 0;
  };

  /** Findings the reader has not dismissed; the filter has not been applied. */
  const open = (from: JudgedPage[]): JudgedClaim[] =>
    from.flatMap((p) => p.claims).filter((c) => isFinding(c) && !store.dismissed.has(c.id));
  /** What gets a buoy. */
  const shown = (from: JudgedPage[]): JudgedClaim[] =>
    open(from).filter((c) => !isHidden(c, store.hidden));
  const pageOf = (claim: JudgedClaim): JudgedPage | undefined =>
    pages.find((p) => p.claims.includes(claim));

  type NavMark = { link: HTMLAnchorElement; clip: Element | null; el: HTMLElement };
  let navMarks: NavMark[] = [];

  /**
   * A dot beside the host's own nav links where decisions wait, so you can see where trouble is
   * without visiting every page. Drawn in a fixed layer from the link's rect:
   * sidebars are often fixed or scroll on their own.
   */
  function syncNav(root: Element): void {
    navLayer.replaceChildren();
    navMarks = [];
    if (Array.isArray(data) || !review) return;
    const links = document.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], aside a[href], [role="navigation"] a[href]',
    );
    for (const link of links) {
      if (link.origin !== location.origin || link.hash || root.contains(link)) continue;
      const count = issueCount(shown(data.routes[routeOf(link.pathname)] ?? []));
      if (!count) continue;
      const el = document.createElement('span');
      el.className = 'nd';
      // A dot says there is something here; the number says how much.
      el.innerHTML = `<i></i><b>${count}</b>`;
      navLayer.append(el);
      let clip = link.parentElement;
      while (clip && !/auto|scroll/.test(getComputedStyle(clip).overflowY))
        clip = clip.parentElement;
      navMarks.push({ link, clip, el });
    }
    placeNav();
  }

  function placeNav(): void {
    for (const { link, clip, el } of navMarks) {
      const range = document.createRange();
      range.selectNodeContents(link);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const text = rects[rects.length - 1] ?? link.getBoundingClientRect();
      const y = text.top + text.height / 2;
      const bounds = clip?.getBoundingClientRect();
      el.hidden =
        text.width === 0 || (bounds !== undefined && (y < bounds.top || y > bounds.bottom));
      el.style.left = `${text.right + 7}px`;
      el.style.top = `${y}px`;
    }
  }

  /** Re-anchor and rebuild marks. Buoys animate in only when `enter` is set. */
  function sync(enter = false): void {
    const root = currentRoot();
    const current = currentPages();
    checked = current !== null;
    pages = current ?? [];
    const result = anchorClaims(root, shown(pages));
    // Reading order, which is what the eye follows down the page.
    anchors = result.placed.sort((a, b) =>
      a.range.compareBoundaryPoints(Range.START_TO_START, b.range),
    );
    unplaced = result.unplaced;
    marks = toMarks(anchors, blockId);
    layouts = layout(marks, root);
    if (selected && !marks.some((m) => m.id === selected)) selected = null;

    const html = marks.map((mark, i) => {
      const at = layouts[i];
      const id = esc(mark.id);
      const gap = mark.claims[0].kind === 'gap';
      const n = mark.claims.length;
      // A buoy is a buoy, and says how many findings it holds.
      const text = gap ? `+${n}` : String(n);
      const wide = Math.max(0, text.length - 2) * 7;
      const label = gap
        ? `${n} never mentioned in this section`
        : n > 1
          ? `${n} findings here`
          : 'Finding';
      // Always washed when it is a word or a phrase; a passage of several lines only when pointed at.
      const washed = mark.token || at.lines.length === 1;
      const hl = at.lines
        .map(
          (l) =>
            `<div class="hl${washed ? ' token' : ''}" data-for="${id}" style="left:${l.x - 2}px;top:${l.y - 1}px;width:${l.w + 4}px;height:${l.h + 2}px"></div>`,
        )
        .join('');
      const ring = at.ring
        ? `<div class="ring" data-for="${id}" style="left:${at.ring.x}px;top:${at.ring.y}px;width:${at.ring.w}px;height:${at.ring.h}px"></div>`
        : '';
      const rule = at.rule
        ? `<div class="gapline" data-claim="${id}" style="--i:${i};left:${at.rule.x}px;top:${at.rule.y}px;width:${at.rule.w - wide}px;height:${at.rule.h}px"></div>`
        : '';
      return `${ring}${hl}${rule}<button type="button" class="pin" data-claim="${id}" style="--i:${i};left:${at.pin.x - wide}px;top:${at.pin.y}px${enter ? '' : ';animation:none'}" aria-label="${label}" aria-expanded="false">${text}</button>`;
    });
    layer.querySelectorAll('.ring, .hl, .gapline, .pin').forEach((el) => {
      el.remove();
    });
    layer.insertAdjacentHTML('afterbegin', html.join(''));
    layer.classList.toggle('off', !review);
    markSelected();
    placePopover();
    renderDock();
    syncNav(root);
  }

  const button = (act: string, icon: string, tip: string, key: string, attrs = ''): string =>
    `<button type="button" class="cb" data-act="${act}" data-tip="${tip}" data-key="${key}" aria-label="${tip}" ${attrs}>${icon}</button>`;

  function renderDock(): void {
    const count = issueCount([...anchors.map((a) => a.claim), ...unplaced]);
    const filtered = store.hidden.size > 0;
    const dismissedCount = dismissedIssues().length;
    const state = count
      ? `<button type="button" class="cb next" data-act="next" data-tip="Next finding" data-key="N" aria-label="${count} to review. Next finding">${count}${ICON.down}</button>`
      : `<span class="cb next quiet">${checked ? (filtered ? 'None shown' : 'Clean') : 'Not checked'}</span>`;
    const hasPages = !Array.isArray(data) || unplaced.length > 0;
    barIn.innerHTML = `${state}
      ${button('filter', ICON.filter, 'Filter', 'F', `aria-expanded="${panel === 'filter'}"${filtered ? ' data-held' : ''}`)}
      ${hasPages ? button('pages', ICON.pages, 'Pages', 'P', `aria-expanded="${panel === 'pages'}"`) : ''}
      ${button('copy', ICON.copy, 'Copy for agent', 'C', count ? '' : 'disabled')}
      ${button('dismissed', `${ICON.undo}${dismissedCount ? `<span class="ct">${dismissedCount}</span>` : ''}`, 'Dismissed', 'Z', dismissedCount ? `aria-expanded="${panel === 'dismissed'}"` : 'disabled')}
      <hr>
      ${button('review', ICON.close, 'Close', 'Esc')}`;
    barIcon.setAttribute('aria-label', `Review docs, ${count} to review`);
    barIcon.setAttribute('aria-expanded', String(review));
    badge.textContent = count ? String(count) : '';
    bar.style.setProperty('--w', `${barIn.scrollWidth}px`);
    bar.classList.toggle('open', review);
  }

  function markSelected(): void {
    for (const el of layer.querySelectorAll<HTMLElement>('.pin, .gapline')) {
      const on = el.dataset.claim === selected;
      el.classList.toggle('on', on);
      if (el.matches('.pin')) el.setAttribute('aria-expanded', String(on));
    }
    for (const el of layer.querySelectorAll<HTMLElement>('.hl, .ring')) {
      el.classList.toggle('on', el.dataset.for === selected);
    }
  }

  function filterHTML(): string {
    const all = open(pages);
    const row = (key: string, label: string, hint: string, claims: JudgedClaim[]): string =>
      `<button type="button" class="opt" role="menuitemcheckbox" aria-checked="${!store.hidden.has(key)}" data-act="toggle" data-key="${key}"><span class="chk">${ICON.check}</span>${label}${hint ? `<small>${hint}</small>` : ''}<span class="n">${issueCount(claims)}</span></button>`;
    const evidence = (Object.keys(EVIDENCE) as Evidence[]).map((e) =>
      row(
        e,
        EVIDENCE[e][0],
        EVIDENCE[e][1],
        all.filter((c) => evidenceOf(c) === e),
      ),
    );
    const kinds = (Object.keys(KINDS) as Kind[])
      .map((k) => ({ k, claims: all.filter((c) => kindOf(c) === k) }))
      .filter(({ k, claims }) => claims.length || store.hidden.has(k))
      .map(({ k, claims }) => row(k, KINDS[k], '', claims));
    const hiddenCount = issueCount(all) - issueCount(shown(pages));
    return `<header><b>Filter</b><span>Choose what gets a buoy.</span></header>
      <p class="grp">Evidence</p>${evidence.join('')}
      ${kinds.length ? `<p class="grp">Kind</p>${kinds.join('')}` : ''}
      <footer><span>${hiddenCount ? `${hiddenCount} hidden` : 'Nothing hidden'}</span>${store.hidden.size ? '<button type="button" data-act="clear">Clear</button>' : ''}</footer>`;
  }

  function pagesHTML(): string {
    const here = routeOf(location.pathname);
    const routes = Array.isArray(data) ? {} : data.routes;
    const rows = Object.keys(routes)
      .sort()
      .map((route) => {
        const count = issueCount(shown(routes[route]));
        return `<a class="opt${route === here ? ' cur' : ''}${count ? '' : ' dim'}" href="${esc(route)}"${route === here ? ' aria-current="page"' : ''}>${esc(route)}<span class="n">${count || 'clean'}</span></a>`;
      });
    if (!Array.isArray(data) && !(here in routes))
      rows.unshift(
        `<span class="opt cur dim">${esc(here)}<span class="n">not checked</span></span>`,
      );
    const total = issueCount(Object.values(routes).flatMap((r) => shown(r)));
    const withFindings = Object.values(routes).filter((r) => shown(r).length).length;
    // Surfaced, never dropped: findings this page gave no place for.
    const lost = unplaced.length
      ? `<p class="grp">Not found on this page</p><ul class="lost">${unplaced
          .map(
            (c) =>
              `<li><p>${say(sentence(c))}</p><small class="mono">${esc(clip(c.text, 80))} · ${esc(c.locator.path)}:${c.locator.start.line}</small></li>`,
          )
          .join('')}</ul>`
      : '';
    return `<header><b>Pages</b><span>Where Buoy looked, and what it found.</span></header>
      ${rows.join('')}${lost}
      ${rows.length ? `<footer><span>${total} across ${withFindings} page${withFindings === 1 ? '' : 's'}</span>${total ? '<button type="button" data-act="copy-all">Copy all</button>' : ''}</footer>` : ''}`;
  }

  type Dismissed = { route: string; claims: JudgedClaim[] };

  /** What the reader waved off, one row per decision, this page first. Nothing dismissed is ever out of reach. */
  function dismissedIssues(): Dismissed[] {
    const here = routeOf(location.pathname);
    const routes = Array.isArray(data) ? { [here]: data } : data.routes;
    const order = Object.keys(routes).sort(
      (a, b) => Number(b === here) - Number(a === here) || a.localeCompare(b),
    );
    return order.flatMap((route) => {
      const byIssue = new Map<string, JudgedClaim[]>();
      for (const claim of routes[route].flatMap((p) => p.claims)) {
        if (!isFinding(claim) || !store.dismissed.has(claim.id)) continue;
        byIssue.set(issueKey(claim), [...(byIssue.get(issueKey(claim)) ?? []), claim]);
      }
      return [...byIssue.values()].map((claims) => ({ route, claims }));
    });
  }

  function dismissedHTML(): string {
    const issues = dismissedIssues();
    const here = routeOf(location.pathname);
    let last = '';
    const rows = issues.map(({ route, claims }, i) => {
      const head =
        route === last ? '' : `<p class="grp">${route === here ? 'This page' : esc(route)}</p>`;
      last = route;
      const places = claims.length > 1 ? `<small>${claims.length} places</small>` : '';
      return `${head}<div class="opt gone"><span><span class="say">${say(sentence(claims[0]))}</span>${places}</span><button type="button" data-act="restore-one" data-i="${i}">Restore</button></div>`;
    });
    return `<header><b>Dismissed</b><span>What you marked "not a problem". Kept in this browser.</span></header>
      ${rows.join('')}
      <footer><span>${issues.length} dismissed</span><button type="button" data-act="restore">Restore all</button></footer>`;
  }

  function restore(claims: JudgedClaim[] | null): void {
    if (claims) for (const c of claims) store.dismissed.delete(c.id);
    else store.dismissed.clear();
    store.save();
    sync(true);
    if (!store.dismissed.size) panel = null;
    renderPanel();
    renderDock();
  }

  function renderPanel(): void {
    dock.querySelector('.panel')?.remove();
    // A panel covers the page's buoys; a popover covers the toolbar.
    dock.classList.toggle('up', panel !== null);
    if (!panel) return;
    const el = document.createElement('div');
    el.className = 'panel';
    el.setAttribute('role', panel === 'filter' ? 'menu' : 'dialog');
    el.setAttribute(
      'aria-label',
      { filter: 'Filter', pages: 'Pages', dismissed: 'Dismissed' }[panel],
    );
    el.tabIndex = -1;
    el.innerHTML = { filter: filterHTML, pages: pagesHTML, dismissed: dismissedHTML }[panel]();
    dock.append(el);
  }

  function setPanel(to: Panel | null): void {
    const was = panel;
    panel = to === panel ? null : to;
    if (panel) select(null);
    if (was === null && panel === null) return;
    renderPanel();
    renderDock();
    if (panel) dock.querySelector<HTMLElement>('.panel')?.focus({ preventScroll: true });
  }

  function closePopover(): void {
    const pop = layer.querySelector('.pop:not(.exit)');
    if (!pop) return;
    pop.classList.add('exit');
    setTimeout(() => pop.remove(), 150);
  }

  function placePopover(): void {
    const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
    const i = marks.findIndex((m) => m.id === selected);
    if (!pop || i < 0) return;
    const at = layouts[i];
    const width = pop.offsetWidth;
    // Under the word when the buoy is on one, so the pointer can walk from the word into the card.
    const left = (marks[i].token || inHeading(marks[i].anchor.range)) && at.lines.length > 0;
    const lines = Math.max(...at.lines.map((l) => l.y + l.h));
    const bottom = left ? lines - 2 : Math.max(at.pin.y + PIN, lines);
    const wanted = left ? at.lines[0].x - 4 : at.pin.x + PIN - width;
    const max = scrollX + document.documentElement.clientWidth - width - 16;
    pop.style.left = `${Math.max(scrollX + 16, Math.min(wanted, max))}px`;
    pop.style.top = `${bottom + 10}px`;
    pop.style.setProperty('--ox', left ? '0' : '100%');
  }

  /** The places that show the same issue as this one, in reading order. */
  const sameAs = (mark: Mark): Mark[] => {
    const keys = new Set(mark.claims.map(issueKey));
    return marks.filter((m) => m.claims.some((c) => keys.has(issueKey(c))));
  };

  function markHTML(mark: Mark): string {
    const same = sameAs(mark);
    return popoverHTML({
      mark,
      page: pageOf(mark.claims[0]),
      slices: pages.flatMap((p) => p.slices),
      note: store.notes[mark.claims[0].id] ?? '',
      same: { at: same.indexOf(mark) + 1, of: same.length },
    });
  }

  function select(id: string | null, via: { keyboard?: boolean; scroll?: boolean } = {}): void {
    selected = selected === id ? null : id;
    hoverOpened = false;
    closePopover();
    if (selected && panel) setPanel(null);
    markSelected();
    dock.classList.toggle('away', selected !== null);
    const mark = marks.find((m) => m.id === selected);
    if (!mark) return;
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Finding');
    pop.innerHTML = markHTML(mark);
    pop.tabIndex = -1;
    layer.append(pop);
    placePopover();
    // Keyboard users land in the finding; pointer users keep their place.
    if (via.keyboard) pop.focus({ preventScroll: true });
    if (via.scroll !== false) {
      requestAnimationFrame(() => pop.scrollIntoView({ block: 'nearest', behavior: motion() }));
    }
  }

  const motion = (): ScrollBehavior =>
    matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  /** Open a mark and land it a third down, with its whole popover on screen. */
  function visit(mark: Mark): void {
    if (mark.id !== selected) select(mark.id, { scroll: false });
    const i = marks.indexOf(mark);
    const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
    const popBottom = pop ? pop.offsetTop + pop.offsetHeight + 24 : 0;
    const top = Math.max(layouts[i].pin.y - innerHeight / 3, popBottom - innerHeight);
    scrollTo({ top, behavior: motion() });
  }

  /** What to look at next: what code proved, then what a model thinks by the odds, then down the page. Wraps. */
  function next(step = 1): void {
    if (!marks.length) return;
    const score = (m: Mark): number =>
      m.claims.some((c) => c.rule) ? 2 : Math.max(...m.claims.map((c) => maxScore(c)));
    const order = [...marks].sort(
      (a, b) => score(b) - score(a) || marks.indexOf(a) - marks.indexOf(b),
    );
    const current = order.findIndex((m) => m.id === selected);
    const to = current < 0 ? (step > 0 ? 0 : order.length - 1) : current + step;
    visit(order[(to + order.length) % order.length]);
  }

  function setReview(on: boolean): void {
    select(null);
    setPanel(null);
    review = on;
    if (on) {
      sync(true);
      return;
    }
    layer.classList.add('leave');
    navLayer.replaceChildren();
    navMarks = [];
    renderDock();
    setTimeout(() => {
      layer.classList.remove('leave');
      layer.classList.add('off');
    }, 200);
  }

  async function copy(
    el: HTMLElement | null,
    from: JudgedPage[],
    claims: JudgedClaim[],
    route: string,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(toPrompt(from, new Set(claims), store.notes, route));
    } catch {
      return;
    }
    if (!el) return;
    const was = el.innerHTML;
    el.innerHTML = el.matches('.cb') ? ICON.done : 'Copied';
    el.classList.add('done');
    setTimeout(() => {
      el.innerHTML = was;
      el.classList.remove('done');
    }, 1400);
  }

  const copyPage = (el: HTMLElement | null): Promise<void> =>
    copy(el, pages, [...anchors.map((a) => a.claim), ...unplaced], location.pathname);

  function copyAll(el: HTMLElement): Promise<void> {
    const all = Array.isArray(data) ? data : Object.values(data.routes).flat();
    const routes = Array.isArray(data)
      ? 1
      : Object.values(data.routes).filter((r) => shown(r).length).length;
    return copy(el, all, shown(all), `${routes} page${routes === 1 ? '' : 's'}`);
  }

  /** One decision covers every place on the page that shows the same issue. */
  function dismiss(claims: JudgedClaim[], whole: boolean): void {
    const keys = new Set(claims.map(issueKey));
    const ids = open(pages)
      .filter((c) => keys.has(issueKey(c)))
      .map((c) => c.id);
    const apply = (): void => {
      for (const id of ids) store.dismissed.add(id);
      store.save();
      sync();
    };
    if (!whole) {
      // One of several here: the buoy stays, its list and count shrink in place.
      apply();
      const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
      const left = marks.find((m) => m.id === selected);
      if (pop && left) pop.innerHTML = markHTML(left);
      return;
    }
    layer.querySelector(`.pin[data-claim="${CSS.escape(selected ?? '')}"]`)?.classList.add('exit');
    select(null);
    setTimeout(apply, 200);
  }

  function toggleFilter(key: string): void {
    if (!store.hidden.delete(key)) store.hidden.add(key);
    store.save();
    sync();
    renderPanel();
  }

  function onClick(event: Event): void {
    const target = event.target as HTMLElement;
    const claimId = target.closest<HTMLElement>('[data-claim]')?.dataset.claim;
    if (claimId) {
      // detail 0 = activated from the keyboard.
      select(claimId, { keyboard: (event as MouseEvent).detail === 0 });
      return;
    }
    const el = target.closest<HTMLElement>('[data-act]');
    const mark = marks.find((m) => m.id === selected);
    switch (el?.dataset.act) {
      case 'review':
        setReview(!review);
        break;
      case 'next':
        next((event as MouseEvent).shiftKey ? -1 : 1);
        break;
      case 'filter':
      case 'pages':
      case 'dismissed':
        setPanel(el.dataset.act);
        break;
      case 'toggle':
        if (el.dataset.key) toggleFilter(el.dataset.key);
        break;
      case 'clear':
        store.hidden.clear();
        store.save();
        sync();
        renderPanel();
        break;
      case 'copy':
        void copyPage(el);
        break;
      case 'copy-all':
        void copyAll(el);
        break;
      case 'copy-mark':
        if (mark) void copy(el, pages, mark.claims, location.pathname);
        break;
      case 'restore':
        restore(null);
        break;
      case 'restore-one':
        restore(dismissedIssues()[Number(el.dataset.i)]?.claims ?? []);
        break;
      case 'more': {
        const pop = layer.querySelector('.pop:not(.exit)');
        const on = pop?.querySelector('.fold')?.classList.toggle('open') ?? false;
        pop?.classList.toggle('open', on);
        el.setAttribute('aria-expanded', String(on));
        // Once it has grown, keep the whole card on screen.
        if (on)
          setTimeout(() => pop?.scrollIntoView({ block: 'nearest', behavior: motion() }), 240);
        break;
      }
      case 'same': {
        if (!mark) break;
        const same = sameAs(mark);
        visit(same[(same.indexOf(mark) + 1) % same.length]);
        break;
      }
      case 'dismiss-mark':
        if (mark) dismiss(mark.claims, true);
        break;
      case 'dismiss': {
        const claim = mark?.claims.find((c) => c.id === el.dataset.id);
        if (mark && claim) dismiss([claim], mark.claims.length === 1);
        break;
      }
    }
  }

  function onInput(event: Event): void {
    const input = event.target as HTMLTextAreaElement;
    const id = input.dataset.note;
    if (!id) return;
    store.notes[id] = input.value;
    store.save();
  }

  /** The wash follows the pointer: on entering a buoy, off on leaving it. The open finding and the wrong word stay lit. */
  function onHover(event: Event): void {
    const to = event.type === 'pointerout' ? (event as PointerEvent).relatedTarget : event.target;
    const id = (to as HTMLElement | null)?.closest?.<HTMLElement>('[data-claim]')?.dataset.claim;
    for (const el of layer.querySelectorAll<HTMLElement>('.hl, .ring')) {
      el.classList.toggle('on', el.dataset.for === id || el.dataset.for === selected);
    }
  }

  type Hit = { mark: Mark; exact: boolean };

  /**
   * What a point is on. The flagged text itself first, the smallest wins: a word inside
   * a passage. Failing that the block it belongs to, and of several findings in one
   * block, the one whose line is nearest.
   */
  function markAt(x: number, y: number): Hit | null {
    let exact: { mark: Mark; area: number } | null = null;
    let near: { mark: Mark; away: number } | null = null;
    layouts.forEach((at, i) => {
      for (const l of at.lines) {
        if (x < l.x - 2 || x > l.x + l.w + 2 || y < l.y - 1 || y > l.y + l.h + 1) continue;
        const area = at.lines.reduce((sum, b) => sum + b.w * b.h, 0);
        if (!exact || area < exact.area) exact = { mark: marks[i], area };
      }
      const r = at.ring;
      if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return;
      const away = Math.abs(y - (at.pin.y + PIN / 2));
      if (!near || away < near.away) near = { mark: marks[i], away };
    });
    const hit = (exact ?? near) as { mark: Mark } | null;
    return hit ? { mark: hit.mark, exact: exact !== null } : null;
  }

  // The host's text is never covered by anything that takes the pointer, so hovering it is
  // read from the pointer's position: over a flagged block its ring shows and a click opens the card;
  // rest on the flagged text itself and the card opens on its own, leave and it closes.
  // A card the reader clicked, or clicked into, stays until they close it.
  let hoverOpened = false;
  let pending: string | null = null;
  let muted: string | null = null;
  let openTimer = 0;
  let closeTimer = 0;
  let moveFrame = 0;

  function hover(hit: Hit | 'ours' | null): void {
    if (hit === 'ours') {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      pending = null;
      closeTimer = 0;
      return;
    }
    for (const el of layer.querySelectorAll<HTMLElement>('.hl, .ring')) {
      el.classList.toggle('on', el.dataset.for === hit?.mark.id || el.dataset.for === selected);
    }
    if (!hit?.exact || hit.mark.id !== muted) muted = null;
    const at = hit?.exact && hit.mark.id !== muted ? hit.mark : null;
    if (hit && !at) {
      // In the block but off the text: nothing opens, and a card opened from here stays.
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      pending = null;
      closeTimer = 0;
      return;
    }
    if (at) {
      clearTimeout(closeTimer);
      closeTimer = 0;
      if (at.id === selected || (selected && !hoverOpened)) {
        clearTimeout(openTimer);
        pending = null;
        return;
      }
      if (pending === at.id) return;
      clearTimeout(openTimer);
      pending = at.id;
      openTimer = setTimeout(() => {
        pending = null;
        if (selected === at.id || panel) return;
        select(at.id, { scroll: false });
        hoverOpened = true;
      }, 200) as unknown as number;
      return;
    }
    clearTimeout(openTimer);
    pending = null;
    if (hoverOpened && selected && !closeTimer) {
      closeTimer = setTimeout(() => {
        closeTimer = 0;
        if (hoverOpened) select(null);
      }, 350) as unknown as number;
    }
  }

  const onMove = (event: PointerEvent): void => {
    if (!review || event.pointerType === 'touch') return;
    const ours = event.composedPath().includes(host);
    const { pageX, pageY } = event;
    cancelAnimationFrame(moveFrame);
    moveFrame = requestAnimationFrame(() => hover(ours ? 'ours' : markAt(pageX, pageY)));
  };

  const onOutside = (event: Event): void => {
    if (event.composedPath().includes(host)) {
      // Clicking into a card keeps it.
      hoverOpened = false;
      return;
    }
    // On a flagged block: the click that follows decides.
    const { pageX, pageY } = event as PointerEvent;
    if (review && markAt(pageX, pageY)) return;
    setPanel(null);
    if (selected) select(null);
  };

  /** The whole block is the target, not just its buoy. Selecting text and the host's own controls are left alone. */
  const onPageClick = (event: MouseEvent): void => {
    if (!review || event.composedPath().includes(host)) return;
    if (!getSelection()?.isCollapsed) return;
    const target = event.target as Element | null;
    if (target?.closest?.('a, button, input, textarea, select, summary, label, [role="button"]'))
      return;
    const hit = markAt(event.pageX, event.pageY);
    if (!hit) return;
    // A card that opened on its own is kept by the click; otherwise the block toggles, as its buoy does.
    if (hit.mark.id === selected && hoverOpened) {
      hoverOpened = false;
      return;
    }
    const closing = hit.mark.id === selected;
    select(hit.mark.id, { scroll: false });
    // Closed by hand: resting here must not open it again until the pointer has been elsewhere.
    muted = closing ? hit.mark.id : null;
  };

  const KEYS: Record<string, (event: KeyboardEvent) => void> = {
    n: (event) => next(event.shiftKey ? -1 : 1),
    f: () => setPanel('filter'),
    p: () => setPanel('pages'),
    c: () => void copyPage(barIn.querySelector<HTMLElement>('[data-act="copy"]')),
    z: () => {
      if (store.dismissed.size) setPanel('dismissed');
    },
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (panel) {
        setPanel(null);
        return;
      }
      if (!selected) return;
      const pin = layer.querySelector<HTMLElement>(`.pin[data-claim="${CSS.escape(selected)}"]`);
      select(null);
      // Give focus back to where the reader was.
      if (shadow.activeElement) pin?.focus({ preventScroll: true });
      return;
    }
    // Single letters belong to the page whenever the reader is typing, here or in the host.
    if (!review || event.metaKey || event.ctrlKey || event.altKey) return;
    const at = event.composedPath()[0] as HTMLElement | undefined;
    if (at?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at?.tagName ?? '')) return;
    const run = KEYS[event.key.toLowerCase()];
    if (!run) return;
    event.preventDefault();
    run(event);
  };

  function applyTheme(): void {
    const { theme, ground } = hostTheme();
    host.dataset.theme = theme;
    const pair = hostInk(currentRoot(), ground);
    const fallback = theme === 'dark' ? ['#f5f5f5', '#1a1a1a'] : ['#1a1a1a', '#fff'];
    host.style.setProperty('--auto-ink', pair?.ink ?? fallback[0]);
    host.style.setProperty('--auto-paper', pair?.paper ?? fallback[1]);
  }

  // Hosts re-render, reflow and swap themes. Re-measure, debounced to a frame.
  let frame = 0;
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      applyTheme();
      if (review) sync();
    });
  };
  // Our own marks live in the shadow root, so they never feed back into these.
  const resize = new ResizeObserver(schedule);
  resize.observe(document.body);
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
  const themeWatch = new MutationObserver(schedule);
  themeWatch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme'],
  });

  // Capture: inner sidebar scrollers don't bubble scroll events.
  let navFrame = 0;
  const onScroll = (): void => {
    cancelAnimationFrame(navFrame);
    navFrame = requestAnimationFrame(placeNav);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // Hosts that follow the OS scheme repaint with no DOM change to observe.
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', schedule);

  shadow.addEventListener('click', onClick);
  shadow.addEventListener('input', onInput);
  shadow.addEventListener('pointerover', onHover);
  shadow.addEventListener('pointerout', onHover);
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('click', onPageClick);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', schedule);

  applyTheme();
  sync(true);
  document.fonts?.ready.then(schedule);

  return () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(navFrame);
    document.removeEventListener('scroll', onScroll, { capture: true });
    resize.disconnect();
    mutation.disconnect();
    themeWatch.disconnect();
    scheme.removeEventListener('change', schedule);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('click', onPageClick);
    cancelAnimationFrame(moveFrame);
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', schedule);
    host.remove();
  };
}
