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

/** Every key a named type has, from its members or its schema, bases included; none when it is open. */
function keyNames(spec: OpenPkgSpec, type: OpenPkgType): string[] {
  const names = memberNames(spec, type);
  const all = names?.size
    ? [...names]
    : Object.keys(propertiesOf(type.schema, spec)?.properties ?? {});
  return all.filter((n) => !/^[_#~]/.test(n));
}

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
  // The types a reader meets first come first: what the signature names directly (a parameter's
  // type, the return type) before anything nested inside them.
  const direct = new Set<string>();
  for (const p of signature?.parameters ?? [])
    if (p.schema?.$ref) direct.add(refName(p.schema.$ref));
  if (signature?.returns?.schema?.$ref) direct.add(refName(signature.returns.schema.$ref));
  const typeOrder = [...direct]
    .filter((n) => seen.has(n))
    .concat([...seen].filter((n) => !direct.has(n)));
  const types: Record<string, string> = {};
  for (const typeName of typeOrder.slice(0, 8)) {
    // OpenPkg gives same-named types their own ids (`react.Options`); a ref names the id.
    const named = spec.types?.filter((t) => t.name === typeName) ?? [];
    const found =
      spec.types?.find((t) => t.id === typeName) ?? (named.length === 1 ? named[0] : undefined);
    const schema = found?.schema;
    const shape = schema ? renderType(schema, new Set(), 0) : undefined;
    if (shape && shape !== typeName && shape !== 'object' && shape.length <= 600) {
      types[typeName] = shape;
      continue;
    }
    // A settings type with forty keys does not fit, but its key names do: without them Jev
    // reads `toolApproval` in a passage and finds it nowhere (`ToolLoopAgentSettings`).
    const keys = found ? keyNames(spec, found) : [];
    if (keys.length)
      types[typeName] =
        `{ keys: ${keys.slice(0, 40).join(', ')}${keys.length > 40 ? `, … ${keys.length - 40} more` : ''} }`;
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

/** A named type, by `id` first, then by a unique name. */
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
 * Every member name of an export, inherited ones included, or null when the type is open.
 * An open type can have any member, so a missing name cannot be asserted.
 */
function memberNames(
  spec: OpenPkgSpec,
  entry: Pick<OpenPkgExport, 'name' | 'members' | 'schema' | 'extends'>,
  visited = new Set<unknown>(),
): Set<string> | null {
  if (visited.size > 16) return null;
  visited.add(entry);
  const names = new Set<string>();
  for (const member of entry.members ?? []) {
    if (member.name.startsWith('[')) return null;
    names.add(member.name);
  }
  const merge = (other: Set<string> | null): boolean => {
    for (const name of other ?? []) names.add(name);
    return other !== null;
  };
  const resolve = (name: string): Set<string> | null => {
    const found = spec.exports.find((item) => item.name === name) ?? typeNamed(spec, name);
    if (!found || ('external' in found && found.external)) return null;
    return visited.has(found) ? new Set() : memberNames(spec, found, visited);
  };
  const fromSchema = (schema: Schema | undefined): boolean => {
    if (!schema) return true;
    const arms = schema.anyOf ?? schema.oneOf;
    const constraint = arms?.every((arm) => arm.required && !arm.properties && !arm.$ref) ?? false;
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
