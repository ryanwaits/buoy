/**
 * What Jev gets to read: one passage and one spec record. TypeSafe's guidance
 * is to send only the context a question needs, so nothing else goes in. But
 * what does go in has to be exact: a record that says `options: unknown` cannot
 * contradict anything.
 */

/** The slice of an OpenPkg export that a docs claim can be checked against. */
/** `default` is the literal, or the source text of the expression: `50`, `{} as T`. */
type Parameter = {
  name: string;
  type: string;
  required: boolean;
  rest?: true;
  default?: string;
  description?: string;
};

export type SpecRecord = {
  name: string;
  kind: string;
  signature?: string;
  /** Every call signature, when there is more than one. A call that fits any of them is correct. */
  overloads?: string[];
  description?: string;
  parameters?: Parameter[];
  /** A React component's props, in place of `parameters`: they are named, not positional */
  props?: Parameter[];
  returns?: string;
  /** Public members of a class or interface, as signatures */
  members?: string[];
  /** Names of the members past the first 24, so a long class does not read as missing them */
  otherMembers?: string[];
  /** Shapes of the named types the signature refers to, one level deep */
  types?: Record<string, string>;
  deprecated?: boolean;
  replacement?: string;
};

type Schema = {
  default?: unknown;
  type?: string | string[];
  $ref?: string;
  'x-ts-type'?: string;
  'x-ts-readonly'?: boolean;
  'x-ts-function'?: boolean;
  'x-ts-signatures'?: Signature[];
  'x-ts-type-arguments'?: Schema[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  required?: string[];
  items?: Schema;
  prefixItems?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
};
type SigParam = {
  name: string;
  schema?: Schema;
  required?: boolean;
  rest?: boolean;
  default?: unknown;
  /** OpenPkg 0.55: the source destructures this one object parameter; its keys are what a caller writes. */
  'x-ts-destructured'?: boolean;
};
type Signature = {
  parameters?: SigParam[];
  returns?: { schema?: Schema };
  /** Set by `unpacked`: the parameters are the keys of one destructured object. */
  braces?: boolean;
  /** Set by `unpacked`: the caller must pass every key of one of these lists. */
  oneOf?: string[][];
};
type Member = {
  name: string;
  kind?: string;
  signatures?: Signature[];
  schema?: Schema;
  flags?: Record<string, boolean>;
};
type Tag = { name: string; text?: string; param?: { name: string; description?: string } };
export type OpenPkgExport = {
  name: string;
  kind: string;
  description?: string;
  deprecated?: boolean;
  tags?: Tag[];
  signatures?: Signature[];
  members?: Member[];
  typeParameters?: { name: string }[];
  /** What a default export is called in source: `useSWR` for `export default useSWR` */
  localName?: string;
  /** The base class, or an interface's bases: `AbstractCrdt`, `Base<string>, Other` */
  extends?: string | null;
  schema?: Schema;
  source?: { file?: string; line?: number } | null;
};
export type OpenPkgType = {
  id?: string;
  name: string;
  schema?: Schema;
  members?: Member[];
  extends?: string | null;
  /** An opaque stub for a type from outside the package: a name and nothing else. */
  external?: boolean;
  source?: { file?: string; line?: number } | null;
};
export type OpenPkgSpec = {
  exports: OpenPkgExport[];
  types?: OpenPkgType[];
};

const refName = (ref: string): string => ref.split('/').pop() ?? ref;

/** A schema as the TypeScript a reader would recognise. `seen` collects the named types it mentions. */
export function renderType(schema: Schema | undefined, seen: Set<string>, depth = 0): string {
  if (!schema) return 'unknown';
  // `Map<string, CursorData>`, not `Map`: the arguments are usually the part the docs get wrong.
  const args = schema['x-ts-type-arguments']?.length
    ? `<${schema['x-ts-type-arguments'].map((a) => renderType(a, seen, depth + 1)).join(', ')}>`
    : '';
  if (schema.$ref) {
    seen.add(refName(schema.$ref));
    return refName(schema.$ref) + args;
  }
  if (schema['x-ts-function'] && schema['x-ts-signatures']?.[0]) {
    const s = schema['x-ts-signatures'][0];
    const params = (s.parameters ?? []).map(
      (p) =>
        `${p.rest ? '...' : ''}${p.name}${p.required === false && !p.rest ? '?' : ''}: ${renderType(p.schema, seen, depth + 1)}`,
    );
    return `(${params.join(', ')}) => ${renderType(s.returns?.schema, seen, depth + 1)}`;
  }
  if (schema['x-ts-type'])
    return schema['x-ts-type'].includes('<') ? schema['x-ts-type'] : schema['x-ts-type'] + args;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  const union = schema.anyOf ?? schema.oneOf;
  // `anyOf: [{ required: ['prompt'] }, { required: ['messages'] }]` beside `properties` says
  // which keys a caller must pick between; it is not a union of types.
  if (union && !(schema.properties && union.every((s) => s.required && !s.properties && !s.$ref)))
    return union.map((s) => renderType(s, seen, depth + 1)).join(' | ');
  if (schema.allOf) return schema.allOf.map((s) => renderType(s, seen, depth + 1)).join(' & ');
  if (schema.prefixItems)
    return `[${schema.prefixItems.map((s) => renderType(s, seen, depth + 1)).join(', ')}]`;
  if (schema.type === 'array')
    return `${schema['x-ts-readonly'] ? 'readonly ' : ''}${renderType(schema.items, seen, depth + 1)}[]`;
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties);
    if (depth > 1 || !props.length) return 'object';
    const required = new Set(schema.required ?? []);
    const fields = props.map(
      ([k, v]) => `${k}${required.has(k) ? '' : '?'}: ${renderType(v, seen, depth + 1)}`,
    );
    // An index signature means any key is allowed: zod's `GlobalMeta` takes `examples`, `id`, anything.
    if (schema.additionalProperties) fields.push('[key: string]: unknown');
    return `{ ${fields.join('; ')} }`;
  }
  // An empty schema is the extractor giving up, not a type.
  return Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'unknown');
}

