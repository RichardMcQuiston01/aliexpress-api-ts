import { describe, expect, it } from 'vitest';
import { AliExpressClient, namespaceRegistry } from '../src/index.js';
import { decodeObject, encodeJson } from '../src/core/schema.js';
import { signRequest } from '../src/core/sign.js';
import type { ApiDefinition } from '../src/core/types.js';
import type { Schema } from '../src/core/schema.js';

/** Wire names the client sets itself, per protocol. */
const SHARED_PARAM_NAMES = [
  'app_key',
  'timestamp',
  'sign',
  'sign_method',
  'partner_id',
];
const RESERVED_PARAM_NAMES: Readonly<
  Record<'top' | 'gop', ReadonlySet<string>>
> = {
  top: new Set([
    ...SHARED_PARAM_NAMES,
    'session',
    'method',
    'v',
    'format',
    'simplify',
  ]),
  gop: new Set([...SHARED_PARAM_NAMES, 'access_token']),
};
const VALID_CODES = new Set(['s', 'i', 'n', 'l', 'b', 'o', 'x', 'f']);
const MAX_SAMPLE_DEPTH = 3;

interface EndpointCase {
  readonly namespace: string;
  readonly method: string;
  readonly definition: ApiDefinition;
}

const endpoints: EndpointCase[] = Object.entries(namespaceRegistry).flatMap(
  ([namespace, apis]) =>
    Object.entries(apis).map(([method, definition]) => ({
      namespace,
      method,
      definition: definition as ApiDefinition,
    }))
);

/** Builds a typed (camelCase) sample value for every field of `schema`. */
function sampleObject(schema: Schema, depth: number): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const [property, [, code, ref]] of Object.entries(schema)) {
    const list = code.startsWith('[');
    const base = list ? code.slice(1) : code;
    let value: unknown;
    switch (base) {
      case 's':
        value = `${property}-value`;
        break;
      case 'i':
      case 'n':
      case 'l':
        value = 7;
        break;
      case 'b':
        value = true;
        break;
      case 'o':
        if (depth >= MAX_SAMPLE_DEPTH || !ref) continue; // cut recursive types
        value = sampleObject(ref(), depth + 1);
        break;
      case 'f':
        value = {
          fileName: 'a.bin',
          content: new Uint8Array([1, 2, 3]),
          mimeType: 'application/octet-stream',
        };
        break;
      default:
        value = { nested: 1 };
    }
    sample[property] = list ? [value] : value;
  }
  return sample;
}

/** Recursively checks a schema is well formed. */
function validateSchema(
  schema: Schema,
  label: string,
  seen: Set<Schema>,
  problems: string[]
): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const wireNames = new Set<string>();
  for (const [property, spec] of Object.entries(schema)) {
    const [wire, code, ref] = spec;
    if (!wire) problems.push(`${label}.${property}: empty wire name`);
    if (wireNames.has(wire))
      problems.push(`${label}: duplicate wire name "${wire}"`);
    wireNames.add(wire);
    const base = code.startsWith('[') ? code.slice(1) : code;
    if (!VALID_CODES.has(base))
      problems.push(`${label}.${property}: bad code "${code}"`);
    if (base === 'o') {
      const child = ref?.();
      if (!child || typeof child !== 'object') {
        problems.push(
          `${label}.${property}: object field has no resolvable schema`
        );
      } else {
        validateSchema(child, `${label}.${property}`, seen, problems);
      }
    } else if (ref) {
      problems.push(`${label}.${property}: non-object field carries a schema`);
    }
  }
}

function makeClient(
  respondWith: string,
  captured: { url?: URL; init?: RequestInit }
): AliExpressClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    captured.url = new URL(String(input));
    captured.init = init;
    return new Response(respondWith, { status: 200 });
  }) as typeof fetch;
  return new AliExpressClient({
    appKey: 'key',
    appSecret: 'secret',
    accessToken: 'token',
    fetch: fetchImpl,
  });
}

describe('endpoint registry', () => {
  it('covers 932 endpoints with unique api names and namespaced methods', () => {
    expect(endpoints).toHaveLength(932);
    expect(new Set(endpoints.map((e) => e.definition.apiName)).size).toBe(932);
    expect(
      new Set(endpoints.map((e) => `${e.namespace}.${e.method}`)).size
    ).toBe(932);
  });
});

describe.each(endpoints.map((e) => [`${e.namespace}.${e.method}`, e] as const))(
  '%s',
  (_name, { definition }) => {
    it('has a well-formed definition and schemas', () => {
      const problems: string[] = [];
      expect(definition.apiName.length).toBeGreaterThan(0);
      expect(definition.protocol).toBe(
        definition.apiName.startsWith('/') ? 'gop' : 'top'
      );
      expect(['GET', 'POST', 'HSF']).toContain(definition.httpMethod);
      validateSchema(definition.params, 'params', new Set(), problems);
      validateSchema(definition.response, 'response', new Set(), problems);
      expect(problems).toEqual([]);
    });

    it('does not shadow client-managed request parameters', () => {
      const collisions = Object.values(definition.params)
        .map(([wire]) => wire)
        .filter((wire) => RESERVED_PARAM_NAMES[definition.protocol].has(wire));
      expect(collisions).toEqual([]);
    });

    it('builds, signs and sends a request carrying every parameter', async () => {
      const captured: { url?: URL; init?: RequestInit } = {};
      const client = makeClient('{}', captured);
      const params = sampleObject(definition.params, 0);

      const result = await client.call(definition, params);
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);

      const url = captured.url!;
      expect(url.pathname).toBe(
        definition.protocol === 'gop' ? `/rest${definition.apiName}` : '/sync'
      );

      // Collect every transmitted parameter (query + form/multipart body).
      const sent: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        sent[key] = value;
      });
      const body = captured.init?.body;
      if (body instanceof FormData) {
        body.forEach((value, key) => {
          if (typeof value === 'string') sent[key] = value;
          else sent[`${key}#file`] = value.name;
        });
      } else if (typeof body === 'string') {
        new URLSearchParams(body).forEach((value, key) => {
          sent[key] = value;
        });
      }

      for (const [property, [wire, code]] of Object.entries(
        definition.params
      )) {
        if (params[property] === undefined) continue;
        if (code === 'f') expect(sent[`${wire}#file`]).toBe('a.bin');
        else expect(sent[wire], `param ${wire}`).toBeDefined();
      }

      const signed: Record<string, string> = {};
      for (const [key, value] of Object.entries(sent)) {
        if (key !== 'sign' && !key.endsWith('#file')) signed[key] = value;
      }
      // File parts are not part of the signed text, only text fields are.
      const prefix = definition.protocol === 'gop' ? definition.apiName : '';
      expect(sent.sign).toBe(signRequest(prefix, signed, 'secret'));
    });

    it('round-trips a populated response through wire format and decoding', async () => {
      const sample = sampleObject(definition.response, 0);
      const wire = JSON.parse(
        encodeJson(sample, 'o', () => definition.response)
      ) as Record<string, unknown>;
      expect(decodeObject(wire, definition.response)).toEqual(sample);

      // Through the client, unless a response field is literally named like an
      // error envelope (the gateway treats a non-zero top-level `code` as an error).
      const wireNames = Object.values(definition.response).map(
        ([name]) => name
      );
      if (wireNames.includes('code') || wireNames.includes('error_response'))
        return;
      const captured: { url?: URL; init?: RequestInit } = {};
      const result = await makeClient(JSON.stringify(wire), captured).call(
        definition
      );
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) expect(result.data).toEqual(sample);
    });
  }
);
