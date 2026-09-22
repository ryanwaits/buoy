/**
 * The manifest the overlay reads. Owned here. A claim is a proof (a rule) or a
 * behaviour reading (jev). The card sentence is still a code template.
 */

export type ClaimKind = 'fence' | 'heading' | 'inline' | 'table-key' | 'prose' | 'gap';

export type SourcePos = { line: number; col: number };

export type Locator = {
  path: string;
  start: SourcePos;
  end: SourcePos;
  headingId?: string;
  headingText?: string;
};

export type SpecRef = {
  export: string;
  member?: string;
  signature?: string;
  deprecated?: boolean;
  deprecationNote?: string;
  replacement?: string;
};

export type RuleHit = {
  type: string;
  issue: string;
  suggestion?: string;
};

export type Claim = {
  id: string;
  kind: ClaimKind;
  text: string;
  locator: Locator;
  specRef: SpecRef | null;
  rule?: RuleHit;
  candidate?: boolean;
};

export type SpecSlice = SpecRef & { body?: string };

export type PageDocument = {
  packageName: string;
  path: string;
  title?: string;
  claims: Claim[];
  slices: SpecSlice[];
};
