/**
 * The rubric: what "stale", "inaccurate" and "incomplete" mean for a docs
 * passage read against a spec record.
 *
 * TypeSafe's guidance, which the first calibration run bore out: a broad
 * question hides several judgments behind one number. So "inaccurate" is a few
 * atomic questions, each about one thing a passage can say, combined here in code. Bump RUBRIC
 * when wording changes: cached scores and calibration numbers belong to one version.
 */

import type { Noul } from '../sonar';
import type { Use } from './evidence';
import {
  type Dimension,
  INACCURATE_MIN,
  INCOMPLETE_OVERLOADED_MIN,
  REASONS,
  type Reason,
  SETUP_MIN,
} from './thresholds';

export const RUBRIC = 17;

export {
  DIMENSIONS,
  type Dimension,
  INACCURATE_MIN,
  REASONS,
  type Reason,
  THRESHOLDS,
} from './thresholds';

const noul = (instructions: string, yes: string, no: string): Noul => ({
  type: 'noul',
  instructions,
  criteria: { true: yes, false: no },
});

export type QuestionId =
  | 'about'
  | 'counter'
  | 'stale'
  | 'incomplete'
  | 'setup'
  | 'prose'
  | 'declared'
  | 'members';

/** State paths are in backticks so the model reads them as references, not prose. */
export const QUESTIONS: Record<QuestionId, Noul> = {
  about: noul(
    'Is the `passage` explaining or demonstrating how to use `export.name` itself?',
    'The passage documents it: it is the subject of the heading or sentence, or the code sample exists to show how to call, render or configure it.',
    'The passage is about something else and only mentions it in passing, for example as the type of a value another API returns.',
  ),
  // Docs show wrong code on purpose: "This throws", a "Previous API" section in a migration guide.
  counter: noul(
    'Does the `passage`, or its `heading`, present the code that uses `export.name` as what NOT to write: old, wrong, or broken on purpose?',
    'The heading or the text around the code marks it as the previous API, a "before" in a before/after, a mistake, or an example that fails ("Previous API", "Before", "Don\'t", "❌", "This throws", "Broken", "Wrong").',
    'The passage presents the code as the way to do it, or as a neutral example, or contains no code.',
  ),
  stale: noul(
    'Does the `passage` present `export.name` as the current way to do something, even though `export` says it is deprecated or replaced?',
    '`export.deprecated` is true or `export.replacement` is set, and the passage uses or recommends it without saying it is deprecated.',
    '`export` is not deprecated, or the passage already tells the reader it is deprecated or what replaces it.',
  ),
  // `incomplete` is two questions for the same reason `inaccurate` is five: one broad
  // "would this fail?" hedged around 0.6-0.8 on real breaks.
  incomplete: noul(
    'Does a call or JSX element in the `passage` leave out a parameter or prop that `export` marks required?',
    '`export.parameters`, `export.props`, or every one of `export.overloads` has a required entry that the call in the passage does not pass. JSX children count as the `children` prop.',
    'Every required parameter or prop is passed, or the passage shows no call or element for `export.name`.',
  ),
  setup: noul(
    'Does the code in the `passage` use `export.name` in a way that breaks a requirement stated in `export.description`?',
    'The description says it must be used inside, after, or together with something (a provider, an init call, a plugin), and the code in the passage visibly does not do that.',
    'The description states no such requirement, or the passage satisfies it, or the passage does not show enough code to tell: a snippet that shows the call or element on its own, outside any component, function or app, says nothing about what surrounds it.',
  ),
  members: noul(
    'Does the `passage` call a method or read a property on `export.name`, or on an instance of it, that `export.members` does not list?',
    '`export.members` is present, and the passage uses a member by a name that is in neither `export.members` nor `export.otherMembers`: a renamed or removed method or property.',
    'Every member the passage uses is listed in `export.members` or named in `export.otherMembers`, or `export.members` is absent, or the passage uses no members of it. A sentence saying the type does NOT have a member ("No `delete` method", "lacks methods like `pick` and `omit`", "there is no `.foo()`") agrees with a record that does not list it: that is not a use.',
  ),
  prose: noul(
    'Does the prose of the `passage` claim a return value, default or behaviour for `export.name` that `export` contradicts?',
    'A sentence says it returns, defaults to or does something, and `export.returns`, `export.signature`, a `default` in `export.parameters`, or `export.description` says otherwise.',
    'What the prose claims is consistent with `export`, or `export` is silent on it. Details the passage leaves out do not count.',
  ),
  // Split from `prose`: a type written out in a table cell or a `Type:` line hedged at 0.5-0.7 there.
  declared: noul(
    'Does the `passage` write out a type for `export.name` (its signature, a parameter type or its return type) that conflicts with `export.signature`, `export.parameters` or `export.returns`?',
    'A table cell, a `Type:` or `Returns:` line, a heading or a declaration in the passage spells out a type for it, and the record declares a different one: another primitive, another shape, a different number of parameters, or a wrapper the passage leaves out.',
    'The passage writes out no type for it, or the type it writes is the same as the record, a shortened or generic-free form of it, or the same union in another order.',
  ),
};

