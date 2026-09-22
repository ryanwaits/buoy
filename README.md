# Buoy

Drift finds it. Buoy marks it.

Buoy is a dev overlay for docs sites. It checks what your docs say against what your package exports, and pins each disagreement on the rendered page, on the line that makes the claim. It scores and points. It never rewrites your docs.

```
docs page ─┐
           ├─ Drift (rules) ─┐
TypeScript ─ OpenPkg (spec) ─┤            ┌─ a buoy on the word that is wrong
                             ├─ Buoy ─────┼─ its popup: proved by code, or likely with the odds
             Jev (judgment) ─┘            └─ +N: members this section never documents
```

## What it finds

Things a reader would copy and get wrong. From one real docs site:

- `<LivelyProvider serverUrl="...">` in the Quick Start. The prop is `client`. *(rule: unknown prop)*
- `<RoomProvider roomId="my-room">` with no `userId` or `displayName`, both required. *(rule: missing required)*
- `useMutation(callback)` without its required `deps`, on three pages. *(rule)*
- A table that says `useCursors` returns `CursorData[]`. It returns a `Map`. *(Jev: inaccurate, 0.94)*
- "`LiveObject.delete(key)`". There is no such method. *(Jev: inaccurate, 0.95)*
- A section for `StorageDocument` that never documents four of its public methods. *(gap)*

## Install

```sh
bun add -d @driftdev/buoy
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
import { Buoy } from '@driftdev/buoy/react';

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
import { mount } from '@driftdev/buoy';
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

### Telling Buoy what a page documents

Optional. A page is on the hook for a type when a heading names it. For the rest, put a `drift.docs.json` next to `buoy.config.json`:

```json
{
  "pages": [
    { "page": "/docs/client", "type": "ActivityTracker", "internal": ["_status", "_pollTimer"] }
  ]
}
```

`page` is the route (or the markdown path), `type` the export it documents, `internal` members that are public in the types but not meant for docs, so they are never reported as "never documented". `deprecated` and `replacements` (`{ "old": "new" }`) do the same for members the source does not annotate. It is Drift's docs map; Buoy passes it through.

## Reading the overlay

- **A buoy is a buoy.** One solid circle per place, in your page's own heading colour. It sits on the word that is wrong when the page shows it (`serverUrl`, `delete(key)`), else on the passage. Its number is how many findings share that place; `+N` means members of a type that its section never documents: a getter, method or property the spec has and the page does not teach. The card says which kind, and when the same name appears on the page as an option key (`port: 1999` for a `port` getter) it says so. A dashed line marks where those members would go. The whole block is the target, not just the buoy: point at a flagged code block or passage and it is ringed, click anywhere in it for the popup. Rest on the washed word itself and the popup opens on its own, and closes when you move away.
- **The popup says which kind.** *Proved · code checked it*: an exact rule fired on a code sample or table: an import that does not exist, a prop or option the type does not define, too many arguments, a missing required argument or prop, a literal of the wrong primitive type, a parameter table that names a parameter the function does not have, a deprecated API taught without saying so. *Likely · a model's read · 78%*: a probability that the passage is stale, incomplete or inaccurate against the spec, from atomic yes/no questions asked of [TypeSafe](https://docs.typesafe.ai/)'s Jev model, shown only when the score clears a cut set by calibration. Set `TYPESAFE_API_KEY` and install `@typesafe-ai/sdk` to turn it on; without them the build is rules only. A page of docs costs a fraction of a cent, and answers are cached in `.buoy/jev.json`.
- **Then why, and where to check.** One sentence naming the thing (`delete` is not a method of LiveObject) and the one fact that settles it: the members the type does have, the parameters the rule names (`userId: string, displayName: string · 9 more`), the spec's own `@deprecated` note. **Details** unfolds the rest: `docs` (what the page says), `spec` (the full signature), `source` (`file:line` of the declaration), `check` (the one command that settles it), and a note for the writer. Sentences are templates filled by code, never model text. The same issue in several places is one decision: "2 of 5" walks them, and *Not a problem* dismisses them together.
- A rule hit is certain and Jev is never asked about it. Jev reads only what a rule cannot: whether a passage is stale, what its prose says, the types it writes out, the members it names, and whether the code breaks a stated requirement.
- **Toolbar.** `N` next finding (proved first, then by odds), `F` filter by evidence or kind, `P` pages with their counts, `C` copy a brief for a coding agent (what is wrong, where, how to verify; Buoy does not write the fix), `Z` what you dismissed, with a restore for each and for all, `Esc` close. Notes, dismissals and the filter stay in your browser.
- Light or dark follows the page. To pin the colours: `--buoy-ink`, `--buoy-paper`, `--buoy-mark` on `:root`.
- The overlay never touches your DOM. Pins are drawn in a Shadow DOM layer from text ranges, so framework re-renders are safe.

## How accurate

Measured, not claimed. Real docs passages that raise no rule are judged against their true spec record (should be silent) and against a record broken in a known way (should fire): about 2,200 clean passages and 2,800 broken ones per run, from the docs of nine open-source TypeScript projects.

| | Caught (95% interval) | Clean passages flagged |
|---|---|---|
| stale | 84% (82–85) | 0 of 2,242 |
| inaccurate | 83% (71–91) of what Jev is asked: what the prose says, the types it writes out, the members it names. Arity, option keys, literal types, parameter tables and imports are exact rules, not Jev's | every one read by hand |
| incomplete | 91% (88–93) | 〃 · asked only where no rule can answer: prose uses, never a code sample with a checkable signature |

Precision comes first: cuts are the lowest that kept clean passages under the line, except where a flagged "clean" passage turned out to be a real disagreement between a project's docs and its own source. Those are most of what is left over the line. What Jev cannot see (a renamed row in a parameter table, arity, an undefined option key) is decided by rules instead, which are exact.

Every rule hit on those projects' docs is read by hand after each upstream release. A false hit is a bug in Drift or OpenPkg and gets fixed there, not filtered here.

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

Built on [Drift](https://github.com/ryanwaits/drift) (`buildPageDocument`) and [OpenPkg](https://github.com/ryanwaits/openpkg-ts). Project rules for contributors and agents are in `AGENTS.md`.