/** A type the extractor could not resolve says nothing, and must not read as a claim. */
const known = (type: string | undefined): string | undefined =>
  type === undefined || type === 'unknown' || type === 'any' ? undefined : type;

/** Components take props by name, and their JSX children are the `children` prop. */
const isComponent = (entry: OpenPkgExport, returns: string | undefined): boolean =>
  entry.kind === 'function' &&
  /^[A-Z]/.test(entry.localName ?? entry.name) &&
  /ReactNode|Element|JSX/.test(returns ?? '');

/** The properties a schema has, following one `$ref` to a named type when it points at one. */
function propertiesOf(
  schema: Schema | undefined,
  spec: OpenPkgSpec,
): { properties: Record<string, Schema>; required: Set<string>; oneOf?: string[][] } | null {
  if (!schema) return null;
  if (schema.properties) {
    const arms = (schema.anyOf ?? schema.oneOf)?.filter(
      (s) => s.required && !s.properties && !s.$ref,
    );
    const oneOf = arms?.length ? arms.map((s) => s.required as string[]) : undefined;
    return {
      properties: schema.properties,
      required: new Set(schema.required ?? []),
      ...(oneOf ? { oneOf } : {}),
    };
  }
  if (schema.$ref) {
    const name = refName(schema.$ref);
    const named =
      spec.types?.find((t) => t.id === name || t.name === name) ??
      spec.exports.find((e) => e.name === name);
    if (named?.schema?.properties)
      return {
        properties: named.schema.properties,
        required: new Set(named.schema.required ?? []),
      };
    if (named?.members?.length)
      return {
        properties: Object.fromEntries(named.members.map((m) => [m.name, m.schema ?? {}])),
        required: new Set(named.members.filter((m) => !m.flags?.optional).map((m) => m.name)),
      };
  }
  const parts = schema.allOf ?? [];
  if (parts.length) {
    const merged: Record<string, Schema> = {};
    const required = new Set<string>();
    for (const part of parts) {
      const found = propertiesOf(part, spec);
      if (!found) continue;
      Object.assign(merged, found.properties);
      for (const r of found.required) required.add(r);
    }
    if (Object.keys(merged).length) return { properties: merged, required };
  }
  return null;
}

