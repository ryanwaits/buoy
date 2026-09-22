# Buoy

OpenPkg is the record. Buoy marks the page.

Buoy is a dev overlay for docs sites. It checks what a section says against the exports that section names, and pins each disagreement on the rendered page. It never rewrites your docs.

```
a heading section → the words in it
TypeScript → OpenPkg, once → the thin record for the names that appear
  → Jev: is this word an API claim, or a value / comment / example data?
  → code: a proof only when that answer is extreme and the record lacks the name
  → a buoy on the word, same card as before
```

## What it finds

Things a reader would copy and get wrong. From one real docs site:

- `<LivelyProvider serverUrl="...">` in the Quick Start. The prop is `client`. *(rule: unknown prop)*
- `<RoomProvider roomId="my-room">` with no `userId` or `displayName`, both required. *(rule: missing required)*
- `useMutation(callback)` without its required `deps`, on three pages. *(rule)*
- A table that says `useCursors` returns `CursorData[]`. It returns a `Map`. *(Jev: inaccurate, 0.94)*
- "`LiveObject.delete(key)`". There is no such method. *(Jev: inaccurate, 0.95)*
- `PresenceUser — { …, joinedAt }`. The field is `connectedAt`. *(proof: not a member)*

## Install

```sh
bun add -d @waits/buoy
```

Dev only. React 18+ if you use the React wrapper; the core is plain TypeScript with no runtime dependencies.

## Set up

1. Tell Buoy where the package and the docs are. `buoy.config.json`, next to your `package.json`:

```json
{
  "entry": "src/index.ts",
  "out": "public/buoy.json",
  "routes": { "/docs/hooks": ["docs/hooks/*.md"] }
}
```

2. Build the findings:

```sh
bunx buoy build
```

3. Mount the overlay in your docs layout.

```tsx
import { Buoy } from '@waits/buoy/react';

export default function DocsLayout({ children }) {
  return (
    <>
      {children}
      {process.env.NODE_ENV === 'development' && <Buoy src="/buoy.json" />}
    </>
  );
}
```

Without React:

```js
import { mount } from '@waits/buoy';
mount({ data: await (await fetch('/buoy.json')).json() });
```

### Two ways to read your docs

| Mode | Config | Use it when |
|---|---|---|
| Markdown | `routes`: URL path → markdown globs | your docs are `.md` / `.mdx` files |
| Rendered page | `site` + `pages` (+ `root`) | your docs are components, or you want to check exactly what readers see |

```json
{
  "entry": { "/docs/client": "packages/client/src/index.ts", "*": "packages/react/src/index.ts" },
  "out": "apps/web/public/buoy.json",
  "site": "http://localhost:3000",
  "pages": ["/docs/quick-start", "/docs/client"]
}
```

`entry` can be one path, or a map from route to entry for a multi-package repo (exact route, then longest prefix, then `"*"`). An entry can also be an object, for packages with more than one entry point:

```json
{
  "entry": {
    "path": "packages/core/src/index.ts",
    "also": [{ "path": "packages/core/src/mini/index.ts", "importSpecifier": "acme/mini" }]
  }
}
```

`importSpecifier` says what the entry is imported as when it is a subpath (`acme/utils`), so imports from the package root are not flagged. `also` lists other entries the same pages document: a name any of them exports is not a broken reference, and a code sample that imports one of them is checked against that one.

Rendered mode fetches the page, reads the article as markdown, and wants semantic HTML: real headings, `<pre>` for code. A highlighter that builds its blocks from `<div>`s is read too, when the block's class says code (`font-mono`, `code-block`, `hljs`, `shiki`, `prism`, `highlight`) and its text is plainly JS or TS; the overlay lands findings in the same block. Both modes can cover the same route: list it under `routes` and `pages`.

## Reading the overlay

- **A buoy is a buoy.** One solid circle per place, in your page's own heading colour. It sits on the word that is wrong when the page shows it (`serverUrl`, `joinedAt`), else on the passage. Its number is how many findings share that place. The whole block is the target, not just the buoy: point at a flagged code block or passage and it is ringed, click anywhere in it for the popup. Rest on the washed word itself and the popup opens on its own, and closes when you move away.
- **The popup says which kind.** *Proved · code checked it*: an import that is not exported, an option or member the record does not have, a required argument or a required one-of that a call skips, a deprecated export taught as current. *Likely · a model's read*: one question to [TypeSafe](https://docs.typesafe.ai/)'s Jev, whether the prose contradicts the description, shown from confidence 0.8. Set `TYPESAFE_API_KEY` and install `@typesafe-ai/sdk` to turn that question on; without them the build is the proofs only. Answers are cached in `.buoy/jev.json`.
- **Then why, and where to check.** One sentence naming the thing (`delete` is not a method of LiveObject) and the one fact that settles it: the members the type does have, the parameters the rule names (`userId: string, displayName: string · 9 more`), the spec's own `@deprecated` note. **Details** unfolds the rest: `docs` (what the page says), `spec` (the full signature), `source` (`file:line` of the declaration), `check` (the one command that settles it), and a note for the writer. Sentences are templates filled by code, never model text. The same issue in several places is one decision: "2 of 5" walks them, and *Not a problem* dismisses them together.
- A proof is code, and Jev is not asked about it. Jev reads one thing: whether the section's prose contradicts the description. An optional field the section never mentions is not a finding. A fence title or heading that marks the sample as an older version (`AI SDK 4.0`, `Before`) drops that section.
- **Toolbar.** `N` next finding (proved first, then by odds), `F` filter by evidence or kind, `P` pages with their counts, `C` copy a brief for a coding agent (what is wrong, where, how to verify; Buoy does not write the fix), `Z` what you dismissed, with a restore for each and for all, `Esc` close. Notes, dismissals and the filter stay in your browser.
- Light or dark follows the page. To pin the colours: `--buoy-ink`, `--buoy-paper`, `--buoy-mark` on `:root`.
- The overlay never touches your DOM. Pins are drawn in a Shadow DOM layer from text ranges, so framework re-renders are safe.

## How accurate

A name, an import, a required argument, and a deprecation are checked in code against the thin OpenPkg record. A wrong key or a missing required argument does not depend on a model. Jev is asked only whether the prose contradicts the description, and a behaviour buoy shows when that answer is `contradicts` at confidence 0.8 or above.

A false proof is a bug in the section scan or in OpenPkg, and it is not filtered in the overlay.

## What it will not do

- Rewrite, suggest, or generate docs.
- Hide a rule hit.
- Run in production, or send your docs anywhere except the Jev API when you give it a key.
- Guess. An unresolved type is left out of the record rather than asserted; an ambiguous name is no claim.

## Platforms

Anchoring is tested against the DOM shapes of Fumadocs, Docusaurus, Mintlify and Blume pages, and rendered-page mode has been run against production Fumadocs and Nextra sites. Anything that renders semantic HTML should work; set `root` if your article container is unusual.

## Develop

```sh
bun install
bun test
bun run build
```

Built on [OpenPkg](https://github.com/ryanwaits/openpkg-ts). Project rules for contributors and agents are in `AGENTS.md`.
