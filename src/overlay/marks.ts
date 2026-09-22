import { tokenRange } from '../anchor/token';
import { offending } from '../output';
import type { Anchor, JudgedClaim } from '../types';

/**
 * What gets a buoy: a place, not a finding. Findings on the same span share one
 * (an unknown prop and a missing one on one tag are one stop for the reader), and
 * the members a section never documents share one `+N`. The popover lists them.
 */
export type Mark = {
  id: string;
  /** Places the mark: the word that is wrong when the page shows it, else the claim's own range. */
  anchor: Anchor;
  /** Set when `anchor` is that word, so it can be washed. */
  token: boolean;
  claims: JudgedClaim[];
};

/** `blockId` must return the same id for the same node for as long as it lives. */
export function toMarks(anchors: Anchor[], blockId: (block: Node) => number): Mark[] {
  const marks: Mark[] = [];
  const places = new Map<string, Mark>();
  for (const anchor of anchors) {
    const { claim, range } = anchor;
    const gap = claim.kind === 'gap';
    const block = range.startContainer.childNodes[range.startOffset] ?? range.startContainer;
    const id = gap
      ? `gap:${blockId(block)}`
      : `at:${blockId(range.startContainer)}:${range.startOffset}:${blockId(range.endContainer)}:${range.endOffset}`;
    const place = places.get(id);
    if (place) {
      place.claims.push(claim);
      if (!place.token) narrow(place, anchor);
      continue;
    }
    const mark: Mark = { id, anchor, token: false, claims: [claim] };
    if (!gap) narrow(mark, anchor);
    places.set(id, mark);
    marks.push(mark);
  }
  return marks;
}

function narrow(mark: Mark, { claim, range }: Anchor): void {
  const token = tokenRange(range, offending(claim));
  if (!token) return;
  mark.anchor = { claim, range: token };
  mark.token = true;
}
