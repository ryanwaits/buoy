#!/usr/bin/env node
/**
 * `buoy build`: markdown + spec → the manifest the overlay reads.
 * One spec extraction, every page. Jev judging slots in here later.
 */

import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { BuildPageDocumentsOptions, PageDocsMap } from '@driftdev/sdk';
import { buildExportRegistry, buildPageDocuments } from '@driftdev/sdk';
import type { ApiSpec } from '@driftdev/sdk/types';
import { extract } from '@openpkg-ts/sdk';
import { normalize } from '@openpkg-ts/spec';
import { type Config, entryFor, entryPath } from './config';
import { declaredAt, memberKinds } from './declared';
import { excerptsFor } from './excerpts';
import { type OpenPkgSpec, type SpecRecord, specRecord } from './lookout/evidence';
import { type JudgeCache, judge } from './lookout/judge';
import { isFinding } from './policy';
import { renderedToMarkdown } from './rendered';
import { jev } from './sonar';
import type { JudgedClaim, JudgedPage, Manifest } from './types';

function fail(message: string): never {
  console.error(`buoy: ${message}`);
  process.exit(1);
}

/** The overlay only paints findings; Drift's inventory stays out of the browser. */
function findingsOnly(page: JudgedPage): JudgedPage {
  const claims = page.claims.filter((c) => isFinding(c));
  const cited = (exportName: string, member?: string): boolean =>
    claims.some(
      (c) =>
        c.specRef?.export === exportName &&
        (c.specRef.member === member || c.specRef.replacement === member),
    );
  return { ...page, claims, slices: page.slices.filter((s) => cited(s.export, s.member)) };
}

type Truth = Pick<BuildPageDocumentsOptions, 'spec' | 'registry' | 'importSpecifier' | 'alsoSpecs'>;

/** A route can be covered by both modes; its pages add up. */
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

  const mapFile = path.join(base, 'drift.docs.json');
  const docsMap = existsSync(mapFile)
    ? (JSON.parse(readFileSync(mapFile, 'utf8')) as PageDocsMap)
    : undefined;

  // One extraction per entry, however many routes share it.
  const specs = new Map<string, Promise<Pick<Truth, 'spec' | 'registry'>>>();
  const specFor = (configured: string): Promise<Pick<Truth, 'spec' | 'registry'>> => {
    const entry = path.resolve(base, configured);
    if (!existsSync(entry)) fail(`entry not found: ${configured}`);
    let found = specs.get(entry);
    if (!found) {
      // Same extraction as `drift page`, so both tools see one spec.
      found = extract({ entryFile: entry }).then((result) => {
        const spec = normalize(result.spec) as unknown as ApiSpec;
        return { spec, registry: buildExportRegistry(spec) };
      });
      specs.set(entry, found);
    }
    return found;
  };
  const truthFor = async (route: string): Promise<Truth> => {
    const configured = entryFor(config.entry, route);
    if (!configured) fail(`no entry for ${route}. Add it, a prefix of it, or "*" to "entry".`);
    const primary = await specFor(entryPath(configured));
    if (typeof configured === 'string') return primary;
    const alsoSpecs = await Promise.all(
      (configured.also ?? []).map(async (other) => ({
        ...(await specFor(other.path)),
        ...(other.importSpecifier ? { importSpecifier: other.importSpecifier } : {}),
      })),
    );
    return {
      ...primary,
      ...(configured.importSpecifier ? { importSpecifier: configured.importSpecifier } : {}),
      ...(alsoSpecs.length ? { alsoSpecs } : {}),
    };
  };

  // Jev judges when there is a key to ask with. Without one the build is rules only.
  const classifier = process.env.TYPESAFE_API_KEY ? jev() : null;
  const cacheFile = path.join(base, '.buoy', 'jev.json');
  const cache: JudgeCache =
    classifier && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const judged = { requests: 0, cached: 0, inputTokens: 0, model: '' };

  const manifest: Manifest = { version: 1, routes: {} };

  /** The record the judge reads for each cited export, so the card can show what was checked. */
  const recordsFor = (
    claims: JudgedClaim[],
    specs: OpenPkgSpec[],
  ): Record<string, SpecRecord> | undefined => {
    const out: Record<string, SpecRecord> = {};
    for (const name of new Set(claims.flatMap((c) => c.specRef?.export ?? []))) {
      for (const s of specs) {
        const entry = s.exports.find((e) => e.name === name);
        if (!entry) continue;
        out[name] = specRecord(s, entry);
        break;
      }
    }
    return Object.keys(out).length ? out : undefined;
  };
  let findings = 0;
  const check = async (
    route: string,
    mode: 'markdown' | 'rendered',
    files: { file: string; content: string }[],
  ): Promise<void> => {
    const truth = await truthFor(route);
    let documents: JudgedPage[] = buildPageDocuments({ ...truth, docsMap, files });
    const spec = truth.spec as unknown as OpenPkgSpec;
    const also = (truth.alsoSpecs ?? []).map((other) => other.spec as unknown as OpenPkgSpec);
    if (classifier) {
      const contentOf = new Map(files.map((f) => [f.file, f.content]));
      const result = await judge(
        documents.map((page) => ({
          page,
          spec,
          also,
          content: contentOf.get(page.path) ?? '',
        })),
        classifier,
        cache,
      );
      documents = result.pages;
      judged.requests += result.stats.requests;
      judged.cached += result.stats.cached;
      judged.inputTokens += result.stats.inputTokens;
      judged.model = result.stats.model ?? judged.model;
    }
    const configured = entryFor(config.entry, route);
    const entry = configured ? entryPath(configured) : '';
    const pages = documents.map(findingsOnly).map((page) => {
      const declared = declaredAt(page.claims, [spec, ...also], base);
      const excerpts = declared ? excerptsFor(page.claims, declared, base) : undefined;
      const records = recordsFor(page.claims, [spec, ...also]);
      const kinds = memberKinds(page.claims, [spec, ...also]);
      return {
        ...page,
        source: { mode, entry },
        ...(declared ? { declared } : {}),
        ...(excerpts ? { excerpts } : {}),
        ...(records ? { records } : {}),
        ...(kinds ? { kinds } : {}),
      };
    });
    findings += pages.flatMap((p) => p.claims).length;
    add(manifest, route, pages);
  };

  for (const [route, patterns] of Object.entries(config.routes ?? {})) {
    const files = patterns.flatMap((p) => globSync(p, { cwd: base })).sort();
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

  // Rendered pages: what the reader sees is what gets checked, whatever the source format.
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
      `buoy: Jev (${judged.model || 'cached'}) judged ${judged.requests} passages, ${judged.cached} claims from cache, ${judged.inputTokens} tokens ≈ $${cost}`,
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
