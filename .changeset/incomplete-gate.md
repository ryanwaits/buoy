---
"@driftdev/buoy": minor
---

Jev is no longer asked whether a code sample is incomplete when its export has a checkable signature: that is Drift's exact check (`prose-missing-required`), and the sample must not write on the ledger. `incomplete` stays for prose uses, and `setup` stays everywhere. A call whose options literal elides at its own level (`f({ // ... })`, `f({ a, ... })`) is a fragment, not a use. On the AI SDK docs this took 111 false "incomplete" findings to 0 with no true one lost.
