import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  AliExpressClient,
  generateOAuthState,
  namespaceRegistry,
} from '../src/index.js';
import type { ApiDefinition, RequestEvent } from '../src/index.js';

const SECRET = 'app-secret-value-123';
const TOKEN = 'seller-token-value-456';

function okFetch(
  calls: { url: string; init?: RequestInit }[] = []
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

function makeClient(overrides: Record<string, unknown> = {}): AliExpressClient {
  return new AliExpressClient({
    appKey: 'key',
    appSecret: SECRET,
    accessToken: TOKEN,
    fetch: okFetch(),
    ...overrides,
  });
}

const topApi = namespaceRegistry.solution.productListGet as ApiDefinition;
const gopApi = namespaceRegistry.auth.tokenCreate as ApiDefinition;

describe('baseUrl validation (#3)', () => {
  it.each([
    [
      'userinfo that changes the host',
      'https://api-sg.aliexpress.com@evil.example',
    ],
    ['plain http to a remote host', 'http://api-sg.aliexpress.com'],
    ['a query string', 'https://api-sg.aliexpress.com?x=1'],
    ['a fragment', 'https://api-sg.aliexpress.com/#x'],
    ['a non-URL', 'not a url'],
    ['an unsupported scheme', 'ftp://api-sg.aliexpress.com'],
  ])('rejects %s', (_label, baseUrl) => {
    expect(() => makeClient({ baseUrl })).toThrow(/baseUrl/);
  });

  it('accepts https hosts, path prefixes and loopback http', () => {
    expect(() =>
      makeClient({ baseUrl: 'https://api-sg.aliexpress.com/' })
    ).not.toThrow();
    expect(() =>
      makeClient({ baseUrl: 'https://proxy.example/aliexpress' })
    ).not.toThrow();
    expect(() =>
      makeClient({ baseUrl: 'http://localhost:8080' })
    ).not.toThrow();
    expect(() =>
      makeClient({ baseUrl: 'http://127.0.0.1:8080' })
    ).not.toThrow();
  });

  it('sends exactly one `method` and one `session` on TOP requests', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await makeClient({ fetch: okFetch(calls) }).call(topApi);
    const url = new URL(calls[0].url);
    expect(url.searchParams.getAll('method')).toEqual([topApi.apiName]);
    expect(url.searchParams.getAll('session')).toEqual([TOKEN]);
    expect(url.host).toBe('api-sg.aliexpress.com');
  });

  it.each([
    'foo&session=attacker',
    'foo?x=1',
    'foo#frag',
    'foo\\bar',
    'foo@bar',
  ])('refuses an api name containing URL syntax: %s', async (apiName) => {
    const calls: { url: string }[] = [];
    const client = makeClient({ fetch: okFetch(calls as never) });
    for (const protocol of ['top', 'gop'] as const) {
      const result = await client.call({ ...topApi, apiName, protocol });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('validation');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('authorization URL (#4)', () => {
  it('requires a state and includes it', () => {
    const client = makeClient();
    const url = new URL(
      client.getAuthorizationUrl({
        redirectUri: 'https://app.example/cb',
        state: 'abc123',
      })
    );
    expect(url.searchParams.get('state')).toBe('abc123');
    expect(() =>
      client.getAuthorizationUrl({
        redirectUri: 'https://app.example/cb',
        state: '',
      })
    ).toThrow(/state/);
    expect(() =>
      client.getAuthorizationUrl({
        redirectUri: 'https://app.example/cb',
      } as never)
    ).toThrow(/state/);
  });

  it.each([
    ['plain http', 'http://app.example/cb'],
    ['userinfo', 'https://user:pw@app.example/cb'],
    ['a relative URL', '/cb'],
    ['a non-URL', 'nope'],
  ])('rejects a redirectUri with %s', (_label, redirectUri) => {
    expect(() =>
      makeClient().getAuthorizationUrl({ redirectUri, state: 's' })
    ).toThrow(/redirectUri/);
  });

  it('allows loopback http for local development', () => {
    expect(() =>
      makeClient().getAuthorizationUrl({
        redirectUri: 'http://localhost:3000/cb',
        state: 's',
      })
    ).not.toThrow();
  });

  it('generates unguessable, URL-safe state values', () => {
    const a = generateOAuthState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(generateOAuthState()).not.toBe(a);
  });
});

describe('credential exposure (#5)', () => {
  it('does not expose the secret or token through JSON, keys or inspect', () => {
    const client = makeClient();
    const surfaces = [
      JSON.stringify(client),
      Object.keys(client).join(','),
      JSON.stringify(Object.getOwnPropertyNames(client)),
      inspect(client, { depth: 6, showHidden: true }),
      String(Object.entries(client)),
    ].join('\n');
    expect(surfaces).not.toContain(SECRET);
    expect(surfaces).not.toContain(TOKEN);
  });

  it('still exposes the namespaces for use', () => {
    expect(typeof makeClient().solution.productListGet).toBe('function');
  });
});

describe('error text hygiene (#6)', () => {
  it('keeps the request URL and token out of transport error messages', async () => {
    const events: RequestEvent[] = [];
    const leaking = (async (input: string | URL | Request) => {
      throw new TypeError(`Failed to parse URL from ${String(input)}`, {
        cause: new Error(`bad url ${String(input)}`),
      });
    }) as typeof fetch;
    const result = await makeClient({
      fetch: leaking,
      onRequest: (event: RequestEvent) => events.push(event),
    }).call(topApi);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network');
    expect(result.error.message).toContain(topApi.apiName);
    expect(result.error.message).not.toContain(TOKEN);
    expect(result.error.message).not.toContain('session=');
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    // The raw cause stays available to callers who opt in.
    expect(result.error.cause).toBeInstanceOf(TypeError);
  });

  it('keeps the network error code, which is safe and useful', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND host'), {
          code: 'ENOTFOUND',
        }),
      });
    }) as typeof fetch;
    const result = await makeClient({ fetch: failing }).call(topApi);
    if (!result.ok) expect(result.error.message).toContain('ENOTFOUND');
  });

  it('redacts credentials echoed in non-JSON and JSON error bodies', async () => {
    const echo = (async () =>
      new Response(
        `Bad request: GET /sync?session=${TOKEN}&access_token=${TOKEN}&sign=ABCDEF {"session":"${TOKEN}"}`,
        { status: 502 }
      )) as typeof fetch;
    const result = await makeClient({ fetch: echo }).call(topApi);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toContain(TOKEN);
    expect(result.error.message).not.toContain('ABCDEF');
    expect(result.error.httpStatus).toBe(502);
  });
});

describe('redirects (#7)', () => {
  it('asks fetch to reject redirects on every request shape', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = makeClient({ fetch: okFetch(calls) });
    await client.call(topApi); // POST form
    await client.call({ ...topApi, httpMethod: 'GET' }); // GET
    await client.call(gopApi, { code: 'c' }); // GOP
    const upload = Object.values(namespaceRegistry)
      .flatMap((apis) => Object.values(apis))
      .find((d) =>
        Object.values(d.params).some((s) => s[1] === 'f')
      ) as ApiDefinition;
    const fileProp = Object.entries(upload.params).find(
      ([, s]) => s[1] === 'f'
    )![0];
    await client.call(upload, {
      [fileProp]: { fileName: 'a', content: new Uint8Array([1]) },
    });
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.init?.redirect).toBe('error');
  });

  it('reports a refused redirect as an http failure without retrying', async () => {
    const redirected = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: new Error('unexpected redirect'),
      });
    }) as unknown as typeof fetch;
    const result = await makeClient({ fetch: redirected }).call(gopApi, {
      code: 'c',
    });
    expect(redirected).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.message).toMatch(/redirect/i);
    }
  });
});
