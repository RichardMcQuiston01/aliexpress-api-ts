/**
 * Generates src/generated/* from the AliExpress IOP Java SDK sources.
 *
 *   npm run generate -- --src <dir>/com/aliexpress/open [--out src/generated]
 *
 * `--src` must contain the `request/`, `response/` and `domain/` folders of the
 * extracted `*-source.jar`. Output is deterministic, so regenerating from the
 * same SDK version produces no diff.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import * as prettier from 'prettier';
import {
  parseSdk,
  type DomainClass,
  type JavaField,
  type JavaType,
  type RequestClass,
  type ResponseClass,
} from './parse-java.ts';

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const RESERVED_NAMESPACES = new Set([
  'call',
  'config',
  'baseUrl',
  'fetchImpl',
  'prepare',
  'interpret',
  'notify',
  'constructor',
  'bindNamespaces',
  'getAuthorizationUrl',
]);

function pascalWords(name: string): string[] {
  return name.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [name];
}

/** `AliexpressSolutionFooBar` -> `solution`; `AiImageFoo` -> `ai`. */
function namespaceOfClass(className: string): string {
  const words = pascalWords(className);
  const word =
    words[0] === 'Aliexpress' && words.length > 1 ? words[1] : words[0];
  return word.toLowerCase();
}

