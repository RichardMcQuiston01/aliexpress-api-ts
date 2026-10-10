import { describe, expect, it, vi } from 'vitest';
import { AliExpressClient, namespaceRegistry } from '../src/index.js';
import { signRequest } from '../src/core/sign.js';

interface Captured {
  url: URL;
  init: RequestInit;
}

function mockFetch(
  responder: (captured: Captured) => { status?: number; body: string }
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const captured = { url: new URL(String(input)), init: init ?? {} };
      calls.push(captured);
      const { status = 200, body } = responder(captured);
      return new Response(body, { status });
    }
  );
  return { fetch: impl as unknown as typeof fetch, calls };
}

function makeClient(fetchImpl: typeof fetch): AliExpressClient {
  return new AliExpressClient({
    appKey: 'key',
    appSecret: 'secret',
    accessToken: 'tok',
    fetch: fetchImpl,
  });
}

describe('registry', () => {
  it('exposes all 932 APIs with unique names', () => {
    const names = Object.values(namespaceRegistry).flatMap((apis) =>
      Object.values(apis).map((definition) => definition.apiName)
    );
    expect(names).toHaveLength(932);
    expect(new Set(names).size).toBe(932);
  });
});

describe('TOP call', () => {
  it('signs, posts form params and decodes the typed response', async () => {
    const { fetch: fetchImpl, calls } = mockFetch(() => ({
      body: JSON.stringify({
        result: { total_count: 1, current_page: 1, product_count: 1 },
        request_id: 'req-1',
      }),
    }));
    const client = makeClient(fetchImpl);

    const result = await client.solution.productListGet(
      {
        eanCode: '123',
        aeopAEProductListQuery: { currentPage: 1, pageSize: 20 },
      },
      { timestamp: 1700000000000 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requestId).toBe('req-1');
    expect(result.data.result).toBeDefined();

    const [call] = calls;
    expect(call.url.pathname).toBe('/sync');
    expect(call.url.searchParams.get('method')).toBe(
      'aliexpress.solution.product.list.get'
    );
    expect(call.url.searchParams.get('session')).toBe('tok');
    expect(call.init.method).toBe('POST');

    const body = new URLSearchParams(String(call.init.body));
    expect(body.get('ean_code')).toBe('123');
    expect(body.get('aeop_a_e_product_list_query')).toBe(
      '{"current_page":1,"page_size":20}'
    );

    // Verify the signature covers query + body params with an empty prefix.
    const sign = call.url.searchParams.get('sign');
    const all: Record<string, string> = {};
    call.url.searchParams.forEach((value, key) => {
      if (key !== 'sign') all[key] = value;
    });
    body.forEach((value, key) => {
      all[key] = value;
    });
    expect(sign).toBe(signRequest('', all, 'secret'));
  });
});

describe('GOP call', () => {
  it('prefixes the signature with the API path and uses /rest', async () => {
    const { fetch: fetchImpl, calls } = mockFetch(() => ({
      body: JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        code: '0',
        request_id: 'r1',
      }),
    }));
    const client = makeClient(fetchImpl);
    const result = await client.auth.tokenCreate({ code: 'oauth-code' });

    expect(result.ok).toBe(true);
    const [call] = calls;
    expect(call.url.pathname).toBe('/rest/auth/token/create');
    expect(call.url.searchParams.get('access_token')).toBe('tok');
    const all: Record<string, string> = { code: 'oauth-code' };
    call.url.searchParams.forEach((value, key) => {
      if (key !== 'sign') all[key] = value;
    });
    expect(call.url.searchParams.get('sign')).toBe(
      signRequest('/auth/token/create', all, 'secret')
    );
    if (result.ok) expect(result.data.accessToken).toBe('a');
  });
});

describe('errors', () => {
  it('returns a descriptive api error for TOP error_response', async () => {
    const { fetch: fetchImpl } = mockFetch(() => ({
      body: JSON.stringify({
        error_response: {
          type: 'ISV',
          code: 'IllegalAccessToken',
          msg: 'The access token is invalid',
          sub_code: 'x',
          request_id: 'abc',
        },
      }),
    }));
    const result = await makeClient(fetchImpl).solution.productListGet();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('api');
    expect(result.error.code).toBe('IllegalAccessToken');
    expect(result.error.message).toContain(
      'aliexpress.solution.product.list.get'
    );
    expect(result.error.message).toContain('request_id=abc');
  });

  it('returns network errors instead of throwing', async () => {
    const failing = vi
      .fn()
      .mockRejectedValue(
        new TypeError('fetch failed')
      ) as unknown as typeof fetch;
    const result = await makeClient(failing).solution.productListGet();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('reports non-JSON HTTP failures with the status', async () => {
    const { fetch: fetchImpl } = mockFetch(() => ({
      status: 502,
      body: '<html>Bad gateway</html>',
    }));
    const result = await makeClient(fetchImpl).solution.productListGet();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.httpStatus).toBe(502);
    }
  });

  it('times out', async () => {
    const hanging = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    ) as unknown as typeof fetch;
    const result = await makeClient(hanging).solution.productListGet(
      undefined,
      { timeoutMs: 20 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
  });

  it('rejects missing credentials with a clear message', () => {
    expect(() => new AliExpressClient({ appKey: '', appSecret: 's' })).toThrow(
      /appKey/
    );
  });
});

describe('uploads', () => {
  it('sends multipart when a file param is present', async () => {
    const { fetch: fetchImpl, calls } = mockFetch(() => ({
      body: '{"code":"0"}',
    }));
    const client = makeClient(fetchImpl);
    const uploadApi = Object.values(namespaceRegistry)
      .flatMap((apis) => Object.values(apis))
      .find((definition) =>
        Object.values(definition.params).some((spec) => spec[1] === 'f')
      );
    expect(uploadApi).toBeDefined();
    const fileProp = Object.entries(uploadApi!.params).find(
      ([, spec]) => spec[1] === 'f'
    )![0];
    const result = await client.call(uploadApi!, {
      [fileProp]: {
        fileName: 'a.png',
        content: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
      },
    });
    expect(result.ok).toBe(true);
    expect(calls[0].init.body).toBeInstanceOf(FormData);
  });
});

describe('authorization url', () => {
  it('builds the OAuth URL', () => {
    const client = makeClient(fetch);
    const url = new URL(
      client.getAuthorizationUrl({
        redirectUri: 'https://x.test/cb',
        state: 's1',
      })
    );
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('key');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/cb');
  });
});
