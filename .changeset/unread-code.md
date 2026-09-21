---
"@driftdev/buoy": minor
---

`buoy build` names rendered pages whose code blocks are not in a `<pre>` (Buoy cannot read them) and holds back those pages' "never mentioned" findings, which such pages used to over-report. The default article root is resolved one selector at a time, so `main` no longer wins over the article inside it.
