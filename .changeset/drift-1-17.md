---
"@driftdev/buoy": patch
---

On Drift 1.17.0: Buoy no longer pulls in `zod`, so it installs cleanly inside repos whose workspace is `zod` itself.
