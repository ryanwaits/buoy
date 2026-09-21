/**
 * The numbers that turn a score into something on the page. They live apart
 * from the rubric so the overlay can import them without the question text.
 */

export const DIMENSIONS = ['stale', 'inaccurate', 'incomplete'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * The atomic questions behind `inaccurate`: what a passage SAYS. What a call DOES (too many
 * arguments, an undefined option, a literal of the wrong type) is exact, so Drift decides it with
 * rules, and Jev is not asked.
 */
export const REASONS = ['prose', 'declared', 'members'] as const;
export type Reason = (typeof REASONS)[number];

/**
 * Where a score becomes a pin. From calibration runs on real docs passages of
 * open-source TypeScript projects (360 clean passages, then 823, then 2,242; jev-1.13.0). Each is the
 * lowest cut that kept every clean passage under the line, except where a
 * passage over it turned out to be a real docs bug. Jev's scores run
 * conservative, and differently per question, so one shared number throws
 * recall away. These are a precision trade, not a guarantee: about 1% of scores
 * cross 0.7 between identical runs. Re-derive with a calibration run when
 * RUBRIC or the model changes.
 */
export const THRESHOLDS: Record<'stale' | 'incomplete', number> = { stale: 0.5, incomplete: 0.5 };

/**
 * "Breaks a stated requirement" counts toward `incomplete` only from here up. A
 * section that says "must be nested inside `<LivelyProvider>`" and then shows
 * the component alone scored 0.54; a whole `App` without the provider, 0.82.
 */
export const SETUP_MIN = 0.7;

/**
 * For an export with overloads, "leaves out a required parameter" means required in every one of
 * them, and Jev hedges: `atom(null, write)`, `produce(recipe)` and `create()(...)`, each a valid
 * overload, scored 0.52-0.66. It counts from here up. Drift's `prose-missing-required` decides the
 * exact cases across overloads.
 */
export const INCOMPLETE_OVERLOADED_MIN = 0.7;

/**
 * `inaccurate` has a cut per question. Claims in prose are the noisy end and keep a high bar.
 * `declared` sits at 0.8: docs that spell the same overload with other generic names score up
 * to 0.74 and are not wrong.
 */
export const INACCURATE_MIN: Record<Reason, number> = {
  prose: 0.7,
  declared: 0.8,
  members: 0.7,
};
