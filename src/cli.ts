#!/usr/bin/env node
/**
 * `buoy build`: a section of docs, the OpenPkg record for the names it uses,
 * code for the set checks, Jev for one behaviour question.
 */

import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { extract } from '@openpkg-ts/sdk';
import { normalize } from '@openpkg-ts/spec';
import { type Config, entryFor, entryPath } from './config';
import { declaredAt } from './declared';
import { excerptsFor } from './excerpts';
import { type OpenPkgSpec, type SpecRecord, specRecord } from './lookout/evidence';
import { isFinding } from './policy';
import { type ReadCache, type ReadStats, readPage } from './read';
import { renderedToMarkdown } from './rendered';
import { jev } from './sonar';
import type { JudgedPage, Manifest, SpecSlice } from './types';

function fail(message: string): never {
  console.error(`buoy: ${message}`);
  process.exit(1);
}

type Indexed = { spec: OpenPkgSpec; name: string };

function add(manifest: Manifest, route: string, pages: JudgedPage[]): void {
  const key = route.replace(/(.)\/$/, '$1');
  manifest.routes[key] = [...(manifest.routes[key] ?? []), ...pages];
}

async function build(configPath: string): Promise<void> {
  if (!existsSync(configPath)) fail(`${configPath} not found`);
  const base = path.dirname(path.resolve(configPath));
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
  for (const key of ['entry', 'out'] as const) {
    if (!config[key]) fail(`${configPath} needs "${key}"`);
  }
  if (!config.routes && !config.pages)
    fail(`${configPath} needs "routes" (markdown) or "pages" (rendered)`);
  if (config.pages && !config.site) fail(`${configPath} needs "site" to fetch "pages" from`);

  const specs = new Map<string, Promise<Indexed>>();
  const specFor = (configured: string): Promise<Indexed> => {
    const entry = path.resolve(base, configured);
    if (!existsSync(entry)) fail(`entry not found: ${configured}`);
    let found = specs.get(entry);
    if (!found) {
      found = extract({ entryFile: entry }).then((result) => {
        const spec = normalize(result.spec) as OpenPkgSpec & { meta?: { name?: string } };
        return { spec, name: spec.meta?.name ?? '' };
      });
      specs.set(entry, found);
    }
    return found;
  };

  const classifier = process.env.TYPESAFE_API_KEY ? jev() : null;
  const cacheFile = path.join(base, '.buoy', 'jev.json');
  const cache: ReadCache =
    classifier && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const judged: ReadStats = { requests: 0, cached: 0, inputTokens: 0 };

  const manifest: Manifest = { version: 1, routes: {} };
  let findings = 0;

  const check = async (
    route: string,
    mode: 'markdown' | 'rendered',
    files: { file: string; content: string }[],
  ): Promise<void> => {
    const configured = entryFor(config.entry, route);
    if (!configured) fail(`no entry for ${route}. Add it, a prefix of it, or "*" to "entry".`);
    const primary = await specFor(entryPath(configured));
    const also = typeof configured === 'string' ? [] : (configured.also ?? []);
    const rest = await Promise.all(also.map((other) => specFor(other.path)));
    const indexed = [primary, ...rest];
    const importFrom = [
      ...(typeof configured === 'string'
        ? [primary.name]
        : [configured.importSpecifier ?? primary.name]),
      ...also.map((other, i) => other.importSpecifier ?? rest[i]?.name ?? ''),
    ].filter((name): name is string => Boolean(name));
    const entry = entryPath(configured);
    const pages: JudgedPage[] = [];
    for (const file of files) {
      const read = await readPage(
        file.file,
        file.content,
        indexed.map((item) => item.spec),
        importFrom,
        classifier,
        cache,
      );
      judged.requests += read.stats.requests;
      judged.cached += read.stats.cached;
      judged.inputTokens += read.stats.inputTokens;
      judged.model = read.stats.model ?? judged.model;
      const claims = read.claims.filter((claim) => isFinding(claim));
      const specs = indexed.map((item) => item.spec);
      const records: Record<string, SpecRecord> = {};
      const slices: SpecSlice[] = [];
      for (const name of new Set(claims.flatMap((claim) => claim.specRef?.export ?? []))) {
        for (const spec of specs) {
          const found = spec.exports.find((item) => item.name === name || item.localName === name);
          if (!found) continue;
          const record = specRecord(spec, found);
          records[name] = record;
          slices.push({
            export: name,
            ...(record.signature ? { signature: record.signature, body: record.signature } : {}),
            ...(record.deprecated ? { deprecated: true } : {}),
            ...(record.replacement ? { replacement: record.replacement } : {}),
          });
          break;
        }
      }
      const declared = declaredAt(claims, specs, base);
      const page: JudgedPage = {
        packageName: primary.name,
        path: mode === 'rendered' ? route : file.file,
        title: file.content.match(/^#{1,6}\s+(.+)$/m)?.[1],
        claims,
        slices,
        source: { mode, entry },
        ...(declared ? { declared } : {}),
        ...(declared ? { excerpts: excerptsFor(claims, declared, base) } : {}),
        ...(Object.keys(records).length ? { records } : {}),
      };
      findings += claims.length;
      pages.push(page);
    }
    add(manifest, route, pages);
  };

  for (const [route, patterns] of Object.entries(config.routes ?? {})) {
    const files = patterns.flatMap((pattern) => globSync(pattern, { cwd: base })).sort();
    if (!files.length) console.warn(`buoy: ${route} matched no files`);
    await check(
      route,
      'markdown',
      files.map((file) => ({
        file: file.replace(/\\/g, '/'),
        content: readFileSync(path.join(base, file), 'utf8'),
      })),
    );
  }

  for (const route of config.pages ?? []) {
    const url = new URL(route, config.site);
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) fail(`could not fetch ${url} (${res?.status ?? 'is the dev server running?'})`);
    const content = renderedToMarkdown(await res.text(), config.root);
    if (content === null) fail(`${route}: no article found. Set "root" to its selector.`);
    await check(route, 'rendered', [{ file: route, content }]);
  }

  const out = path.resolve(base, config.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(manifest));
  if (classifier) {
    mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
    const cost = ((judged.inputTokens / 1e6) * 0.042).toFixed(4);
    console.log(
      `buoy: Jev (${judged.model || 'cached'}) read ${judged.requests} sections, ${judged.cached} from cache, ${judged.inputTokens} tokens ≈ $${cost}`,
    );
  }
  const routes = Object.keys(manifest.routes).length;
  console.log(`buoy: ${findings} findings across ${routes} routes → ${config.out}`);
}

const [command, ...rest] = process.argv.slice(2);
const flag = rest.indexOf('--config');
if (command !== 'build') fail('usage: buoy build [--config buoy.config.json]');
await build(flag >= 0 ? rest[flag + 1] : 'buoy.config.json').catch((err: Error) =>
  fail(err.message),
);
