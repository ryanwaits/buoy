---
"@driftdev/buoy": minor
---

From the prose audit on the AI SDK docs. Rendered mode carries a code block's title into the fence (`title="AI SDK 5"`), which is how Drift 1.19 tells "before" code in a migration guide from "after" and leaves it alone. A settings type too big to spell out in the record is listed by its key names, so a passage that names `toolApproval` is read against a record that has it. The card's `spec` line reads Buoy's own record (keys and all) instead of Drift's `options: object`. On Drift 1.19.2 and OpenPkg 0.55.2: headings join a type only with evidence, gaps only where a section documents the surface, a bare backticked member resolves only in scope, "the `k` option" in prose is checked, chained receivers and diff fences are read right, negated and "before" code carries no claims.
