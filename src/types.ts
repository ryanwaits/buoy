import type { Claim, PageDocument } from '@driftdev/sdk';
import type { Excerpt } from './excerpts';
import type { SpecRecord } from './lookout/evidence';
import type { Reason } from './lookout/thresholds';

export type {
  Claim,
  ClaimKind,
  Locator,
  PageDocument,
  RuleHit,
  SpecRef,
  SpecSlice,
} from '@driftdev/sdk';
export type { Excerpt, SpecRecord };

/**
 * Jev's reading of a claim. Probabilities, never verdicts. There is no separate
 * confidence: for a yes/no answer the probability is the certainty.
 */
export type Jev = {
  stale: number;
  incomplete: number;
  inaccurate: number;
  /** Which atomic question drove `inaccurate`, so the reader is told what is wrong, not just that something is */
  reason?: Reason;
  /**
   * Identifiers the passage uses as members of the export that the spec record does not have.
   * Worked out by code from the passage and the record, never by the model. Absent when none are certain.
   */
  names?: string[];
  /** With `names`: the members the record does have, so the reader sees what the word was checked against. */
  has?: string[];
};

/** The only thing Buoy adds to Drift's contract. */
export type JudgedClaim = Claim & { jev?: Jev };

export type JudgedPage = Omit<PageDocument, 'claims'> & {
  claims: JudgedClaim[];
  /** How `buoy build` checked this page, so the copied prompt can say how to verify it. */
  source?: { mode: 'markdown' | 'rendered'; entry: string };
  /** Where each export on this page is declared, `file:line` from the spec, keyed by export name. */
  declared?: Record<string, string>;
  /** A few lines of source at each declaration, keyed by export name and `Export.member`. Build-time only. */
  excerpts?: Record<string, Excerpt>;
  /** The spec record each export was checked against, keyed by export name. Build-time only. */
  records?: Record<string, SpecRecord>;
  /** What kind of member each undocumented one is (`getter`, `method`, `property`), keyed by `Export.member`. */
  kinds?: Record<string, string>;
};

/** Written by `buoy build`. Routes are URL pathnames without a trailing slash. */
export type Manifest = {
  version: 1;
  routes: Record<string, JudgedPage[]>;
};

/** A claim located in the rendered page. Gap anchors select the last block of their section. */
export type Anchor = {
  claim: JudgedClaim;
  range: Range;
};

export type AnchorResult = {
  placed: Anchor[];
  /** Claims the rendered page gave no place for. Surfaced, never dropped. */
  unplaced: JudgedClaim[];
};