function apiSegments(apiName: string): string[] {
  return apiName
    .replace(/^\//, '')
    .split(/[./]/)
    .filter((segment) => segment.length > 0);
}

function camel(segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split(/[^A-Za-z0-9]+/).filter(Boolean))
    .map((part, index) =>
      index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('');
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function safeNamespace(ns: string): string {
  const cleaned = ns.replace(/[^a-z0-9]/g, '');
  const prefixed = /^[0-9]/.test(cleaned) ? `n${cleaned}` : cleaned;
  return RESERVED_NAMESPACES.has(prefixed) ? `${prefixed}Api` : prefixed;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

type Code = 's' | 'i' | 'n' | 'l' | 'b' | 'o' | 'x' | 'f';

interface Mapped {
  readonly ts: string;
  readonly code: string;
  /** Domain class referenced by this type, if any (for imports / thunks). */
  readonly domain?: string;
}

const SCALARS: Record<string, { ts: string; requestTs?: string; code: Code }> =
  {
    String: { ts: 'string', code: 's' },
    Long: { ts: 'Long', requestTs: 'LongInput', code: 'l' },
    Integer: { ts: 'number', code: 'i' },
    Short: { ts: 'number', code: 'i' },
    Byte: { ts: 'number', code: 'i' },
    Double: { ts: 'number', code: 'n' },
    Float: { ts: 'number', code: 'n' },
    BigDecimal: { ts: 'number', code: 'n' },
    Boolean: { ts: 'boolean', code: 'b' },
    Object: { ts: 'unknown', code: 'x' },
    FileItem: { ts: 'FileInput', code: 'f' },
  };

function mapType(
  type: JavaType,
  domains: ReadonlyMap<string, DomainClass>,
  topLevelRequest: boolean
): Mapped {
  // The Java SDK declares `FileItem` on a few response/domain fields where no
  // file can ever be returned (e.g. an `isDefault` flag). Only top-level
  // request parameters are real uploads; elsewhere treat the value as opaque.
  if (type.name === 'FileItem' && !topLevelRequest) {
    return { ts: 'unknown', code: 'x' };
  }
  const scalar = SCALARS[type.name];
  if (scalar && type.args.length === 0) {
    return {
      ts: topLevelRequest && scalar.requestTs ? scalar.requestTs : scalar.ts,
      code: scalar.code,
    };
  }
  if (type.name === 'List' && type.args.length === 1) {
    const inner = mapType(type.args[0], domains, topLevelRequest);
    const innerCode = inner.code.startsWith('[') ? 'x' : inner.code;
    return {
      ts: inner.code.startsWith('[') ? 'unknown[]' : `Array<${inner.ts}>`,
      code: `[${innerCode === 'f' ? 'x' : innerCode}`,
      domain: inner.code.startsWith('[') ? undefined : inner.domain,
    };
  }
  if (type.name === 'HashMap' || type.name === 'Map') {
    const value = type.args[1]
      ? mapType(type.args[1], domains, false)
      : { ts: 'unknown', code: 'x' };
    return { ts: `Record<string, ${value.ts}>`, code: 'x' };
  }
  if (domains.has(type.name)) {
    return { ts: type.name, code: 'o', domain: type.name };
  }
  throw new Error(`Unmapped Java type: ${JSON.stringify(type)}`);
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

interface NamespaceFile {
  readonly ns: string;
  readonly body: string[];
  /** Domain classes referenced from this file (for cross-file imports). */
  readonly refs: Set<string>;
  readonly apiEntries: { method: string; constName: string; apiName: string }[];
}

// ---------------------------------------------------------------------------
// Comment translation
// ---------------------------------------------------------------------------

const CJK_PATTERN = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const TRANSLATIONS_PATH = 'scripts/translations/zh-en.json';

/** Chinese comment -> English, loaded once from the committed table. */
const translations: ReadonlyMap<string, string> = new Map(
  existsSync(TRANSLATIONS_PATH)
    ? Object.entries(
        JSON.parse(readFileSync(TRANSLATIONS_PATH, 'utf8')) as Record<
          string,
          string
        >
      )
    : []
);
/** Chinese comments that had no entry in the table (reported at the end). */
const untranslated = new Set<string>();

/**
 * Returns the English text for a field comment. Comments without Chinese
 * pass through. A Chinese comment with no table entry is kept as is and
 * recorded, so a new SDK version never loses text silently.
 */
function localize(doc: string): string {
  if (!CJK_PATTERN.test(doc)) return doc;
  const english = translations.get(doc);
  if (english !== undefined) return english;
  untranslated.add(doc);
  return doc;
}

function docComment(text: string, extra: string[] = []): string {
  const lines = [...(text ? [text] : []), ...extra];
  if (lines.length === 0) return '';
  return `/** ${lines.join(' ')} */\n`;
}

function schemaLiteral(
  entries: { property: string; wire: string; mapped: Mapped }[],
  file: NamespaceFile
): string {
  const rows = entries.map(({ property, wire, mapped }) => {
    const thunk = mapped.domain ? `, () => ${mapped.domain}Schema` : '';
    if (mapped.domain) file.refs.add(mapped.domain);
    return `${JSON.stringify(property)}: [${JSON.stringify(wire)}, ${JSON.stringify(mapped.code)}${thunk}]`;
  });
  return `{\n${rows.join(',\n')}\n}`;
}

function emitInterface(
  name: string,
  fields: JavaField[],
  domains: ReadonlyMap<string, DomainClass>,
  file: NamespaceFile,
  options: { topLevelRequest: boolean; doc?: string }
): { properties: { property: string; wire: string; mapped: Mapped }[] } {
  const properties: { property: string; wire: string; mapped: Mapped }[] = [];
  const lines: string[] = [];
  for (const field of fields) {
    const mapped = mapType(field.type, domains, options.topLevelRequest);
    if (mapped.domain) file.refs.add(mapped.domain);
    properties.push({ property: field.name, wire: field.wire, mapped });
    lines.push(
      `${docComment(localize(field.doc))}${JSON.stringify(field.name)}?: ${mapped.ts};`
    );
  }
  file.body.push(
    `${docComment(options.doc ?? '')}export interface ${name} {\n${lines.join('\n')}\n}\n`
  );
  return { properties };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
  };
  const srcDir = option('--src') ?? process.env.IOP_SDK_SRC;
  if (!srcDir) {
    throw new Error(
      'Missing --src. Point it at the extracted SDK folder containing request/, response/ and domain/ (…/com/aliexpress/open).'
    );
  }
  const outDir = resolve(option('--out') ?? 'src/generated');

  const sdk = parseSdk(resolve(srcDir));
  console.log(
    `Parsed ${sdk.requests.length} requests, ${sdk.responses.size} responses, ${sdk.domains.size} domain types.`
  );

  // -- Assign every type to a namespace file -------------------------------
  const files = new Map<string, NamespaceFile>();
  const fileFor = (ns: string): NamespaceFile => {
    let file = files.get(ns);
    if (!file) {
      file = { ns, body: [], refs: new Set(), apiEntries: [] };
      files.set(ns, file);
    }
    return file;
  };

  const ownerOfDomain = new Map<string, string>();
  for (const name of sdk.domains.keys()) {
    ownerOfDomain.set(name, safeNamespace(namespaceOfClass(name)));
  }

  // Domain types.
  for (const domain of [...sdk.domains.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const file = fileFor(ownerOfDomain.get(domain.name)!);
    const { properties } = emitInterface(
      domain.name,
      domain.fields,
      sdk.domains,
      file,
      {
        topLevelRequest: false,
      }
    );
    file.body.push(
      `export const ${domain.name}Schema: Schema = ${schemaLiteral(properties, file)};\n`
    );
  }

  // Requests / responses / API definitions.
  const methodNames = new Map<string, Set<string>>();
  const usedTypeNames = new Set<string>(sdk.domains.keys());
  const requests = [...sdk.requests].sort((a, b) =>
    a.apiName.localeCompare(b.apiName)
  );
  let renamedForCollision = 0;

  for (const request of requests) {
    const segments = apiSegments(request.apiName);
    const stripped =
      segments[0] === 'aliexpress' && segments.length > 1
        ? segments.slice(1)
        : segments;
    const ns = safeNamespace(
      (stripped.length > 1 ? stripped[0] : 'general').toLowerCase()
    );
    const rest = stripped.length > 1 ? stripped.slice(1) : stripped;
    let method = camel(rest);
    const taken = methodNames.get(ns) ?? new Set<string>();
    if (taken.has(method)) {
      method = camel(segments);
      renamedForCollision++;
    }
    if (taken.has(method)) {
      throw new Error(
        `Unresolvable method name collision: ${ns}.${method} (${request.apiName})`
      );
    }
    taken.add(method);
    methodNames.set(ns, taken);

    const response: ResponseClass | undefined = sdk.responses.get(
      request.responseClass
    );
    if (!response)
      throw new Error(`Missing response class for ${request.stem}`);

    const paramsName = `${request.stem}Params`;
    for (const typeName of [paramsName, response.name]) {
      if (usedTypeNames.has(typeName))
        throw new Error(`Type name collision: ${typeName}`);
      usedTypeNames.add(typeName);
    }

    const file = fileFor(ns);
    const apiDoc = `\`${request.apiName}\``;
    const paramProps = emitInterface(
      paramsName,
      request.params.map((param: RequestClass['params'][number]) => ({
        ...param.field,
        wire: param.field.wire,
      })),
      sdk.domains,
      file,
      { topLevelRequest: true, doc: `Parameters for ${apiDoc}.` }
    ).properties;
    const responseProps = emitInterface(
      response.name,
      response.fields,
      sdk.domains,
      file,
      {
        topLevelRequest: false,
        doc: `Response of ${apiDoc}.`,
      }
    ).properties;

    const constName = lowerFirst(request.stem);
    const protocol = request.apiName.startsWith('/') ? 'gop' : 'top';
    file.body.push(
      `const ${response.name}Schema: Schema = ${schemaLiteral(responseProps, file)};\n`,
      `${docComment(apiDoc, [`(${request.httpMethod}, ${protocol.toUpperCase()}).`])}` +
        `export const ${constName}: ApiDefinition<${paramsName}, ${response.name}> = {\n` +
        `apiName: ${JSON.stringify(request.apiName)},\n` +
        `protocol: ${JSON.stringify(protocol)},\n` +
        `httpMethod: ${JSON.stringify(request.httpMethod)},\n` +
        `params: ${schemaLiteral(paramProps, file)},\n` +
        `response: ${response.name}Schema,\n};\n`
    );
    file.apiEntries.push({ method, constName, apiName: request.apiName });
  }
  console.log(
    `Namespaces: ${files.size}; methods renamed to avoid collisions: ${renamedForCollision}.`
  );

  // -- Write files ---------------------------------------------------------
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const prettierConfig = JSON.parse(
    readFileSync('.prettierrc.json', 'utf8')
  ) as prettier.Options;
  const format = (code: string): Promise<string> =>
    prettier.format(code, { ...prettierConfig, parser: 'typescript' });

  const header =
    '// AUTO-GENERATED by scripts/generate.ts from the AliExpress IOP SDK. DO NOT EDIT.\n' +
    '/* eslint-disable */\n';
  const apiNamespaces: string[] = [];

  for (const [ns, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const imports = new Map<string, Set<string>>();
    for (const ref of file.refs) {
      const owner = ownerOfDomain.get(ref);
      if (!owner || owner === ns) continue;
      const names = imports.get(owner) ?? new Set<string>();
      names.add(ref);
      names.add(`${ref}Schema`);
      imports.set(owner, names);
    }
    const importLines = [...imports]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([owner, names]) =>
          `import { ${[...names]
            .sort()
            .map((n) => (n.endsWith('Schema') ? n : `type ${n}`))
            .join(', ')} } from './${owner}.js';`
      );

    let apisBlock = '';
    if (file.apiEntries.length > 0) {
      apiNamespaces.push(ns);
      const rows = file.apiEntries
        .sort((a, b) => a.method.localeCompare(b.method))
        .map(
          (entry) =>
            `${docComment(`\`${entry.apiName}\``)}${JSON.stringify(entry.method)}: ${entry.constName},`
        );
      apisBlock = `\nexport const ${ns}Apis = {\n${rows.join('\n')}\n} as const;\n`;
    }

    const source =
      `${header}import type { ApiDefinition, FileInput, Long, LongInput, Schema } from '../core/index.js';\n` +
      `${importLines.join('\n')}\n\n${file.body.join('\n')}${apisBlock}`;
    writeFileSync(join(outDir, `${ns}.ts`), await format(source));
  }

  // Client + public type surface.
  const nsList = apiNamespaces.sort();
  const clientSource =
    `${header}import { AliExpressClientBase } from '../core/client.js';\n` +
    `import type { BoundApis, ClientConfig } from '../core/index.js';\n` +
    nsList.map((ns) => `import { ${ns}Apis } from './${ns}.js';`).join('\n') +
    `\n\n/** Every API definition grouped by namespace. */\nexport const namespaceRegistry = {\n` +
    nsList.map((ns) => `${ns}: ${ns}Apis,`).join('\n') +
    `\n} as const;\n\n` +
    `export type AliExpressNamespaces = {\n` +
    nsList
      .map((ns) => `readonly ${ns}: BoundApis<typeof ${ns}Apis>;`)
      .join('\n') +
    `\n};\n\n` +
    `// Declaration merging adds the namespace properties to the class type.\n` +
    `export interface AliExpressClient extends AliExpressNamespaces {}\n\n` +
    `/**\n * AliExpress Open Platform client.\n *\n * @example\n * const client = new AliExpressClient({ appKey, appSecret, accessToken });\n * const result = await client.solution.productListGet({ aeopAEProductListQuery: { currentPage: 1 } });\n * if (!result.ok) throw result.error;\n */\n` +
    `export class AliExpressClient extends AliExpressClientBase {\n` +
    `constructor(config: ClientConfig) {\nsuper(config);\nthis.bindNamespaces(namespaceRegistry);\n}\n}\n`;
  writeFileSync(join(outDir, 'client.ts'), await format(clientSource));

  const indexSource =
    `${header}export { AliExpressClient, namespaceRegistry } from './client.js';\n` +
    `export type { AliExpressNamespaces } from './client.js';\n` +
    nsList.map((ns) => `export { ${ns}Apis } from './${ns}.js';`).join('\n') +
    '\n' +
    [...files.keys()]
      .sort()
      .map((ns) => `export type * from './${ns}.js';`)
      .join('\n') +
    '\n';
  writeFileSync(join(outDir, 'index.ts'), await format(indexSource));

  console.log(`Wrote ${files.size + 2} files to ${outDir}.`);
  console.log(
    `Comment translations: ${translations.size} in table, ${untranslated.size} Chinese comment(s) without a translation.`
  );
  if (untranslated.size > 0) {
    const missingPath = 'scripts/translations/missing.json';
    writeFileSync(
      missingPath,
      JSON.stringify([...untranslated].sort(), null, 2) + '\n'
    );
    console.log(`Wrote the untranslated comments to ${missingPath}.`);
    if (args.includes('--strict')) {
      throw new Error(
        'Untranslated Chinese comments remain (--strict). Add them to ' +
          TRANSLATIONS_PATH +
          '.'
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
