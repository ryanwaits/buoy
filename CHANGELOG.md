# @driftdev/buoy

## 0.2.0

### Minor Changes

- f821f2f: Code blocks built from `<div>`s are read. A block whose class says code and whose text is plainly JS or TS is checked like a `<pre>`, and the overlay places its findings, ring and buoys in that block. Replaces the 0.1.0 warning that named such pages and held back their "never mentioned" findings: there is nothing left to warn about.

### Patch Changes

- 1a3d6b3: Buoys and the dashed "never mentioned" line sit in the article's text column, measured from its content, instead of spanning a root (such as `<main>`) that is wider than the article.

## 0.1.0

### Minor Changes

- ff3dc11: `buoy build` names rendered pages whose code blocks are not in a `<pre>` (Buoy cannot read them) and holds back those pages' "never mentioned" findings, which such pages used to over-report.
