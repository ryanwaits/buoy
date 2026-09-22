/**
 * The overlay: buoys, one popover, one toolbar with its two panels. Lives in a shadow root appended to
 * <body>; the host's content is measured, never touched.
 */

import { anchorClaims } from '../anchor';
import { BLOCK, codeLine, fenceOf } from '../anchor/token';
import { offending, plainDoc, sentence, signatureOf, toPrompt, truthSlice } from '../output';
import {
  DIMENSIONS,
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
  topDimension,
} from '../policy';
import { findRoot } from '../roots';
import { type Decision, loadStore } from '../store';
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
  /** A resolved buoy's face. */
  tick: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>',
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
  // `f({ a: T, b?: U })`: the keys of a destructured parameter are its parameters.
  const braced = /^([^(]*\()\s*\{\s*([\s\S]*?)\s*\}\s*(\)[^)]*)$/.exec(signature);
  if (braced) return paramsOf(`${braced[1]}${braced[2]}${braced[3]}`);
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
      html: `@deprecated ${esc(clip(plainDoc(ref.deprecationNote), 140))}`,
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
  /** Which finding at this place the card is on. A section's gaps are one finding. */
  at: number;
  page: JudgedPage | undefined;
  slices: SpecSlice[];
  /** The reader's decision on this finding, when it has one. */
  decision: Decision | undefined;
  /** The note field is open: the reader is saying what should happen. */
  resolving: boolean;
  /** A Details row pushed over the card. */
  view: View | null;
  /** Position among the places that show the same issue. */
  same: { at: number; of: number };
};

type View = 'docs' | 'spec' | 'source' | 'why';

/** The findings a card walks: one per claim, except a section's gaps, which are one. */
export function cardsOf(mark: Mark): JudgedClaim[][] {
  return mark.claims[0].kind === 'gap' ? [mark.claims] : mark.claims.map((c) => [c]);
}

/** `Room.roomId` → `roomId`; `Room.send(data: string): void` → `send` and `(data: string)`. */
export function memberLabel(
  signature: string,
  exportName?: string,
): { name: string; params: string } {
  const own =
    exportName && signature.startsWith(`${exportName}.`)
      ? signature.slice(exportName.length + 1)
      : signature;
  const open = own.indexOf('(');
  if (open < 0) return { name: own, params: '' };
  let depth = 0;
  for (let i = open; i < own.length; i++) {
    if ('([{<'.includes(own[i])) depth++;
    else if (')]}'.includes(own[i]) || (own[i] === '>' && own[i - 1] !== '=')) depth--;
    if (depth === 0) return { name: own.slice(0, open), params: own.slice(open, i + 1) };
  }
  return { name: own.slice(0, open), params: own.slice(open) };
}