/**
 * A signature as a caller sees it. A destructured object parameter is spelled as its
 * keys, which is what the docs write and what a reader checks: `embed({ model, value })`,
 * `<RoomProvider roomId userId>`. A destructured parameter whose keys the spec cannot
 * name stays as it is: nothing to check.
 */
export function unpacked(signature: Signature, spec: OpenPkgSpec): Signature {
  const only = signature.parameters?.length === 1 ? signature.parameters[0] : undefined;
  if (!only?.['x-ts-destructured']) return signature;
  const found = propertiesOf(only.schema, spec);
  if (!found) return signature;
  const parameters: SigParam[] = Object.entries(found.properties).map(([name, schema]) => ({
    name,
    schema,
    required: found.required.has(name),
    ...(schema.default === undefined ? {} : { default: schema.default }),
  }));
  return { ...signature, parameters, braces: true, ...(found.oneOf ? { oneOf: found.oneOf } : {}) };
}

function signatureOf(
  name: string,
  signature: Signature | undefined,
  seen: Set<string>,
  typeParameters: { name: string }[] = [],
): string | undefined {
  if (!signature) return undefined;
  // `create<TPresence, TStorage>()` takes no arguments; without these a reader counts two.
  const generics = typeParameters.length ? `<${typeParameters.map((t) => t.name).join(', ')}>` : '';
  const params = (signature.parameters ?? []).map(
    (p) =>
      `${p.rest ? '...' : ''}${p.name}${p.required === false && !p.rest ? '?' : ''}: ${renderType(p.schema, seen)}`,
  );
  const returns = known(signature.returns ? renderType(signature.returns.schema, seen) : undefined);
  const list = signature.braces ? `{ ${params.join(', ')} }` : params.join(', ');
  const oneOf = signature.oneOf?.length
    ? ` /* one of: ${signature.oneOf.map((arm) => arm.join(' + ')).join(' | ')} */`
    : '';
  return `${name}${generics}(${list}${oneOf})${returns ? `: ${returns}` : ''}`;
}

const isPublic = (m: Member): boolean =>
  !m.name.startsWith('_') && !m.name.startsWith('#') && !m.flags?.private;

/**
 * The record for an export, or for one of its members. Named types the
 * signature mentions are spelled out once, so `options: JoinRoomOptions` is
 * something a passage can actually agree or disagree with.
 */
/** The name docs use: a default export goes by its local name (`useSWR`), not `default`. */
export const displayName = (entry: OpenPkgExport): string =>
  entry.name === 'default' && entry.localName ? entry.localName : entry.name;

/** How many members get a full signature. The rest are listed by name, so none reads as missing. */
const MEMBERS_SHOWN = 24;

