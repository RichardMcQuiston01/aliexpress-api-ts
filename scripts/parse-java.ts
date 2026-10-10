/**
 * Parses the AliExpress IOP Java SDK sources (request / response / domain
 * classes) into a language-neutral model that the TypeScript emitter consumes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface JavaType {
  /** Base type name, e.g. `String`, `Long`, `List`, `HashMap`, or a class name. */
  readonly name: string;
  /** Generic arguments, e.g. `List<Long>` => [Long]. */
  readonly args: readonly JavaType[];
}

export interface JavaField {
  readonly name: string;
  readonly type: JavaType;
  readonly doc: string;
  /** Wire name taken from `@ApiField` / `@ApiListField` (domain + response). */
  wire: string;
}

export interface DomainClass {
  /** Sanitised class name (no `$`). */
  readonly name: string;
  readonly javaName: string;
  readonly fields: JavaField[];
}

export interface ResponseClass {
  readonly name: string;
  readonly fields: JavaField[];
}

export interface RequestClass {
  /** Class name without the `Request` suffix, e.g. `AliexpressSolutionProductListGet`. */
  readonly stem: string;
  readonly apiName: string;
  readonly httpMethod: string;
  readonly doc: string;
  readonly responseClass: string;
  /** Request parameters in declaration order. `kind` mirrors how Java encodes them. */
  readonly params: {
    readonly field: JavaField;
    readonly kind: 'text' | 'json' | 'file';
  }[];
}

export interface ParsedSdk {
  readonly requests: RequestClass[];
  readonly responses: Map<string, ResponseClass>;
  readonly domains: Map<string, DomainClass>;
}

/** Strips the `$` used by Java inner-class names. */
export function sanitizeClassName(name: string): string {
  return name.replace(/\$/g, '');
}

function readSource(path: string): string {
  // A handful of files contain stray bytes in comments; decode leniently.
  return readFileSync(path).toString('utf8');
}

