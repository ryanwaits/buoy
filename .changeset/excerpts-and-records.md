---
"@driftdev/buoy": minor
---

`buoy build` writes two more things per page, both dev-only: `excerpts`, a few lines of source at each cited declaration (and at each member found in the export's file), and `records`, the spec record each export was checked against. The card's source panel shows the code with the line marked, and says when a member is not in that file (inherited, or from a type). The spec panel shows the description, the props or parameters with what the finding says about each, and the members.