export function specRecord(
  spec: OpenPkgSpec,
  entry: OpenPkgExport,
  member?: string,
  passage = '',
): SpecRecord {
  const seen = new Set<string>();
  const target = member ? entry.members?.find((m) => m.name === member) : undefined;
  const called = displayName(entry);
  const name = target ? `${called}.${target.name}` : called;
  const signature = (target ?? entry).signatures?.[0]
    ? unpacked((target ?? entry).signatures?.[0] as Signature, spec)
    : undefined;
  const docs = new Map(
    (entry.tags ?? []).flatMap((t) => (t.param ? [[t.param.name, t.param.description]] : [])),
  );
  const parameters = signature?.parameters?.map((p) => ({
    name: p.name,
    type: renderType(p.schema, seen),
    required: p.required !== false && !p.rest,
    ...(p.rest ? { rest: true as const } : {}),
    ...(p.default === undefined
      ? {}
      : { default: typeof p.default === 'string' ? p.default : JSON.stringify(p.default) }),
    ...(!target && docs.get(p.name) ? { description: docs.get(p.name) } : {}),
  }));
  // zod's `ZodString` has 95 members. The ones the passage names come first, so the member it
  // is about is never the one that got cut; the rest are still listed, by name.
  const named = (m: Member): boolean =>
    new RegExp(`\\b${m.name.replace(/\$/g, '\\$')}\\b`).test(passage);
  const publicMembers = target ? [] : (entry.members ?? []).filter(isPublic);
  const ordered = [...publicMembers.filter(named), ...publicMembers.filter((m) => !named(m))];
  const members = target
    ? undefined
    : ordered
        .slice(0, MEMBERS_SHOWN)
        .map(
          (m) =>
            signatureOf(m.name, m.signatures?.[0], seen) ??
            `${m.name}${m.flags?.optional ? '?' : ''}: ${renderType(m.schema, seen)}`,
        );
  const otherMembers = ordered.slice(MEMBERS_SHOWN).map((m) => m.name);
  const returns = known(
    signature?.returns ? renderType(signature.returns.schema, seen) : undefined,
  );
  const component = !target && isComponent(entry, returns);
  const rendered = component
    ? `<${called} ${(parameters ?? []).map((p) => `${p.name}${p.required ? '' : '?'}`).join(' ')} />`
    : signatureOf(
        target ? target.name : called,
        signature,
        seen,
        target ? [] : entry.typeParameters,
      );

  // Docs written against the second overload are not wrong about the first. Rendered before
  // `types`, so the option types only a later overload mentions get spelled out too.
  const all = ((target ?? entry).signatures ?? []).map((sig) => unpacked(sig as Signature, spec));
  const overloads =
    all.length > 1 && !component
      ? [
          // A hook like SWR's `useSWR` has 12, and the form docs teach may be the 9th. Without generics several
          // read the same, so they are shown once.
          ...new Set(
            all
              .slice(0, 16)
              .flatMap(
                (sig) =>
                  signatureOf(
                    target ? target.name : called,
                    sig,
                    seen,
                    target ? [] : entry.typeParameters,
                  ) ?? [],
              ),
          ),
        ]
      : undefined;
  const types: Record<string, string> = {};
  for (const typeName of [...seen].slice(0, 6)) {
    // OpenPkg gives same-named types their own ids (`react.Options`); a ref names the id.
    const named = spec.types?.filter((t) => t.name === typeName) ?? [];
    const schema = (
      spec.types?.find((t) => t.id === typeName) ?? (named.length === 1 ? named[0] : undefined)
    )?.schema;
    const shape = schema ? renderType(schema, new Set(), 0) : undefined;
    if (shape && shape !== typeName && shape !== 'object' && shape.length <= 600)
      types[typeName] = shape;
  }
  // A deprecation note can run to paragraphs; the replacement is in its first sentence.
  const deprecation = entry.tags
    ?.find((t) => t.name === 'deprecated')
    ?.text?.split(/(?<=[.!?])\s|\n/)[0]
    ?.trim();
  return {
    name,
    kind: component ? 'React component' : (target?.kind ?? entry.kind),
    ...(overloads ? { overloads } : rendered ? { signature: rendered } : {}),
    ...(!target && entry.description ? { description: entry.description } : {}),
    ...(parameters?.length && !overloads
      ? component
        ? { props: parameters }
        : { parameters }
      : {}),
    ...(returns && !component ? { returns } : {}),
    ...(members?.length ? { members } : {}),
    ...(otherMembers.length ? { otherMembers } : {}),
    ...(Object.keys(types).length ? { types } : {}),
    ...(entry.deprecated || deprecation !== undefined ? { deprecated: true } : {}),
    ...(deprecation ? { replacement: deprecation } : {}),
  };
}

/**
 * Does the passage call, construct or render this export (or, for a member, call
 * it on something)? A text check on purpose: it decides which questions are
 * worth asking, and code is the place for what code can tell.
 *
 * In prose, a backticked `useSelf()` with empty parentheses, or `<RoomProvider>`
 * with no props, is how docs spell a name, not a use. And `LiveMap<LiveObject>`
 * is a type argument, not an element.
 *
 * An opening tag on its own, `<LivelyProvider client={client}>` in a sentence, is a
 * `fragment`: it cannot be said to leave a prop out.
 */
export type Use = 'whole' | 'fragment';

/** A line that stands for what a sample leaves out. */
const ELISION_LINE =
  /^\s*(?:\/\/\s*(?:\.{3}|…)|\/\*\s*(?:\.{3}|…)[^*]*\*\/|(?:\.{3}|…)(?![\w$]))\s*[^\n]*$/;

/**
 * Calls whose object-literal argument elides at its own level, `f({ // ...\n b })` or
 * `new X({ ... })`, are fragments: they show where a call goes, not the call. Each such call
 * is blanked so the use check does not read it as whole. Elision inside a nested literal
 * (`tools: { /~ ... ~/ }`, with a block comment) leaves the outer call whole.
 */
