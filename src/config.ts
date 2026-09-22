/**
 * A package entry: a path, or a path plus which import specifier it covers.
 * `importSpecifier` when the entry is a `package.json` `exports` subpath
 * (`jotai/utils`), so imports from the package root are not its business.
 * `also` for pages that document more than one entry (zod and `zod/mini`
 * share an API page): a name any of them exports is not a broken reference.
 */
export type Entry =
  | string
  | { path: string; importSpecifier?: string; also?: { path: string; importSpecifier?: string }[] };

const isEntry = (value: unknown): value is Entry =>
  typeof value === 'string' || typeof (value as { path?: unknown })?.path === 'string';

export const entryPath = (entry: Entry): string => (typeof entry === 'string' ? entry : entry.path);

/** `buoy.config.json`. Paths are relative to the config file. */
export type Config = {
  /**
   * Package entry the docs describe. In a multi-package repo, a map of route →
   * entry: exact route first, then the longest route prefix, then `"*"`.
   */
  entry: Entry | Record<string, Entry>;
  /** Manifest path, somewhere the dev server serves statically */
  out: string;
  /** Markdown mode. URL pathname → markdown files (globs) rendered on that route */
  routes?: Record<string, string[]>;
  /** Rendered-page mode. Dev server origin, e.g. `http://localhost:3000` */
  site?: string;
  /** Rendered-page mode. URL pathnames to fetch from `site` and check as rendered */
  pages?: string[];
  /** Rendered-page mode. Selector for the article; defaults to the known docs containers */
  root?: string;
};

/** The entry a route is checked against. */
export function entryFor(entry: Config['entry'], route: string): Entry | undefined {
  if (isEntry(entry)) return entry;
  const prefix = Object.keys(entry)
    .filter((key) => key !== '*' && (route === key || route.startsWith(`${key}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return entry[prefix ?? '*'];
}