export function parseType(raw: string): JavaType {
  const text = raw.trim();
  const open = text.indexOf('<');
  if (open === -1) {
    return { name: sanitizeClassName(text), args: [] };
  }
  const name = text.slice(0, open).trim();
  const inner = text.slice(open + 1, text.lastIndexOf('>'));
  const args: JavaType[] = [];
  let depth = 0;
  let current = '';
  for (const char of inner) {
    if (char === '<') depth++;
    if (char === '>') depth--;
    if (char === ',' && depth === 0) {
      args.push(parseType(current));
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(parseType(current));
  return { name: sanitizeClassName(name), args };
}

function cleanDoc(raw: string | undefined): string {
  if (!raw) return '';
  return (
    raw
      // Drop replacement chars and control bytes left by mis-encoded comments.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g, '')
      .replace(/\*\//g, '* /')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const FIELD_LINE =
  /^\s*private\s+([A-Za-z0-9_$.<>, ?\[\]]+?)\s+([A-Za-z0-9_]+)\s*(?:=[^;]*)?;\s*$/;
const ANNOTATION_LINE = /^\s*@(ApiField|ApiListField)\("([^"]*)"\)\s*$/;

/** Line-based scan; avoids regex backtracking across the ~4,000 source files. */
function parseFields(source: string, requireAnnotation: boolean): JavaField[] {
  const fields: JavaField[] = [];
  let docBuffer: string[] = [];
  let inDoc = false;
  let pendingDoc = '';
  let wire: string | undefined;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();

    if (inDoc || trimmed.startsWith('/**')) {
      docBuffer.push(trimmed);
      inDoc = !trimmed.includes('*/');
      if (!inDoc) {
        pendingDoc = cleanDoc(
          docBuffer
            .join('\n')
            .replace(/^\/\*\*/, '')
            .replace(/\*\/$/, '')
        );
        docBuffer = [];
      }
      continue;
    }

    const annotation = line.match(ANNOTATION_LINE);
    if (annotation) {
      wire = annotation[2];
      continue;
    }

    const field = line.match(FIELD_LINE);
    if (field) {
      const [, type, name] = field;
      if (name !== 'serialVersionUID' && (!requireAnnotation || wire)) {
        fields.push({
          name,
          type: parseType(type.replace(/^(static|final)\s+/, '')),
          doc: pendingDoc,
          wire: wire ?? name,
        });
      }
      pendingDoc = '';
      wire = undefined;
      continue;
    }

    if (trimmed.startsWith('public') || trimmed.startsWith('@Override')) {
      pendingDoc = '';
      wire = undefined;
    }
  }
  return fields;
}

function parseRequest(fileName: string, source: string): RequestClass {
  const stem = fileName.replace(/\.java$/, '').replace(/Request$/, '');
  const classMatch = source.match(
    /class\s+\w+\s+extends\s+BaseGopRequest<(\w+)>/
  );
  const apiMatch = source.match(/getApiName\(\)\s*\{\s*return\s+"([^"]+)"/);
  const methodMatch = source.match(
    /getHttpMethod\(\)\s*\{\s*return\s+"([^"]+)"/
  );
  if (!classMatch || !apiMatch) {
    throw new Error(`Cannot parse request class ${fileName}`);
  }
  const docMatch = source.match(/\/\*\*\s*\n?\s*\*\s*([^\n*][^\n]*)\n?\s*\*\//);

  // Instance variables only (the request classes have no annotations).
  const fields = parseFields(
    source.slice(0, source.indexOf('@Override')),
    false
  );
  const byName = new Map(fields.map((field) => [field.name, field] as const));

  const params: RequestClass['params'] = [];
  const paramPattern =
    /if\s*\(\s*(\w+)\s*!=\s*null\s*\)\s*\{\s*super\.addApiParameter\("([^"]+)",\s*([^;]+?)\);/g;
  for (const match of source.matchAll(paramPattern)) {
    const [, fieldName, wire, expression] = match;
    const field = byName.get(fieldName);
    if (!field) throw new Error(`${fileName}: unknown field ${fieldName}`);
    params.push({
      field: { ...field, wire },
      kind: expression.includes('JSONWriter') ? 'json' : 'text',
    });
  }
  const filePattern =
    /if\s*\(\s*(\w+)\s*!=\s*null\s*\)\s*\{\s*super\.addFileParameter\("([^"]+)",\s*(\w+)\)/g;
  for (const match of source.matchAll(filePattern)) {
    const [, fieldName, wire] = match;
    const field = byName.get(fieldName);
    if (!field) throw new Error(`${fileName}: unknown file field ${fieldName}`);
    params.push({ field: { ...field, wire }, kind: 'file' });
  }
  if (params.length !== fields.length) {
    throw new Error(
      `${fileName}: ${fields.length} fields but ${params.length} encoded params`
    );
  }

  return {
    stem,
    apiName: apiMatch[1],
    httpMethod: methodMatch?.[1] ?? 'POST',
    doc: cleanDoc(docMatch?.[1]),
    responseClass: classMatch[1],
    params,
  };
}

export function parseSdk(openDir: string): ParsedSdk {
  const requests: RequestClass[] = [];
  const responses = new Map<string, ResponseClass>();
  const domains = new Map<string, DomainClass>();

  for (const file of readdirSync(join(openDir, 'request')).sort()) {
    if (!file.endsWith('.java')) continue;
    requests.push(
      parseRequest(file, readSource(join(openDir, 'request', file)))
    );
  }
  for (const file of readdirSync(join(openDir, 'response')).sort()) {
    if (!file.endsWith('.java')) continue;
    const name = file.replace(/\.java$/, '');
    const source = readSource(join(openDir, 'response', file));
    responses.set(name, { name, fields: parseFields(source, true) });
  }
  for (const file of readdirSync(join(openDir, 'domain')).sort()) {
    if (!file.endsWith('.java')) continue;
    const javaName = file.replace(/\.java$/, '');
    const name = sanitizeClassName(javaName);
    if (domains.has(name)) {
      throw new Error(`Domain class name collision after sanitising: ${name}`);
    }
    const source = readSource(join(openDir, 'domain', file));
    domains.set(name, { name, javaName, fields: parseFields(source, true) });
  }
  return { requests, responses, domains };
}
