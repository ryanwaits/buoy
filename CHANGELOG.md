# @driftdev/buoy

## 0.3.0

### Minor Changes

- 0513b6c: `buoy build` writes two more things per page, both dev-only: `excerpts`, a few lines of source at each cited declaration (and at each member found in the export's file), and `records`, the spec record each export was checked against. The card's source panel shows the code with the line marked, and says when a member is not in that file (inherited, or from a type). The spec panel shows the description, the props or parameters with what the finding says about each, and the members.
- 436c432: One card, one finding. A place with several findings walks them with "1 of 2 ›" (and the arrow keys) instead of a bulleted list, and each is resolved on its own. A section's unmentioned members stay one finding; their names sit under Details, one per line. The Details rows (docs, spec, source, and why for a model's read) push over the card and slide back; the `check` row is gone, since the copied brief carries the command on every finding's Verify line.
- 46f780e: Review by resolving. Each card has **Not a problem** and **Resolve**; Resolve takes one line on what should happen (Enter or Done). A resolved buoy stays on the page turned inside out with a check, and leaves the count. **Copy for agent** now opens with a Decisions section, the reviewer's words per finding, before the findings and ground rules; findings resolved as not a problem are left out. The Dismissed panel is now Resolved, with undo per decision. The note-for-the-writer field and the per-card copy button are gone: the decision is the note, and the toolbar copies the page. Earlier dismissals carry over as not a problem.

### Patch Changes

- 8b48599: A "never documented" finding says what kind of member is missing (`LivelyServer` has a `port` getter this page never documents) and, when the same name appears on the page as an option key, says that it is not the member. "Never mentioned" reads "never documented" throughout. On Drift 1.16.13, a member used inside a code comment counts as documented.

## 0.2.1

### Patch Changes

- 0dc78c4: The toolbar icon is now a pillar buoy riding a wave, in place of the crosshair circle. Its lamp takes the mark colour (`--buoy-mark`).

## 0.2.0

### Minor Changes

- f821f2f: Code blocks built from `<div>`s are read. A block whose class says code and whose text is plainly JS or TS is checked like a `<pre>`, and the overlay places its findings, ring and buoys in that block. Replaces the 0.1.0 warning that named such pages and held back their "never mentioned" findings: there is nothing left to warn about.

### Patch Changes

- 1a3d6b3: Buoys and the dashed "never mentioned" line sit in the article's text column, measured from its content, instead of spanning a root (such as `<main>`) that is wider than the article.

## 0.1.0

### Minor Changes

- ff3dc11: `buoy build` names rendered pages whose code blocks are not in a `<pre>` (Buoy cannot read them) and holds back those pages' "never mentioned" findings, which such pages used to over-report.