/** The rows under Details, and what each pushes over the card. Only what the manifest holds today. */
function viewsOf(
  mark: Mark,
  claim: JudgedClaim,
  page: JudgedPage | undefined,
  signature: string | null,
): { key: View; brief: string; html: string }[] {
  const views: { key: View; brief: string; html: string }[] = [];
  const ref = claim.specRef;
  const loc = claim.locator;
  const rendered = page?.source?.mode === 'rendered';
  if (claim.kind !== 'gap') {
    const quote = docsRow(mark) ?? (claim.text ? esc(clip(claim.text)) : '');
    const where = [
      rendered ? null : `line ${loc.start.line}`,
      loc.headingText ? `under “${esc(loc.headingText)}”` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    views.push({
      key: 'docs',
      brief: where || esc(loc.path),
      html: `<div class="meta"><span>${esc(loc.path)}</span>${where ? `<span>·</span><span>${where}</span>` : ''}</div>${quote ? `<p class="quote mono">${quote}</p>` : ''}${rendered ? '<p class="cap">Read from the rendered page, so there is no file to open. Search the repo for the quoted text.</p>' : ''}`,
    });
  }
  if (signature || ref) {
    const record = ref ? page?.records?.[ref.export] : undefined;
    const named = new Set(offending(claim));
    const missing = claim.rule?.type === 'prose-missing-required';
    const unknown = claim.rule?.type === 'prose-unknown-key';
    // The parameters or props the record has, each with what the finding says about it.
    const params = record?.props ?? record?.parameters ?? [];
    const rows = params.map((p) => {
      const hit = named.has(p.name);
      const flag = p.required
        ? 'required'
        : p.default !== undefined
          ? `= ${p.default}`
          : 'optional';
      return `<span${hit && missing ? ' class="warn"' : ''}>${esc(p.name)}</span><span class="t">${esc(p.type)}</span><span class="f">${esc(flag)}${hit && missing ? ' · missing here' : ''}</span>`;
    });
    if (unknown)
      for (const n of named)
        if (n !== ref?.export && !params.some((p) => p.name === n))
          rows.push(
            `<span class="bad">${esc(n)}</span><span class="t">not ${record?.props ? 'a prop' : 'a parameter'}</span><span class="f">used here</span>`,
          );
    const table = rows.length
      ? `<p class="cap">${record?.props ? 'Props' : 'Parameters'}</p><div class="tbl">${rows.join('')}</div>`
      : '';
    // Members: the record's list when the build wrote one, else what the judge was told.
    const has =
      record?.members?.map((m) => memberLabel(m, record.name)) ??
      (claim.jev?.has ?? []).map((m) => ({ name: m, params: '' }));
    const bad = new Set(claim.jev?.names ?? []);
    const more = record?.otherMembers?.length
      ? `<code><span>… ${record.otherMembers.length} more</span></code>`
      : '';
    const memberRows = has.length
      ? `<p class="cap">Members</p><div class="members">${[...has.map((m) => `<code><b>${esc(m.name)}</b><span>${esc(m.params)}</span></code>`), ...[...bad].map((m) => `<code class="bad">${esc(m)}<span> · not a member</span></code>`)].join('')}${more}</div>`
      : '';
    const facts = [
      signature ? `<dt>spec</dt><dd>${esc(signature)}</dd>` : '',
      !record && claim.rule?.suggestion?.startsWith('Allowed: ')
        ? `<dt>allowed</dt><dd>${esc(claim.rule.suggestion.slice(9))}</dd>`
        : '',
      record?.returns && !record.props ? `<dt>returns</dt><dd>${esc(record.returns)}</dd>` : '',
      ref?.deprecated
        ? `<dt></dt><dd>@deprecated ${esc(plainDoc(ref.deprecationNote ?? ''))}${ref.replacement ? ` → ${esc(ref.replacement)}` : ''}</dd>`
        : '',
    ].join('');
    views.push({
      key: 'spec',
      brief: esc(clip(signature ?? ref?.export ?? '', 60)),
      html: `${record?.description ? `<p class="cap">${esc(clip(record.description, 200))}</p>` : ''}<dl class="facts mono">${facts}</dl>${table}${memberRows}`,
    });
  }
  const declared = ref ? page?.declared?.[ref.export] : undefined;
  if (declared && ref) {
    const own = ref.member ? page?.excerpts?.[`${ref.export}.${ref.member}`] : undefined;
    const excerpt = own ?? page?.excerpts?.[ref.export];
    const where = excerpt ? `${excerpt.file}:${excerpt.at}` : declared;
    const code = excerpt
      ? `<pre class="code">${excerpt.lines
          .map((l, i) => {
            const n = excerpt.from + i;
            return `<div${n === excerpt.at ? ' class="hit"' : ''}><span>${n}</span><span>${esc(l)}</span></div>`;
          })
          .join('')}</pre>`
      : '';
    const note = !excerpt
      ? `<p class="cap">Where the spec found <code>${esc(ref.export)}</code>. The build did not read the file.</p>`
      : ref.member && !own
        ? `<p class="cap"><code>${esc(ref.member)}</code> is not declared in this file: inherited, or built from a type. This is the export.</p>`
        : '';
    views.push({
      key: 'source',
      brief: esc(where),
      html: `<div class="meta"><span class="path">${esc(where)}</span><button type="button" class="mini" data-act="copy-text" data-text="${esc(where)}">Copy path</button></div>${code}${note}`,
    });
  }
  const jev = claim.jev;
  if (jev && !claim.rule) {
    const bars = DIMENSIONS.map(
      (d) =>
        `<div class="bar"><span>${d}</span><i><b style="width:${Math.round(jev[d] * 100)}%"></b></i><span>${jev[d].toFixed(2).replace(/^0/, '')}</span></div>`,
    ).join('');
    views.push({
      key: 'why',
      brief: `${topDimension(claim)} ${maxScore(claim).toFixed(2).replace(/^0/, '')}${jev.reason ? ` · ${esc(jev.reason)}` : ''}`,
      html: `<p class="cap">A model's read: probabilities, not verdicts.</p>${bars}${jev.reason ? `<dl class="facts mono"><dt>reason</dt><dd>${esc(jev.reason)}</dd></dl>` : ''}`,
    });
  }
  return views;
}

function popoverHTML({
  mark,
  at,
  page,
  slices,
  decision,
  resolving,
  view,
  same,
}: PopoverInput): string {
  const cards = cardsOf(mark);
  const claims = cards[at] ?? cards[0];
  const first = claims[0];
  const context = mark.anchor.range.startContainer.parentElement?.closest(BLOCK)?.textContent ?? '';
  const gaps = first.kind === 'gap';
  const word = mark.token ? mark.anchor.range.toString() : '';
  const types = [...new Set(claims.map((c) => c.specRef?.export).filter(Boolean))];
  // A gap is about the whole page: the name may well appear on it as something else.
  const pageText =
    (mark.anchor.range.startContainer.parentElement?.closest('article, main') ?? document.body)
      .textContent ?? '';
  const kindOfMember = (c: JudgedClaim): string | undefined =>
    c.specRef?.member ? page?.kinds?.[`${c.specRef.export}.${c.specRef.member}`] : undefined;
  const lead = gaps
    ? `<p class="say">${claims.length === 1 ? say(sentence(first, pageText, kindOfMember(first))) : `${claims.length} members of ${types.map((t) => `<code>${esc(String(t))}</code>`).join(', ')} are never documented in this section.`}</p>`
    : `<p class="say">${say(sentence(first, context), word)}</p>`;
  // A section's gaps: the names, under Details, one per line.
  const members =
    gaps && claims.length > 1
      ? `<div class="members">${claims
          .map((c) => {
            const { name, params } = memberLabel(
              signatureOf(truthSlice(c, slices)) ?? c.specRef?.member ?? c.text,
              types.length === 1 ? String(types[0]) : undefined,
            );
            const kind = kindOfMember(c);
            return `<code><b>${esc(name)}</b><span>${esc(params)}</span>${kind ? `<i>${esc(kind)}</i>` : ''}</code>`;
          })
          .join('')}</div>`
      : '';
  const signature = gaps && claims.length > 1 ? null : signatureOf(truthSlice(first, slices));
  const proof = gaps ? null : proofOf(first, signature);
  const ref = first.specRef;
  const views = viewsOf(mark, first, page, signature);
  const rows = views
    .map(
      (v) =>
        `<button type="button" class="rowbtn" data-act="view" data-view="${v.key}"><span class="k">${v.key}</span><span class="v">${v.brief}</span><span class="c">›</span></button>`,
    )
    .join('');
  // Where you are: among the findings at this place, else among the places that show this issue.
  const aside =
    cards.length > 1
      ? `<button type="button" class="where" data-act="sib" aria-label="Finding ${at + 1} of ${cards.length} here. Go to the next">${at + 1} of ${cards.length} ›</button>`
      : same.of > 1
        ? `<button type="button" class="where" data-act="same" aria-label="Same issue in ${same.of} places. Go to the next">${same.at} of ${same.of} ›</button>`
        : '';
  // The trimmed spec line gives way to the full one when unfolded.
  const trimmed = proof && signature && proof.label === 'spec' && !proof.whole && !ref?.deprecated;
  const resolved = decision !== undefined;
  // What the reader decided stays in view, and can be taken back.
  const said = resolved
    ? `<div class="said"><b>${decision === null ? 'Not a problem' : 'Resolved'}</b>${decision ? `<span>${esc(decision)}</span>` : ''}<button type="button" data-act="undo">Undo</button></div>`
    : resolving
      ? `<textarea class="note" rows="2" data-note aria-label="What should happen" placeholder="What should happen?"></textarea>`
      : '';
  const foot = resolved
    ? `<button type="button" class="pill go" data-act="next">Next</button>`
    : resolving
      ? `<button type="button" class="pill" data-act="resolve-cancel">Cancel</button><button type="button" class="pill go" data-act="resolve-done">Done</button>`
      : `<button type="button" class="pill" data-act="dismiss-mark">Not a problem</button><button type="button" class="pill go" data-act="resolve">Resolve</button>`;
  const main = `${lead}
    ${proof ? `<dl class="facts mono${trimmed ? ' trimmed' : ''}"><dt>${proof.label}</dt><dd>${proof.html}</dd></dl>` : ''}
    <div class="fold"><div>${members}<div class="rows">${rows}</div></div></div>
    ${said}`;
  const open = view ? views.find((v) => v.key === view) : undefined;
  const head = open
    ? `<div class="pop-h"><button type="button" class="back" data-act="back" aria-label="Back to the finding">‹ Back</button><span class="crumb">${esc(ref?.export ?? first.text)} <span>${open.key}</span></span></div>`
    : evidenceHTML(claims, aside);
  return `${head}
    <div class="views"><div class="track"><div class="panel-in">${main}</div><div class="panel-in">${open?.html ?? ''}</div></div></div>
    ${open ? '' : `<div class="pop-f"><button type="button" class="more" data-act="more" aria-expanded="false">Details${ICON.chevron}</button>${foot}</div>`}`;
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
  type Panel = 'filter' | 'pages' | 'resolved';
  let panel: Panel | null = null;
  let anchors: Anchor[] = [];
  let marks: Mark[] = [];
  let unplaced: JudgedClaim[] = [];
  let layouts: Layout[] = [];
  let pages: JudgedPage[] = [];
  let checked = true;
  /** The open card's note field is showing. */
  let resolving = false;
  /** Which finding at the open place the card is on, and the Details row pushed over it. */
  let at = 0;
  let view: View | null = null;

  // Stable ids for the nodes marks hang on, so a mark keeps its identity across syncs.
  const blockIds = new WeakMap<Node, number>();
  let nextBlockId = 0;
  const blockId = (block: Node): number => {
    if (!blockIds.has(block)) blockIds.set(block, nextBlockId++);
    return blockIds.get(block) ?? 0;
  };

  const isResolved = (c: JudgedClaim): boolean => c.id in store.resolved;
  /** Findings the reader has not resolved; the filter has not been applied. */
  const open = (from: JudgedPage[]): JudgedClaim[] =>
    from.flatMap((p) => p.claims).filter((c) => isFinding(c) && !isResolved(c));
  /** What still asks for a decision. */
  const shown = (from: JudgedPage[]): JudgedClaim[] =>
    open(from).filter((c) => !isHidden(c, store.hidden));
  /** What gets a buoy: resolved findings keep theirs, turned inside out. */
  const placed = (from: JudgedPage[]): JudgedClaim[] =>
    from.flatMap((p) => p.claims).filter((c) => isFinding(c) && !isHidden(c, store.hidden));
  const pageOf = (claim: JudgedClaim): JudgedPage | undefined =>
    pages.find((p) => p.claims.includes(claim));

  type NavMark = {
    link: HTMLAnchorElement;
    clip: Element | null;
    el: HTMLElement;
    /** The scrollport the dot is clipped to. Shared by every mark in that scroller. */
    port: HTMLElement;
  };
  let navMarks: NavMark[] = [];

  /**
   * A dot beside the host's own nav links where decisions wait, so you can see where trouble is
   * without visiting every page. Drawn in a fixed layer from the link's rect, clipped to the
   * link's own scrollport: sidebars are often fixed or scroll on their own.
   * Repositioned in the scroll event, not the next frame: a frame later the row has moved
   * and the dot sits on the one above it.
   */
  function syncNav(root: Element): void {
    navLayer.replaceChildren();
    navMarks = [];
    if (Array.isArray(data) || !review) return;
    const ports = new Map<Element | null, HTMLElement>();
    const portFor = (clip: Element | null): HTMLElement => {
      const hit = ports.get(clip);
      if (hit) return hit;
      const port = document.createElement('div');
      port.className = 'navclip';
      navLayer.append(port);
      ports.set(clip, port);
      return port;
    };
    const links = document.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], aside a[href], [role="navigation"] a[href]',
    );
    for (const link of links) {
      if (link.origin !== location.origin || link.hash || root.contains(link)) continue;
      const count = issueCount(shown(data.routes[routeOf(link.pathname)] ?? []));
      if (!count) continue;
      let clip = link.parentElement;
      while (clip && !/auto|scroll/.test(getComputedStyle(clip).overflowY))
        clip = clip.parentElement;
      const port = portFor(clip);
      const el = document.createElement('span');
      el.className = 'nd';
      // A dot says there is something here; the number says how much.
      el.innerHTML = `<i></i><b>${count}</b>`;
      port.append(el);
      navMarks.push({ link, clip, el, port });
    }
    placeNav();
  }

  function placeNav(): void {
    const seen = new Set<HTMLElement>();
    for (const { link, clip, el, port } of navMarks) {
      const range = document.createRange();
      range.selectNodeContents(link);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const text = rects.at(-1);
      const bounds = clip?.getBoundingClientRect();
      const box = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
      const y = text ? text.top + text.height / 2 : 0;
      el.hidden = !text || (box !== null && (y < box.top || y > box.bottom));
      if (el.hidden || !text) continue;
      if (!seen.has(port)) {
        seen.add(port);
        port.hidden = false;
        port.style.left = `${box ? box.left : 0}px`;
        port.style.top = `${box ? box.top : 0}px`;
        port.style.width = box ? `${box.width}px` : '100vw';
        port.style.height = box ? `${box.height}px` : '100vh';
        port.style.overflow = box ? '' : 'visible';
      }
      const originX = box ? box.left : 0;
      const originY = box ? box.top : 0;
      el.style.left = `${text.right + 7 - originX}px`;
      el.style.top = `${y - originY}px`;
    }
  }

  /** Re-anchor and rebuild marks. Buoys animate in only when `enter` is set. */
  function sync(enter = false): void {
    const root = currentRoot();
    const current = currentPages();
    checked = current !== null;
    pages = current ?? [];
    const result = anchorClaims(root, placed(pages));
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
      const n = mark.claims.filter((c) => !isResolved(c)).length;
      // A buoy is a buoy, and says how many decisions it still asks for. None left: a check.
      const done = n === 0;
      const text = done ? ICON.tick : gap ? `+${n}` : String(n);
      const wide = done ? 0 : Math.max(0, text.length - 2) * 7;
      const label = done
        ? 'Resolved'
        : gap
          ? `${n} never documented in this section`
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
      return `${ring}${hl}${rule}<button type="button" class="pin${done ? ' done' : ''}" data-claim="${id}" style="--i:${i};left:${at.pin.x - wide}px;top:${at.pin.y}px${enter ? '' : ';animation:none'}" aria-label="${label}" aria-expanded="false">${text}</button>`;
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
    const count = issueCount(
      [...anchors.map((a) => a.claim), ...unplaced].filter((c) => !isResolved(c)),
    );
    const filtered = store.hidden.size > 0;
    const resolvedCount = resolvedIssues().length;
    const state = count
      ? `<button type="button" class="cb next" data-act="next" data-tip="Next finding" data-key="N" aria-label="${count} to review. Next finding">${count}${ICON.down}</button>`
      : `<span class="cb next quiet">${checked ? (filtered ? 'None shown' : 'Clean') : 'Not checked'}</span>`;
    const hasPages = !Array.isArray(data) || unplaced.length > 0;
    barIn.innerHTML = `${state}
      ${button('filter', ICON.filter, 'Filter', 'F', `aria-expanded="${panel === 'filter'}"${filtered ? ' data-held' : ''}`)}
      ${hasPages ? button('pages', ICON.pages, 'Pages', 'P', `aria-expanded="${panel === 'pages'}"`) : ''}
      ${button('copy', ICON.copy, 'Copy for agent', 'C', count ? '' : 'disabled')}
      ${button('resolved', `${ICON.undo}${resolvedCount ? `<span class="ct">${resolvedCount}</span>` : ''}`, 'Resolved', 'Z', resolvedCount ? `aria-expanded="${panel === 'resolved'}"` : 'disabled')}
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

  type Resolved = { route: string; claims: JudgedClaim[] };

  /** What the reader decided, one row per decision, this page first. Nothing resolved is ever out of reach. */
  function resolvedIssues(): Resolved[] {
    const here = routeOf(location.pathname);
    const routes = Array.isArray(data) ? { [here]: data } : data.routes;
    const order = Object.keys(routes).sort(
      (a, b) => Number(b === here) - Number(a === here) || a.localeCompare(b),
    );
    return order.flatMap((route) => {
      const byIssue = new Map<string, JudgedClaim[]>();
      for (const claim of routes[route].flatMap((p) => p.claims)) {
        if (!isFinding(claim) || !isResolved(claim)) continue;
        byIssue.set(issueKey(claim), [...(byIssue.get(issueKey(claim)) ?? []), claim]);
      }
      return [...byIssue.values()].map((claims) => ({ route, claims }));
    });
  }

  function resolvedHTML(): string {
    const issues = resolvedIssues();
    const here = routeOf(location.pathname);
    let last = '';
    const rows = issues.map(({ route, claims }, i) => {
      const head =
        route === last ? '' : `<p class="grp">${route === here ? 'This page' : esc(route)}</p>`;
      last = route;
      const decision = store.resolved[claims[0].id];
      const what = decision === null ? 'Not a problem' : decision || 'Real';
      const places = claims.length > 1 ? ` · ${claims.length} places` : '';
      return `${head}<div class="opt gone"><span><span class="say">${say(sentence(claims[0]))}</span><small>${esc(what)}${places}</small></span><button type="button" data-act="restore-one" data-i="${i}">Undo</button></div>`;
    });
    return `<header><b>Resolved</b><span>What you decided. Kept in this browser.</span></header>
      ${rows.join('')}
      <footer><span>${issues.length} resolved</span><button type="button" data-act="restore">Undo all</button></footer>`;
  }

  function restore(claims: JudgedClaim[] | null, enter = true): void {
    if (claims) for (const c of claims) delete store.resolved[c.id];
    else store.resolved = {};
    store.save();
    sync(enter);
    if (!Object.keys(store.resolved).length) panel = null;
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
      { filter: 'Filter', pages: 'Pages', resolved: 'Resolved' }[panel],
    );
    el.tabIndex = -1;
    el.innerHTML = { filter: filterHTML, pages: pagesHTML, resolved: resolvedHTML }[panel]();
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

  /** The finding the open card is on. */
  const current = (mark: Mark): JudgedClaim[] => cardsOf(mark)[at] ?? cardsOf(mark)[0];

  function markHTML(mark: Mark): string {
    const same = sameAs(mark);
    const claims = current(mark);
    return popoverHTML({
      mark,
      at,
      page: pageOf(claims[0]),
      slices: pages.flatMap((p) => p.slices),
      decision: claims.every(isResolved) ? store.resolved[claims[0].id] : undefined,
      resolving,
      view,
      same: { at: same.indexOf(mark) + 1, of: same.length },
    });
  }

  function select(id: string | null, via: { keyboard?: boolean; scroll?: boolean } = {}): void {
    selected = selected === id ? null : id;
    hoverOpened = false;
    resolving = false;
    view = null;
    // Land on the first finding here that still asks for a decision.
    const opened = marks.find((m) => m.id === selected);
    at = opened
      ? Math.max(
          0,
          cardsOf(opened).findIndex((c) => !c.every(isResolved)),
        )
      : 0;
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
    const left = marks.filter((m) => m.claims.some((c) => !isResolved(c)));
    if (!left.length) return;
    const score = (m: Mark): number =>
      m.claims.some((c) => c.rule) ? 2 : Math.max(...m.claims.map((c) => maxScore(c)));
    const order = [...left].sort(
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
      await navigator.clipboard.writeText(toPrompt(from, new Set(claims), store.resolved, route));
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

  /** The page's findings, resolved or not: the prompt sorts them itself. */
  const copyPage = (el: HTMLElement | null): Promise<void> =>
    copy(el, pages, [...anchors.map((a) => a.claim), ...unplaced], location.pathname);

  function copyAll(el: HTMLElement): Promise<void> {
    const all = Array.isArray(data) ? data : Object.values(data.routes).flat();
    const routes = Array.isArray(data)
      ? 1
      : Object.values(data.routes).filter((r) => placed(r).length).length;
    return copy(el, all, placed(all), `${routes} page${routes === 1 ? '' : 's'}`);
  }

  /** One decision covers every place on the page that shows the same issue. The buoy stays, turned inside out. */
  function resolve(claims: JudgedClaim[], decision: Decision): void {
    const keys = new Set(claims.map(issueKey));
    for (const c of open(pages)) if (keys.has(issueKey(c))) store.resolved[c.id] = decision;
    store.save();
    resolving = false;
    sync();
    redraw();
    // The note field is gone; keep the keyboard in the card so N moves on.
    layer.querySelector<HTMLElement>('.pop:not(.exit)')?.focus({ preventScroll: true });
  }

  /**
   * Redraw the open card without moving it. A change of panel slides: the old height and
   * position are held for a frame so the transition has somewhere to start from.
   */
  function redraw(focusNote = false): void {
    const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
    const mark = marks.find((m) => m.id === selected);
    if (!pop || !mark) return;
    const was = pop.querySelector<HTMLElement>('.views');
    const from = was ? { h: was.offsetHeight, x: was.dataset.x ?? '0' } : null;
    pop.innerHTML = markHTML(mark);
    const views = pop.querySelector<HTMLElement>('.views');
    const track = pop.querySelector<HTMLElement>('.track');
    const panel = track?.children[view ? 1 : 0] as HTMLElement | undefined;
    if (views && track && panel) {
      const x = view ? '-100%' : '0';
      const to = panel.offsetHeight;
      track.style.transition = 'none';
      track.style.transform = `translateX(${from?.x ?? x})`;
      views.style.height = `${from?.h ?? to}px`;
      void views.offsetHeight;
      track.style.transition = '';
      track.style.transform = `translateX(${x})`;
      views.style.height = `${to}px`;
      views.dataset.x = x;
      // Once there, let the panel size itself again: Details unfolds inside it.
      setTimeout(() => {
        if (views.isConnected) views.style.height = '';
      }, 360);
    }
    placePopover();
    if (focusNote) pop.querySelector<HTMLTextAreaElement>('.note')?.focus({ preventScroll: true });
  }

  /** The next finding here that asks for a decision, else the next buoy. */
  function onward(mark: Mark): void {
    const cards = cardsOf(mark);
    const to = cards.findIndex((c, i) => i > at && !c.every(isResolved));
    if (to < 0) {
      next();
      return;
    }
    at = to;
    view = null;
    redraw();
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
        if (mark && el.closest('.pop')) onward(mark);
        else next((event as MouseEvent).shiftKey ? -1 : 1);
        break;
      case 'filter':
      case 'pages':
      case 'resolved':
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
      case 'restore':
        restore(null);
        break;
      case 'restore-one':
        restore(resolvedIssues()[Number(el.dataset.i)]?.claims ?? []);
        break;
      case 'undo':
        if (mark) restore(current(mark), false);
        redraw();
        break;
      case 'resolve':
        resolving = true;
        redraw(true);
        break;
      case 'resolve-cancel':
        resolving = false;
        redraw();
        break;
      case 'resolve-done': {
        const note = layer.querySelector<HTMLTextAreaElement>('.pop:not(.exit) .note')?.value ?? '';
        if (mark) resolve(current(mark), note.trim());
        break;
      }
      case 'more': {
        const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
        pop?.querySelector<HTMLElement>('.views')?.style.removeProperty('height');
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
        if (mark) resolve(current(mark), null);
        break;
      case 'sib':
        if (mark) {
          at = (at + 1) % cardsOf(mark).length;
          resolving = false;
          redraw();
        }
        break;
      case 'view':
        view = (el.dataset.view as View) ?? null;
        redraw();
        break;
      case 'back':
        view = null;
        redraw();
        break;
      case 'copy-text':
        void navigator.clipboard.writeText(el.dataset.text ?? '').then(() => {
          el.textContent = 'Copied';
        });
        break;
    }
  }

  /** Enter in the note resolves; the field is one line of intent, not an essay. */
  function onNoteKey(e: Event): void {
    const event = e as KeyboardEvent;
    const field = event.composedPath()[0] as HTMLElement | undefined;
    if (!field?.matches?.('.note')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      resolving = false;
      redraw();
      const pop = layer.querySelector<HTMLElement>('.pop:not(.exit)');
      pop?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const mark = marks.find((m) => m.id === selected);
      if (mark) resolve(current(mark), (field as HTMLTextAreaElement).value.trim());
    }
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
      if (Object.keys(store.resolved).length) setPanel('resolved');
    },
    r: () => {
      const mark = marks.find((m) => m.id === selected);
      if (!mark || view || current(mark).every(isResolved)) return;
      resolving = true;
      redraw(true);
    },
    arrowright: () => step(1),
    arrowleft: () => step(-1),
  };

  /** Walk the findings at the open place. */
  function step(by: number): void {
    const mark = marks.find((m) => m.id === selected);
    if (!mark || view) return;
    const n = cardsOf(mark).length;
    if (n < 2) return;
    at = (at + by + n) % n;
    resolving = false;
    redraw();
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (panel) {
        setPanel(null);
        return;
      }
      if (!selected) return;
      if (view) {
        view = null;
        redraw();
        return;
      }
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
  // In the event, not the next frame, so the dot moves in the same paint as its row.
  const onScroll = (): void => {
    placeNav();
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // Hosts that follow the OS scheme repaint with no DOM change to observe.
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', schedule);

  shadow.addEventListener('click', onClick);
  shadow.addEventListener('keydown', onNoteKey);
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
