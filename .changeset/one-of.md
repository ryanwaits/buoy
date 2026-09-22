---
"@driftdev/buoy": patch
---

On Drift 1.18.1 and OpenPkg 0.55.1: a function whose options are a union (`generateText` takes `prompt` or `messages`) shows which keys a caller picks between, and a sample that passes neither is a proved finding.
