/**
 * Per-browser review state, keyed by Drift's stable claim ids.
 * v1 is local only; shared threads wait for a real need.
 */

const NOTES = 'buoy:notes';
const DISMISSED = 'buoy:dismissed';
const HIDDEN = 'buoy:hidden';

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

export type Store = {
  notes: Record<string, string>;
  dismissed: Set<string>;
  /** Filter keys the reader turned off: evidence (`proved`, `likely`) and kinds. */
  hidden: Set<string>;
  save(): void;
};

export function loadStore(): Store {
  const store: Store = {
    notes: read<Record<string, string>>(NOTES, {}),
    dismissed: new Set(read<string[]>(DISMISSED, [])),
    hidden: new Set(read<string[]>(HIDDEN, [])),
    save() {
      write(NOTES, store.notes);
      write(DISMISSED, [...store.dismissed]);
      write(HIDDEN, [...store.hidden]);
    },
  };
  return store;
}
