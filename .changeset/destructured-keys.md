---
"@driftdev/buoy": minor
---

A function that destructures one options object (`embed({ model, value })`, a React component's props) is read as its keys: the spec record shows `embed({ model: string, value: string, … })`, a component shows `<RoomProvider roomId userId … />`, and the card's proof line names the keys. Needs OpenPkg 0.55, which emits the parameter as one `x-ts-destructured` entry. `prose-declared-key` (Drift 1.18) files under "Wrong name or import".
