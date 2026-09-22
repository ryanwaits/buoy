---
"@driftdev/buoy": patch
---

On Drift 1.18 and OpenPkg 0.55: a receiver imported from another package is never checked, a printed `interface X { … }` documents its keys and a wrong key in it is reported, an elided `{ // ... }` literal is not missing-required, and options objects are checked key by key.
