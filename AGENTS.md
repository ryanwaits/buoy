In all interactions, plans, and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

Always use bun.

## What this is

Buoy (`@waits/buoy`): docs-review overlay. OpenPkg is the record. A section's words are listed; Jev says whether each is an API claim; code writes a proof only when that answer is extreme and the record lacks the name. The overlay paints the buoys. Drift is not a dependency.

## Hard rules

- Never rewrite docs. Score, point at the spec, copy findings as markdown. No generated fixes.
- Never mutate the host DOM. Overlay layer only (Shadow DOM, rects from Ranges). React hosts re-render.
- A buoy is a buoy: one identical solid circle in the host's heading ink. Proved (rule) vs likely (Jev) is told in the popover's top line only, and by the Evidence filter. Chrome is neutral; the one colour is the yellow wash behind the wrong word. Visual language follows agentation.com.
- Popover sentences are code templates (`output.sentence`), never model text.
- The manifest claim is Buoy's. A rule hit is a proof. `claim.jev` is only the behaviour reading (a probability the prose contradicts the description). Page-level `source`, `declared`, `excerpts`, and `records` are written by the build. The card sentence is a code template.
- Unplaced claims are surfaced, never dropped.
- Core is vanilla TS, zero runtime deps: Mintlify takes plain `.js` only, Blume is Astro. React is a thin wrapper.
- Dev-only for now. No prod/preview gating.
- Default is no: new parts must pass the should-add gate. UI is buoys + popover + toolbar with two panels (Filter: evidence + kind; Pages). No settings.
- Never `npm publish` without an explicit go.

## Layout

- `src/anchor` claim → DOM `Range`. Tested against hand-written fixtures in `test/fixtures` that mirror the DOM shapes of Fumadocs, Docusaurus, Mintlify and Blume pages; the content is invented.
- `src/overlay` shadow-root UI (buoys, popover, toolbar, panels). `marks.ts`: one mark per place: findings on the same span share a buoy, a section's gaps share one `+N`. `anchor/token.ts` moves a mark onto the word that is wrong (in its block; for a heading claim, in its section's code). `policy.ts`: `kindOf`, `issueKey` (same issue in N places = one decision, one count), `isHidden`. `mount({ data })`; data = pages or a manifest resolved by `location.pathname`.
- `src/rendered.ts` rendered-page mode: fetched HTML → markdown subset → the same section reader as markdown mode (`routes`). Config `site` + `pages` (+ `root`). Wants semantic HTML (`<pre>`, headings); `src/fence.ts` is the one definition of a code block (`<pre>`, or a `<div>` whose class says code and whose text is plainly JS/TS), shared by the build and the overlay (`anchor/token.ts` `fenceOf`): change both together, never one. Build-time only, never imported by the overlay.
- `src/config.ts` `buoy.config.json` shape. `entry` is one path or a route → entry map (exact, longest prefix, `"*"`) for multi-package repos.
- `src/sonar` provider-neutral decision-model client; Jev (TypeSafe) is the first adapter. Imports nothing from Buoy; meant to become its own package.
- `src/read.ts` the build. A heading section. Code lists the words. OpenPkg is extracted once; the section gets the thin record. Jev answers, for each word not already in the record, whether the section claims it is an option, parameter, or member. Code writes a proof only when that answer is extreme. A required argument is a proof only when a real call skipped it. An older-version heading or fence title drops the section. Cached in `.buoy/jev.json`.
- `src/lookout/evidence.ts` projects an OpenPkg export into the record the card shows. `thresholds.ts` is the cut for a behaviour score. Jev does not veto a proof.
- The seam: a rule hit is the ledger (code checked it, "Proved"). A behaviour score is a sample ("Likely") and never writes on the ledger.
- `src/react.ts` `<Buoy />` thin wrapper (`@waits/buoy/react`). `src/cli.ts` `buoy build`: `buoy.config.json` (entry, out, routes → markdown globs) → manifest.
- Local install into another repo: `bun run build && bun pm pack`, then `bun add -d <path>.tgz --force` there (bun caches same-version tarballs; without `--force` you get stale code). Bun also locks the tarball's dependency ranges by path, so after changing `dependencies` bump `version` first: a new tarball name is the only thing that makes the host re-resolve them. Turbopack won't follow `bun link` symlinks outside its root.

## Upstream (fix in OpenPkg, not here)

- A false name or required-argument hit is a bug in the section scan or in OpenPkg. Fix it there. Never filter it in the overlay.
- Exact checks stay in `src/read.ts`. Jev is only the behaviour question. It answers a set check with a confident no when it misses, which is why it is not asked.
- A type that arrives unresolved is left out of the record rather than asserted. Type refs resolve by `id` first, then by a unique name.
- Known limit here: the record shows type parameters of the export, not of each signature, and no defaults.

## Dependency policy

Exact pins for build tooling (bunup, biome), caret for the rest, typescript stays ^5, never dist-tags.
