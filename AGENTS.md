In all interactions, plans, and commit messages, be extremely concise and sacrifice grammar for the sake of concision.

Always use bun.

## What this is

Buoy (`@driftdev/buoy`): docs-review overlay devtool. Drift finds it, Buoy marks it. Drift (`@driftdev/sdk` `buildPageDocument`) emits claims; Buoy anchors them on the host's rendered docs page and paints buoys + popover + toolbar. Not Drift; separate product.

## Hard rules

- Never rewrite docs. Score, point at the spec, copy findings as markdown. No generated fixes.
- Never mutate the host DOM. Overlay layer only (Shadow DOM, rects from Ranges). React hosts re-render.
- A buoy is a buoy: one identical solid circle in the host's heading ink. Proved (rule) vs likely (Jev) is told in the popover's top line only, and by the Evidence filter. Chrome is neutral; the one colour is the yellow wash behind the wrong word. Visual language follows agentation.com.
- Popover sentences are code templates (`output.sentence`), never model text.
- Drift's `PageDocument`/`Claim` is frozen. Buoy adds only `claim.jev` (scores, `reason`, and for `members` findings `names` + `has`, worked out by code) and page-level `source`, `declared`, `excerpts` (a few source lines per cited declaration) and `records` (the spec record each export was checked against), all written by the build. Need more from Drift → note the gap, fix it in Drift, don't fork the schema.
- Unplaced claims are surfaced, never dropped.
- Core is vanilla TS, zero runtime deps: Mintlify takes plain `.js` only, Blume is Astro. React is a thin wrapper.
- Dev-only for now. No prod/preview gating.
- Default is no: new parts must pass the should-add gate. UI is buoys + popover + toolbar with two panels (Filter: evidence + kind; Pages). No settings.
- Never `npm publish` without an explicit go.

## Layout

- `src/anchor` claim → DOM `Range`. Tested against hand-written fixtures in `test/fixtures` that mirror the DOM shapes of Fumadocs, Docusaurus, Mintlify and Blume pages; the content is invented.
- `src/overlay` shadow-root UI (buoys, popover, toolbar, panels). `marks.ts`: one mark per place: findings on the same span share a buoy, a section's gaps share one `+N`. `anchor/token.ts` moves a mark onto the word that is wrong (in its block; for a heading claim, in its section's code). `policy.ts`: `kindOf`, `issueKey` (same issue in N places = one decision, one count), `isHidden`. `mount({ data })`; data = pages or a manifest resolved by `location.pathname`.
- `src/rendered.ts` rendered-page mode: fetched HTML → markdown subset → Drift. Sits beside markdown mode (`routes`); config `site` + `pages` (+ `root`). Wants semantic HTML (`<pre>`, headings); `src/fence.ts` is the one definition of a code block (`<pre>`, or a `<div>` whose class says code and whose text is plainly JS/TS), shared by the build (`divFence`) and the overlay (`anchor/token.ts` `fenceOf`): change both together, never one. Build-time only, never imported by the overlay.
- `src/config.ts` `buoy.config.json` shape. `entry` is one path or a route → entry map (exact, longest prefix, `"*"`) for multi-package repos.
- `src/sonar` provider-neutral decision-model client; Jev (TypeSafe) is the first adapter. Imports nothing from Buoy; meant to become its own package.
- `src/lookout` the docs judge: `evidence` (passage + spec record), `rubric` (atomic yes/no questions, versioned), `thresholds` (per-dimension, from calibration), `judge` (one request per passage+record, cached in `.buoy/jev.json`). `buoy build` judges when `TYPESAFE_API_KEY` is set and `@typesafe-ai/sdk` is installed; otherwise rules only.
- Cuts in `thresholds.ts` come from a calibration harness kept outside this repo (it needs local clones of other projects). Bump `RUBRIC` when question wording changes; do not move a cut without a calibration run.
- The seam: a rule hit is the ledger (code checked it, certain, "Proved"); a Jev score is a sample (a probability, "Likely"). The sample never writes on the ledger: Jev is not asked about rule hits or gaps, and exact checks (arity, option keys, literal types, parameter tables, imports, required arguments) are Drift rules, never Jev questions. Jev keeps what code cannot do: stale, what prose says, written-out types, members named in prose, setup. `incomplete` is asked only where no rule can answer it: never on a fenced sample (or a passage that includes one) whose record is shaped, never on a heading; an elided call (`f({ // ... })`, `f({ a, ... })`) is a fragment, not a use.
- `src/react.ts` `<Buoy />` thin wrapper (`@driftdev/buoy/react`). `src/cli.ts` `buoy build`: `buoy.config.json` (entry, out, routes → markdown globs) → manifest.
- Local install into another repo: `bun run build && bun pm pack`, then `bun add -d <path>.tgz --force` there (bun caches same-version tarballs; without `--force` you get stale code). Bun also locks the tarball's dependency ranges by path, so after changing `dependencies` bump `version` first: a new tarball name is the only thing that makes the host re-resolve them. Turbopack won't follow `bun link` symlinks outside its root.

## Upstream (fix in Drift or OpenPkg, not here)

- A false rule hit is a bug in Drift or OpenPkg. Fix it there, release OpenPkg -> Drift -> bump here, re-verify. Never filter it here.
- Exact checks belong in Drift as rules, never in a parser here: Jev answers them with a confident no when it misses.
- A type that arrives unresolved is left out of the record rather than asserted. Type refs resolve by `id` first, then by a unique name.
- Known limit here: the record shows type parameters of the export, not of each signature, and no defaults.

## Dependency policy

Same as Drift: exact pins for build tooling (bunup, biome), caret for the rest, typescript stays ^5, never dist-tags.
