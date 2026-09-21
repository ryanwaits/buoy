/**
 * What counts as a code block. `<pre>` always does. Hand-rolled highlighters build
 * theirs from `<div>`s, so an element also counts when its class says code and its
 * text is plainly JS/TS. Shared by the build, which reads the block, and the overlay,
 * which must land a fence's findings in the same block. No DOM or parser imports here.
 */

/** Class names hosts give code that is not in a `<pre>`: utility monospace, highlighters, their own components. */
export const CODE_CLASS: RegExp =
  /(^|[\s_-])(mono|code|codeblock|hljs|shiki|prism|highlight)([\s_-]|$)/i;

/** Tags a hand-rolled block is made of. Inline `<code>` and `<span>` never are. */
export const CODE_TAGS: RegExp = /^(DIV|SECTION|FIGURE)$/;

/**
 * Plainly JS/TS: Drift only reads fences it knows are code, and a `<div>` is only
 * a code block when its text says so.
 */
export function looksLikeCode(code: string): boolean {
  const keyword = /(^|\n)\s*(import|export|const|let|function|await|return|interface|type)\b|=>/;
  // Call-only snippets: `client.leaveRoom("my-room");`
  const call = /(^|\n)\s*[\w$.]+\.[\w$]+\([^\n]*\);/;
  // JSX: `<RoomProvider roomId="x">`
  const jsx = /(^|\n)\s*<[A-Z][\w.]*[\s>/]/;
  return keyword.test(code) || call.test(code) || jsx.test(code);
}