/**
 * Below this, the passage is not about the export, so nothing it says can be
 * inaccurate about it. Only `inaccurate` is gated. Calibration showed the gate
 * is what keeps a prop table for one component from being read against another
 * export; it bought nothing for `stale` (teaching a deprecated API in passing is
 * still teaching it) or `incomplete`, and cost both recall.
 */
// 0.3, not 0.5: on 360 clean passages the same three real docs bugs cross the line at any cut from
// 0.2 to 0.5, but at 0.5 the gate also zeroed 2 of 4 renamed-method breaks, where a passage calls
// `client.joinRoom()` and reads as being about the instance rather than the class. At 0 a zustand
// module-augmentation example gets through. Few cases; revisit with more.
export const ABOUT_MIN = 0.3;

/**
 * From here up the passage shows its code as a counter-example, and code that is wrong on
 * purpose cannot be wrong by accident: nothing about the call itself is reported. What the prose
 * SAYS can still be wrong.
 */
export const COUNTER_MIN = 0.5;

/**
 * What a passage says in words (`prose`, `declared`) needs the passage to be about the export, not
 * just to touch it: "the hook calls `useUpdateCursor` internally" scored 0.75 on `prose` against
 * `useUpdateCursor`, with `about` at 0.30. On 134 broken cases, 0.5 cost no recall in two runs.
 */
export const ABOUT_SAID_MIN = 0.5;

/**
 * Atomic answers → the three scores Buoy shows. Composition lives in code, not in the model.
 *
 * `used` is a plain text check: does the passage call, construct or render the export, and is
 * that a whole call or element rather than a lone opening tag? Without one there is nothing to
 * be incomplete, and asking anyway only produced hedged 0.3-0.6 answers (47 of the 57 clean
 * passages in that band showed no call).
 *
 * `inaccurate` is the question furthest over its own cut, since each has its own.
 */
export function combine(
  p: Record<QuestionId, number>,
  used: Use | null,
  overloaded = false,
): Record<Dimension, number> & { about: number; reason: Reason } {
  const counter = (p.counter ?? 0) >= COUNTER_MIN;
  const said: Reason[] = ['prose', 'declared'];
  const score = (r: Reason): number =>
    p.about >= (said.includes(r) ? ABOUT_SAID_MIN : ABOUT_MIN) && !(counter && r === 'members')
      ? (p[r] ?? 0)
      : 0;
  const reason = REASONS.reduce((a, b) =>
    score(b) - INACCURATE_MIN[b] > score(a) - INACCURATE_MIN[a] ? b : a,
  );
  return {
    about: p.about,
    stale: p.stale,
    incomplete:
      used === 'whole' && !counter
        ? Math.max(
            overloaded && p.incomplete < INCOMPLETE_OVERLOADED_MIN ? 0 : p.incomplete,
            (p.setup ?? 0) >= SETUP_MIN ? p.setup : 0,
          )
        : 0,
    inaccurate: score(reason),
    reason,
  };
}
