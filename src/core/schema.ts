/**
 * Compact runtime schemas generated from the Java SDK. They map camelCase
 * TypeScript property names to the snake/camel wire names the gateway uses,
 * and describe enough type information to encode requests and decode
 * responses leniently (the gateway is loose about string vs number).
 *
 * Type codes:
 *   `s` string, `i` integer, `n` decimal, `l` long, `b` boolean,
 *   `o` nested object (needs a schema thunk), `x` untouched/any,
 *   `f` file upload. A leading `[` means "list of".
 */
export type TypeCode =
  | 's'
  | 'i'
  | 'n'
  | 'l'
  | 'b'
  | 'o'
  | 'x'
  | 'f'
  | '[s'
  | '[i'
  | '[n'
  | '[l'
  | '[b'
  | '[o'
  | '[x';

export type SchemaThunk = () => Schema;

export type FieldSpec =
  | readonly [wire: string, code: TypeCode]
  | readonly [wire: string, code: TypeCode, ref: SchemaThunk];

export type Schema = Readonly<Record<string, FieldSpec>>;
export type ParamSchema = Schema;

const INTEGER_PATTERN = /^-?\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Splits `[s` into `{ list: true, base: 's' }`. */
function splitCode(code: TypeCode): { list: boolean; base: string } {
  return code.startsWith('[')
    ? { list: true, base: code.slice(1) }
    : { list: false, base: code };
}

// ---------------------------------------------------------------------------
// Encoding (request side)
// ---------------------------------------------------------------------------

function encodeScalarJson(value: unknown, base: string): string {
  switch (base) {
    case 'l':
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'string' && INTEGER_PATTERN.test(value))
        return value;
      if (typeof value === 'number') return String(value);
      return JSON.stringify(value);
    case 'i':
    case 'n':
      return typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
    case 'b':
      return typeof value === 'boolean' ? String(value) : JSON.stringify(value);
    case 's':
      return JSON.stringify(typeof value === 'string' ? value : String(value));
    default:
      return JSON.stringify(value, (_key, inner: unknown) =>
        typeof inner === 'bigint' ? inner.toString() : inner
      );
  }
}

/** Serialises `value` to JSON text using wire names from `ref`. */
export function encodeJson(
  value: unknown,
  code: TypeCode,
  ref?: SchemaThunk
): string {
  const { list, base } = splitCode(code);
  if (list) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    return `[${items.map((item) => encodeJson(item, base as TypeCode, ref)).join(',')}]`;
  }
  if (base === 'o' && ref && isRecord(value)) {
    const schema = ref();
    const members: string[] = [];
    for (const [property, spec] of Object.entries(schema)) {
      const inner = value[property];
      if (inner === undefined || inner === null) continue;
      members.push(
        `${JSON.stringify(spec[0])}:${encodeJson(inner, spec[1], spec[2])}`
      );
    }
    return `{${members.join(',')}}`;
  }
  return encodeScalarJson(value, base);
}

/** Result of encoding a request's parameters. */
export interface EncodedParams {
  readonly fields: Record<string, string>;
  readonly files: Record<string, import('./types.js').FileInput>;
}

/** Encodes request parameters the way the Java SDK's `getApiParams` does. */
export function encodeParams(
  params: Readonly<Record<string, unknown>> | undefined,
  schema: ParamSchema
): EncodedParams {
  const fields: Record<string, string> = {};
  const files: Record<string, import('./types.js').FileInput> = {};
  if (!params) return { fields, files };

  for (const [property, spec] of Object.entries(schema)) {
    const value = params[property];
    if (value === undefined || value === null) continue;
    const [wire, code, ref] = spec;
    if (code === 'f') {
      files[wire] = value as import('./types.js').FileInput;
    } else if (
      code === 's' ||
      code === 'i' ||
      code === 'n' ||
      code === 'l' ||
      code === 'b'
    ) {
      fields[wire] = String(value);
    } else {
      fields[wire] = encodeJson(value, code, ref);
    }
  }
  return { fields, files };
}

// ---------------------------------------------------------------------------
// Decoding (response side)
// ---------------------------------------------------------------------------

function tryParseEmbeddedJson(text: string): unknown {
  const trimmed = text.trim();
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksLikeJson) return text;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

function decodeScalar(value: unknown, base: string): unknown {
  switch (base) {
    case 's':
      if (typeof value === 'string') return value;
      return isRecord(value) || Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
    case 'i':
    case 'n':
      if (
        typeof value === 'string' &&
        value.trim() !== '' &&
        !Number.isNaN(Number(value))
      ) {
        return Number(value);
      }
      return value;
    case 'l':
      if (typeof value === 'string' && INTEGER_PATTERN.test(value)) {
        const asNumber = Number(value);
        return Number.isSafeInteger(asNumber) ? asNumber : value;
      }
      return value;
    case 'b':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    default:
      return value;
  }
}

function decodeValue(
  value: unknown,
  code: TypeCode,
  ref?: SchemaThunk
): unknown {
  if (value === undefined || value === null) return undefined;
  const { list, base } = splitCode(code);

  if (list) {
    const source =
      typeof value === 'string' ? tryParseEmbeddedJson(value) : value;
    if (!Array.isArray(source)) return undefined;
    return source.map((item) => decodeValue(item, base as TypeCode, ref));
  }
  if (base === 'o' && ref) {
    const source =
      typeof value === 'string' ? tryParseEmbeddedJson(value) : value;
    return isRecord(source) ? decodeObject(source, ref()) : value;
  }
  return decodeScalar(value, base);
}

/**
 * Converts a wire object into a typed object keyed by TypeScript property
 * names. Wire keys that are not in the schema are kept untouched so newer API
 * fields are never silently dropped.
 */
export function decodeObject(
  wire: Readonly<Record<string, unknown>>,
  schema: Schema
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const consumed = new Set<string>();
  for (const [property, spec] of Object.entries(schema)) {
    const [wireName, code, ref] = spec;
    if (!(wireName in wire)) continue;
    consumed.add(wireName);
    const decoded = decodeValue(wire[wireName], code, ref);
    if (decoded !== undefined) result[property] = decoded;
  }
  for (const [key, value] of Object.entries(wire)) {
    if (!consumed.has(key) && !(key in result)) result[key] = value;
  }
  return result;
}
