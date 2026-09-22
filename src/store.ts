/**
 * Per-browser review state, keyed by claim ids.
 * v1 is local only; shared threads wait for a real need.
 */

const RESOLVED = 'buoy:resolved';
const HIDDEN = 'buoy:hidden';
/** Pre-0.3 keys, folded into `resolved` once and then removed. */
const OLD_NOTES = 'buoy:notes';
const OLD_DISMISSED = 'buoy:dismissed';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage: state lives for the session only.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above.
  }
}

/**
 * A reader's decision on a finding. `null` is "not a problem"; a string is "real, and
 * here is what should happen", possibly empty. Both leave the count; only the string
 * goes to the agent.
 */
export type Decision = string | null;

export type Store = {
  resolved: Record<string, Decision>;
  /** Filter keys the reader turned off: evidence (`proved`, `likely`) and kinds. */
  hidden: Set<string>;
  save(): void;
};

export function loadStore(): Store {
  const resolved = read<Record<string, Decision>>(RESOLVED, {});
  // What was dismissed is resolved as not a problem; a note it had comes along as the decision.
  const dismissed = read<string[]>(OLD_DISMISSED, []);
  if (dismissed.length) {
    const notes = read<Record<string, string>>(OLD_NOTES, {});
    for (const id of dismissed) resolved[id] ??= notes[id]?.trim() || null;
    write(RESOLVED, resolved);
  }
  remove(OLD_DISMISSED);
  remove(OLD_NOTES);
  const store: Store = {
    resolved,
    hidden: new Set(read<string[]>(HIDDEN, [])),
    save() {
      write(RESOLVED, store.resolved);
      write(HIDDEN, [...store.hidden]);
    },
  };
  return store;
}