export function withoutElidedCalls(text: string): string {
  let out = text;
  const re = /[\w$.]+\s*\(\s*\{/g;
  for (const m of text.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    // The literal's own lines: nested braces are collapsed so their contents are not read.
    let inner = '';
    depth = 0;
    for (let i = open + 1; i < end; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      if (depth === 0) inner += ch;
      if (ch === '}') depth--;
    }
    // A bare `...` between keys (`{ model, ... }`) elides too; a spread `...rest` does not.
    const bare = /(^|[,{\s])(?:\.{3}|…)(?=\s*(?:[,}]|$))/m.test(inner);
    if (bare || inner.split('\n').some((line) => ELISION_LINE.test(line)))
      out = out.replace(text.slice(m.index, end + 1), ' '.repeat(end + 1 - m.index));
  }
  return out;
}

export function showsUse(passage: string, name: string, inCode = true): Use | null {
  const last = (name.split('.').pop() ?? name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const callee = name.includes('.') ? `\\.${last}` : `(?<![\\w.])(?:new\\s+)?${last}`;
  const mentions = /(?<!`)`(?:[\w.$]+\(\)|<\/?[\w.$]+\s*\/?>)`(?!`)/g;
  // In prose, `generateImage()` with nothing inside is how docs name a function: a card title,
  // a list entry. It shows no call to check. In code it is the call, arguments and all.
  const named = /(?<![\w.$`])[\w.$]+\(\)(?!`)/g;
  // `useMutation(/* ... */)` elides its arguments: it shows that a call goes here, not the call.
  const elided = /\(\s*(?:\/\*[^*]*\*\/|\/\/[^\n]*\n|\.{3}|…)\s*\)/g;
  const text = withoutElidedCalls(
    (inCode ? passage : passage.replace(named, '')).replace(mentions, '').replace(elided, ''),
  );
  const has = (pattern: string): boolean => new RegExp(pattern).test(text);
  if (has(`${callee}\\s*(?:<[^>()]*>)?\\s*\\(`)) return 'whole';
  if (!has(`(?<!\\w)<${last}[\\s/>]`)) return null;
  return has(`</${last}>|(?<!\\w)<${last}(?:\\s[^<>]*)?/>`) ? 'whole' : 'fragment';
}

/** A named type, by `id` first (OpenPkg gives same-named types their own), then by a unique name. */
function typeNamed(spec: OpenPkgSpec, name: string): OpenPkgType | undefined {
  const named = spec.types?.filter((t) => t.name === name) ?? [];
  return spec.types?.find((t) => t.id === name) ?? (named.length === 1 ? named[0] : undefined);
}

/** Split on commas that are not inside brackets: `Base<A, B>, Other` is two. */
function splitTop(text: string, separators: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('{([<'.includes(c)) depth++;
    else if ('})]'.includes(c) || (c === '>' && text[i - 1] !== '='))
      depth = Math.max(0, depth - 1);
    else if (depth === 0 && separators.includes(c)) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return [...parts, text.slice(from)];
}

/**
 * Every member name of an export, inherited ones included, or null when the type is open: an
 * index signature, a union, a base or an intersection part the spec does not have. An open type
 * can have any member, so nothing can be said to be missing from it.
 */
function memberNames(
  spec: OpenPkgSpec,
  entry: Pick<OpenPkgExport, 'name' | 'members' | 'schema' | 'extends'>,
  visited = new Set<unknown>(),
): Set<string> | null {
  if (visited.size > 16) return null;
  visited.add(entry);
  const names = new Set<string>();
  for (const m of entry.members ?? []) {
    if (m.name.startsWith('[')) return null;
    names.add(m.name);
  }
  const merge = (other: Set<string> | null): boolean => {
    for (const name of other ?? []) names.add(name);
    return other !== null;
  };
  const resolve = (name: string): Set<string> | null => {
    const found = spec.exports.find((e) => e.name === name) ?? typeNamed(spec, name);
    if (!found || ('external' in found && found.external)) return null;
    return visited.has(found) ? new Set() : memberNames(spec, found, visited);
  };
  const fromSchema = (schema: Schema | undefined): boolean => {
    if (!schema) return true;
    const arms = schema.anyOf ?? schema.oneOf;
    const constraint = arms?.every((s) => s.required && !s.properties && !s.$ref) ?? false;
    if (schema.additionalProperties || (arms && !constraint)) return false;
    for (const key of Object.keys(schema.properties ?? {})) names.add(key);
    if (schema.$ref && !merge(resolve(refName(schema.$ref)))) return false;
    return (schema.allOf ?? []).every(fromSchema);
  };
  if (!fromSchema(entry.schema)) return null;
  for (const base of entry.extends ? splitTop(entry.extends, ',') : []) {
    if (!merge(resolve(base.replace(/<.*$/s, '').trim()))) return null;
  }
  return names;
}

/** Code with its strings and comments blanked out, same length: `"./liveObject.js"` is not a read. */
function bareCode(code: string): string {
  let out = '';
  let i = 0;
  const blank = (to: number): void => {
    out += code.slice(i, to).replace(/[^\n]/g, ' ');
    i = to;
  };
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      blank(end < 0 ? code.length : end);
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      blank(end < 0 ? code.length : end + 2);
    } else if (c === '"' || c === "'" || c === '`') {
      let end = i + 1;
      while (end < code.length && code[end] !== c && (c === '`' || code[end] !== '\n'))
        end += code[end] === '\\' ? 2 : 1;
      blank(Math.min(end + 1, code.length));
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** On every object, so never evidence of a missing member. */
const ON_ANY_OBJECT = new Set(
  'constructor prototype then catch finally toString toLocaleString toJSON valueOf hasOwnProperty call apply bind'.split(
    ' ',
  ),
);
/** On arrays, strings and functions. Kept only where the code itself binds the receiver to the export. */
const ON_BUILTINS = new Set(
  'length name size map filter forEach reduce find some every includes indexOf join slice concat push pop keys values entries has'.split(
    ' ',
  ),
);
const NEGATED =
  /\b(?:no|not|never|without|lacks?|removed|gone|deprecated|renamed|instead|longer|missing|neither|nor)\b|n't\b/i;
const IDENT = '[A-Za-z_$][\\w$]*';

/**
 * The identifiers a passage uses as members of this export that the export does not have. It is
 * what lets a `members` finding say "`delete` is not a method of LiveObject" and point at the word.
 *
 * Code works this out, never the model, and only where the text leaves no doubt:
 * - code that reads `.name` off the export, off `new Export()`, or off a variable bound to it
 * - a backticked `name(...)` that opens a line, a backticked `.name`, or `name` beside the
 *   word "method", "property" or "field"
 * - for an interface or a type, the keys of a shape written right after its name
 * A sentence that says the member is NOT there is left alone, and so is an open type.
 */
/** The public members a record has, in declaration order. Empty when the type is open. */
export function knownMembers(spec: OpenPkgSpec, entry: OpenPkgExport): string[] {
  return [...(memberNames(spec, entry) ?? [])].filter((n) => !/^[_#]|^constructor$/.test(n));
}

export function unknownMembers(passage: string, spec: OpenPkgSpec, entry: OpenPkgExport): string[] {
  const shaped = entry.kind === 'interface' || entry.kind === 'type';
  if (!shaped && entry.kind !== 'class') return [];
  const members = memberNames(spec, entry);
  if (!members?.size) return [];
  const own = displayName(entry);
  const taken = new Set([
    own,
    entry.name,
    ...(entry.typeParameters ?? []).map((t) => t.name),
    ...spec.exports.map(displayName),
    ...(spec.types ?? []).map((t) => t.name),
  ]);
  const found: [number, string][] = [];
  const take = (at: number, name: string, bound = false): void => {
    if (members.has(name) || taken.has(name) || ON_ANY_OBJECT.has(name)) return;
    if (!bound && ON_BUILTINS.has(name)) return;
    found.push([at, name]);
  };
  const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Fences are code; everything else is prose, where code lives in spans.
  let offset = 0;
  let fenced = false;
  const code: string[] = [];
  const prose: [number, string][] = [];
  for (const line of passage.split('\n')) {
    const mark = line.trimStart().startsWith('```');
    const isCode = fenced && !mark;
    // Same length as the passage, so a match's index is its place in the passage.
    code.push(isCode ? line : ' '.repeat(line.length));
    if (!isCode && !mark) prose.push([offset, line]);
    if (mark) fenced = !fenced;
    offset += line.length + 1;
  }

  // 1. Reads off a receiver. In prose only inside a span, and not where the sentence negates it.
  const reads: [number, string][] = [[0, bareCode(code.join('\n'))]];
  for (const [at, line] of prose) {
    for (const sentence of line.matchAll(/[^.!?]+(?:[.!?](?!\s)[^.!?]*)*[.!?]?/g)) {
      if (NEGATED.test(sentence[0])) continue;
      for (const span of sentence[0].matchAll(/`([^`\n]+)`/g))
        reads.push([at + sentence.index + span.index + 1, span[1]]);
    }
  }
  const all = reads.map(([, text]) => text).join('\n');
  const bound = new Set<string>();
  const binders = [
    `(?:const|let|var)\\s+(${IDENT})\\s*(?::[^=\\n]*)?=\\s*(?:await\\s+)?new\\s+${escaped}\\b`,
    `(${IDENT})\\s*\\??\\s*:\\s*${escaped}\\b(?:<[^<>\\n]*>)?(?!\\s*(?:[.\\[&]|\\|\\s*(?!null\\b|undefined\\b)))`,
  ];
  for (const binder of binders)
    for (const m of all.matchAll(new RegExp(binder, 'g'))) bound.add(m[1]);
  const guessed = own[0].toLowerCase() + own.slice(1);
  const receivers = [...bound, ...(guessed === own ? [] : [guessed]), ...(shaped ? [] : [own])];
  for (const [at, text] of reads) {
    for (const receiver of receivers) {
      const r = receiver.replace(/\$/g, '\\$');
      const read = new RegExp(`(?<![\\w$.])${r}\\s*[?!]?\\.\\s*(${IDENT})`, 'g');
      for (const m of text.matchAll(read))
        take(at + m.index + m[0].length - m[1].length, m[1], bound.has(receiver));
    }
    // `new LiveObject({}).destroy()`: the receiver is the construction itself.
    for (const m of text.matchAll(
      new RegExp(`\\bnew\\s+${escaped}\\s*(?:<[^<>()]*>)?\\s*\\(`, 'g'),
    )) {
      let i = m.index + m[0].length;
      for (let depth = 1; i < text.length && depth > 0; i++)
        depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
      const after = new RegExp(`^\\s*\\.\\s*(${IDENT})`).exec(text.slice(i));
      if (after) take(at + i + after[0].length - after[1].length, after[1], true);
    }
  }

  // 2. Members named in prose.
  const span = `\`(\\.?)(${IDENT})(\\([^\`\\n]*\\))?\``;
  const noun = '(?:methods?|propert(?:y|ies)|fields?|accessors?|getters?)';
  for (const [at, line] of prose) {
    const opener = new RegExp(`^\\s*(?:[-*+]\\s+|\\d+\\.\\s+|#{1,6}\\s+|\\|\\s*)?${span}`).exec(
      line,
    );
    for (const sentence of line.matchAll(/[^.!?]+(?:[.!?](?!\s)[^.!?]*)*[.!?]?/g)) {
      if (NEGATED.test(sentence[0])) continue;
      const text = sentence[0];
      for (const m of text.matchAll(new RegExp(span, 'g'))) {
        const [whole, dot, name, call] = m;
        const before = text.slice(0, m.index);
        const after = text.slice(m.index + whole.length);
        const opens =
          sentence.index === 0 &&
          opener?.[2] === name &&
          before.trim() === opener[0].slice(0, -whole.length).trim();
        const called =
          new RegExp(`^\\s+${noun}\\b`, 'i').test(after) ||
          new RegExp(`\\b${noun}\\s+$`, 'i').test(before);
        // A bare name that opens a line is a field of an interface, but on a class it may as well
        // be an option or an argument.
        if (dot || called || (opens && (call || shaped)))
          take(at + sentence.index + m.index + 1 + dot.length, name);
      }
    }
  }

  // 3. A shape written out right after the name: `PresenceUser` — { userId, joinedAt? }.
  if (shaped) {
    const named = new RegExp(
      `(?<![\\w$.])${escaped}\`?(?:<[^<>\\n]*>)?([^{}\`\\n.;()<>]{0,40})\\{`,
      'g',
    );
    for (const m of passage.matchAll(named)) {
      const open = m.index + m[0].length;
      let close = open;
      for (let depth = 1; close < passage.length && depth > 0; close++)
        depth += passage[close] === '{' ? 1 : passage[close] === '}' ? -1 : 0;
      let at = open;
      for (const field of splitTop(passage.slice(open, close - 1), ',;\n')) {
        const key = new RegExp(`^(\\s*(?:readonly\\s+)?)(${IDENT})\\??\\s*(?::|$)`).exec(field);
        if (key) take(at + key[1].length, key[2]);
        at += field.length + 1;
      }
    }
  }

  const ordered = found.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
  return [...new Set(ordered)].slice(0, 3);
}

/**
 * `showsUse`, but only where the record can be checked against a call. immer's
 * `setAutoFreeze` is a bound method: the spec has its name and description and no
 * signature, so "passes an option the record does not define" has nothing to stand on.
 */
export function checkableUse(passage: string, record: SpecRecord, inCode = true): Use | null {
  const shaped = record.signature ?? record.overloads ?? record.parameters ?? record.props;
  return shaped ? showsUse(passage, record.name, inCode) : null;
}

/**
 * The block of markdown around a 1-indexed line: its paragraph or fence. A
 * fence also brings the paragraph that introduces it, which is usually where
 * the docs say what the code is for. A heading brings the section it opens.
 */
/** Whether `line` (1-based) sits inside a fenced code block. */
export function inFenceAt(markdown: string, line: number): boolean {
  let open = false;
  const lines = markdown.split('\n');
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    if (lines[i].trimStart().startsWith('```')) open = !open;
  }
  return open;
}

export function passageAt(markdown: string, line: number): string {
  const lines = markdown.split('\n');
  const fences: [number, number][] = [];
  for (let i = 0, open = -1; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('```')) continue;
    if (open < 0) open = i;
    else {
      fences.push([open, i]);
      open = -1;
    }
  }
  const at = line - 1;
  // A heading says nothing on its own: judge it with the section it opens.
  if (/^#{1,6}\s/.test(lines[at] ?? '') && !fences.some(([a, b]) => at > a && at < b)) {
    let end = at + 1;
    let size = 0;
    while (end < lines.length && size < 1500) {
      const inFence = fences.some(([a, b]) => end > a && end <= b);
      if (!inFence && /^#{1,6}\s/.test(lines[end])) break;
      size += lines[end].length;
      end++;
    }
    // Never stop inside a fence.
    const open = fences.find(([a, b]) => end > a && end <= b);
    if (open) end = open[1] + 1;
    return lines.slice(at, end).join('\n').trimEnd();
  }
  const fence = fences.find(([a, b]) => at >= a && at <= b);
  // A table row is its own claim: its header plus the row, not the rows about other exports.
  const isRow = (i: number): boolean => (lines[i] ?? '').trimStart().startsWith('|');
  if (!fence && isRow(at)) {
    let top = at;
    while (isRow(top - 1)) top--;
    const header = lines.slice(top, Math.min(top + 2, at));
    return [...header, lines[at]].join('\n');
  }
  const blank = (i: number): boolean => i < 0 || i >= lines.length || lines[i].trim() === '';
  const paragraph = (from: number): [number, number] => {
    let a = from;
    let b = from;
    while (!blank(a - 1) && !fences.some(([, end]) => end === a - 1)) a--;
    while (!blank(b + 1) && !fences.some(([start]) => start === b + 1)) b++;
    return [a, b];
  };
  if (!fence) {
    const [a, b] = paragraph(at);
    return lines.slice(a, b + 1).join('\n');
  }
  let lead = fence[0] - 1;
  while (lead >= 0 && blank(lead)) lead--;
  const intro = lead >= 0 && !lines[lead].startsWith('#') ? paragraph(lead) : null;
  const head =
    intro && !fences.some(([, end]) => end === lead) ? lines.slice(intro[0], intro[1] + 1) : [];
  return [...head, ...(head.length ? [''] : []), ...lines.slice(fence[0], fence[1] + 1)].join('\n');
}
