# @driftdev/buoy

## 0.6.0

### Minor Changes

- 1b963b1: From the prose audit on the AI SDK docs. Rendered mode carries a code block's title into the fence (`title="AI SDK 5"`), which is how Drift 1.19 tells "before" code in a migration guide from "after" and leaves it alone. A settings type too big to spell out in the record is listed by its key names, so a passage that names `toolApproval` is read against a record that has it. The card's `spec` line reads Buoy's own record (keys and all) instead of Drift's `options: object`. On Drift 1.19.2 and OpenPkg 0.55.2: headings join a type only with evidence, gaps only where a section documents the surface, a bare backticked member resolves only in scope, "the `k` option" in prose is checked, chained receivers and diff fences are read right, negated and "before" code carries no claims.

## 0.5.1

### Patch Changes

- 0d22f48: On Drift 1.18.1 and OpenPkg 0.55.1: a function whose options are a union (`generateText` takes `prompt` or `messages`) shows which keys a caller picks between, and a sample that passes neither is a proved finding.

## 0.5.0

### Minor Changes

- d04a747: Jev is no longer asked whether a code sample is incomplete when its export has a checkable signature: that is Drift's exact check (`prose-missing-required`), and the sample must not write on the ledger. `incomplete` stays for prose uses, and `setup` stays everywhere. A call whose options literal elides at its own level (`f({ // ... })`, `f({ a, ... })`) is a fragment, not a use. On the AI SDK docs this took 111 false "incomplete" findings to 0 with no true one lost.

## 0.4.0

### Minor Changes

- d921767: A function that destructures one options object (`embed({ model, value })`, a React component's props) is read as its keys: the spec record shows `embed({ model: string, value: string, … })`, a component shows `<RoomProvider roomId userId … />`, and the card's proof line names the keys. Needs OpenPkg 0.55, which emits the parameter as one `x-ts-destructured` entry. `prose-declared-key` (Drift 1.18) files under "Wrong name or import".

### Patch Changes

- 4aca8b3: On Drift 1.18 and OpenPkg 0.55: a receiver imported from another package is never checked, a printed `interface X { … }` documents its keys and a wrong key in it is reported, an elided `{ // ... }` literal is not missing-required, and options objects are checked key by key.
- 56490fa: Sidebar dots follow their nav row in the same paint, and stay inside the sidebar's scrollport.
- 8d59443: A bare `name()` in prose names the function. It is a call only in code, or when the arguments are written out.

## 0.3.1

### Patch Changes

- eb4a79a: On Drift 1.17.0: Buoy no longer pulls in `zod`, so it installs cleanly inside repos whose workspace is `zod` itself.
- 08ab02d: A deprecation note reads as the reader would see it: `{@link cuid2 `z.cuid2()`}` shows as `z.cuid2()`.
- f87ee18: A resolved buoy keeps its solid colour, with a tick in place of the count, instead of inverting.

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
