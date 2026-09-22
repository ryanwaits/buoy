/**
 * Rendered-page mode: a docs page's HTML → the markdown subset the build reads.
 *
 * Every docs source (markdown, MDX, TSX, a CMS) ends up as a rendered page, so
 * this is the one input that needs no per-format parser. It wants semantic
 * HTML: headings, <p>, <pre>, <code>, lists, tables. Build-time only.
 */

import { type HTMLElement, type Node, parse } from 'node-html-parser';
import { CODE_CLASS, CODE_TAGS, looksLikeCode } from './fence';
import { findRoot } from './roots';

/** Host chrome inside content: anchors, copy buttons, icons. */
const SKIP = new Set(['BUTTON', 'SVG', 'SCRIPT', 'STYLE', 'NAV', 'ASIDE', 'FOOTER', 'NOSCRIPT']);

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1;

function skipped(el: HTMLElement): boolean {
  return (
    SKIP.has(el.tagName) ||
    el.getAttribute('aria-hidden') === 'true' ||
    el.classList.contains('hash-link') ||
    el.classList.contains('sr-only')
  );
}

/** Code text with line breaks restored: hosts use <br>, per-line blocks, or real newlines. */
function codeText(node: Node): string {
  if (!isElement(node)) return node.text;
  if (node.tagName === 'BR') return '\n';
  if (skipped(node)) return '';
  const inner = node.childNodes.map(codeText).join('');
  const line = node.tagName === 'DIV' && !inner.endsWith('\n');
  return line ? `${inner}\n` : inner;
}

function inline(node: Node): string {
  if (!isElement(node)) return node.text.replace(/\s+/g, ' ');
  if (skipped(node)) return '';
  if (node.tagName === 'BR') return ' ';
  if (node.tagName === 'CODE') return `\`${node.text.trim()}\``;
  return node.childNodes.map(inline).join('');
}

function language(pre: HTMLElement): string {
  for (const el of [pre, pre.querySelector('code')]) {
    if (!el) continue;
    const attr = el.getAttribute('data-language') ?? el.getAttribute('language');
    if (attr) return attr.toLowerCase();
    const cls = el.getAttribute('class')?.match(/(?:^|\s)lang(?:uage)?-([\w-]+)/);
    if (cls) return cls[1].toLowerCase();
  }
  return '';
}

/** Hand-rolled sites render code with no language; only fences that are plainly code are read. */
const sniff = (code: string): string => (looksLikeCode(code) ? 'ts' : '');

const saysCode = (el: HTMLElement): boolean =>
  CODE_TAGS.test(el.tagName) && CODE_CLASS.test(el.getAttribute('class') ?? '');

/**
 * The text of a code block built from `<div>`s, innermost first: a wrapper that
 * holds a filename bar and the block is not the block. `null` for anything else.
 */
function divFence(el: HTMLElement): string | null {
  if (!saysCode(el) || el.querySelector('pre')) return null;
  if (el.querySelectorAll('[class]').some(saysCode)) return null;
  const code = codeText(el).trimEnd();
  return looksLikeCode(code) ? code : null;
}

/** A code block's title, as hosts show it: a filename bar, a caption, a `data-title`. */
const TITLE =
  'figcaption, [data-slot="card-title"], [data-title], [class*="title"], [class*="filename"]';

/**
 * `title="AI SDK 5"` on a fence is how docs mark before/after code, and the build reads it from
 * the fence's info string. Hosts render it as a bar above the `<pre>`, inside a wrapper.
 */
function titleOf(pre: HTMLElement): string {
  const own = pre.getAttribute('data-title') ?? pre.getAttribute('title');
  if (own) return own.trim();
  let scope: HTMLElement | null = pre.parentNode as HTMLElement | null;
  for (let up = 0; scope && up < 3; up++, scope = scope.parentNode as HTMLElement | null) {
    if (!scope.querySelectorAll) break;
    const inside = (el: HTMLElement): boolean => {
      for (
        let at = el.parentNode as HTMLElement | null;
        at;
        at = at.parentNode as HTMLElement | null
      )
        if (at === pre) return true;
      return false;
    };
    const found = scope
      .querySelectorAll(TITLE)
      .find((el) => !el.querySelector('pre') && !inside(el));
    const text = found?.getAttribute('data-title') ?? found?.text.replace(/\s+/g, ' ').trim();
    if (text && text.length <= 80) return text;
  }
  return '';
}

function table(el: HTMLElement): string {
  const rows = el
    .querySelectorAll('tr')
    .map((tr) =>
      tr.querySelectorAll('th, td').map((cell) => inline(cell).trim().replace(/\|/g, '\\|')),
    );
  if (!rows.length) return '';
  const [head, ...body] = rows;
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
}

function blocks(el: HTMLElement, out: string[]): void {
  for (const child of el.childNodes) {
    if (!isElement(child)) {
      const text = child.text.trim();
      if (text) out.push(text);
      continue;
    }
    if (skipped(child)) continue;
    const tag = child.tagName;
    if (/^H[1-6]$/.test(tag)) out.push(`${'#'.repeat(Number(tag[1]))} ${inline(child).trim()}`);
    else if (tag === 'PRE') {
      const code = codeText(child).trimEnd();
      const title = titleOf(child);
      const info = `${language(child) || sniff(code)}${title ? ` title="${title.replace(/"/g, "'")}"` : ''}`;
      out.push(`\`\`\`${info}\n${code}\n\`\`\``);
    } else if (divFence(child) !== null) out.push(`\`\`\`ts\n${divFence(child)}\n\`\`\``);
    else if (tag === 'P') out.push(inline(child).trim());
    else if (tag === 'LI') out.push(`- ${inline(child).trim()}`);
    else if (tag === 'TABLE') out.push(table(child));
    else blocks(child, out);
  }
}

/** Markdown for the page's article, or `null` when no content root is found. */
export function renderedToMarkdown(html: string, rootSelector?: string): string | null {
  const doc = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  const root = findRoot(doc, rootSelector);
  if (!root) return null;
  const out: string[] = [];
  blocks(root, out);
  return `${out.filter(Boolean).join('\n\n')}\n`;
}
