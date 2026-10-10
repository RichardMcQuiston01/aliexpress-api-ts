import { randomBytes } from 'node:crypto';
import { AliExpressError, describeApiError } from './errors.js';
import { parseJsonPreservingLongs } from './json.js';
import { decodeObject, encodeParams } from './schema.js';
import { signRequest } from './sign.js';
import type {
  ApiDefinition,
  ApiResult,
  CallOptions,
  ClientConfig,
  FileInput,
  Protocol,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api-sg.aliexpress.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const PARTNER_ID = 'iop-sdk-ts';
const MAX_ERROR_SNIPPET_LENGTH = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}

/** Scrubs credentials that a gateway or proxy may echo back in an error body. */
export function redactSecrets(text: string): string {
  return text
    .replace(
      /\b(session|access_token|refresh_token|sign|app_secret|client_secret)=[^&\s"'<>]+/gi,
      '$1=[redacted]'
    )
    .replace(
      /("(?:session|access_token|refresh_token|sign|app_secret|client_secret)"\s*:\s*")[^"]*(")/gi,
      '$1[redacted]$2'
    );
}

function snippet(text: string): string {
  const flattened = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return flattened.length > MAX_ERROR_SNIPPET_LENGTH
    ? `${flattened.slice(0, MAX_ERROR_SNIPPET_LENGTH)}...`
    : flattened;
}

function toBlob(file: FileInput): Blob {
  if (file.content instanceof Blob) return file.content;
  return new Blob([file.content as BlobPart], {
    type: file.mimeType ?? 'application/octet-stream',
  });
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Characters allowed in an API name; excludes every URL delimiter. */
const SAFE_API_NAME = /^[A-Za-z0-9_./-]+$/;

/**
 * Parses a URL the library will send credentials to. Requires `https:` (plain
 * `http:` only for loopback development hosts) and rejects userinfo, which
 * would silently change the host that receives the request.
 */
function parseTrustedUrl(raw: unknown, option: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new TypeError(
      `AliExpressClient: "${option}" must be an absolute URL such as https://api-sg.aliexpress.com (the value was not parseable as a URL).`
    );
  }
  const loopbackHttp =
    url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new TypeError(
      `AliExpressClient: "${option}" must use https (http is only allowed for localhost, 127.0.0.1 or [::1]); received protocol "${url.protocol}" on host "${url.hostname}".`
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(
      `AliExpressClient: "${option}" must not contain a username or password; userinfo can change which host receives your access token.`
    );
  }
  return url;
}

function normalizeBaseUrl(raw: string): string {
  const url = parseTrustedUrl(raw, 'baseUrl');
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError(
      'AliExpressClient: "baseUrl" must not contain a query string or fragment.'
    );
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function assertSafeApiName(apiName: string, protocol: Protocol): void {
  const segments = apiName.split('/');
  if (
    !SAFE_API_NAME.test(apiName) ||
    segments.includes('..') ||
    (protocol === 'gop' && !apiName.startsWith('/'))
  ) {
    throw new TypeError(
      `API name "${apiName.slice(0, 80)}" contains characters that are not valid in an API path (allowed: letters, digits, "_", ".", "-" and "/"), or is not a valid ${protocol.toUpperCase()} name.`
    );
  }
}

/** Generates an unguessable OAuth `state` value for `getAuthorizationUrl`. */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

/** Network error code (e.g. `ENOTFOUND`) when the cause chain carries a safe one. */
function networkErrorCode(cause: unknown): string | undefined {
  for (let current = cause, depth = 0; current && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function causeMentionsRedirect(cause: unknown): boolean {
  for (let current = cause, depth = 0; current && depth < 4; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && /redirect/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Node 18 compatible stand-in for `AbortSignal.any`. */
function combineSignals(
  first: AbortSignal,
  second: AbortSignal | undefined
): AbortSignal {
  if (!second) return first;
  const controller = new AbortController();
  const abort = (source: AbortSignal) => () => controller.abort(source.reason);
  for (const source of [first, second]) {
    if (source.aborted) {
      controller.abort(source.reason);
    } else {
      source.addEventListener('abort', abort(source), { once: true });
    }
  }
  return controller.signal;
}

interface PreparedRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly displayUrl: string;
}

/**
 * Low-level IOP client. The generated `AliExpressClient` extends this and adds
 * one property per API namespace (`client.solution`, `client.ds`, ...).
 */
export class AliExpressClientBase {
  // ES private fields: unlike `protected`, they are not enumerable, so
  // JSON.stringify(client), Object.keys and most loggers cannot leak them.
  readonly #appKey: string;
  readonly #appSecret: string;
  readonly #accessToken: string | undefined;
  readonly #timeoutMs: number;
  readonly #onRequest: ClientConfig['onRequest'];
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: ClientConfig) {
    if (
      !config ||
      typeof config.appKey !== 'string' ||
      config.appKey.trim() === ''
    ) {
      throw new TypeError(
        'AliExpressClient: "appKey" is required. Create an app in the AliExpress Open Platform console to obtain one.'
      );
    }
    if (
      typeof config.appSecret !== 'string' ||
      config.appSecret.trim() === ''
    ) {
      throw new TypeError(
        'AliExpressClient: "appSecret" is required. It is shown next to the app key in the AliExpress Open Platform console.'
      );
    }
    this.#appKey = config.appKey;
    this.#appSecret = config.appSecret;
    this.#accessToken = config.accessToken;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#onRequest = config.onRequest;
    this.#baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    const fetchImpl =
      config.fetch ??
      (typeof globalThis.fetch === 'function'
        ? (input: string | URL | Request, init?: RequestInit) =>
            globalThis.fetch(input, init)
        : undefined);
    if (!fetchImpl) {
      throw new TypeError(
        'AliExpressClient: no global fetch found (Node.js 18+ is required). Pass a "fetch" implementation in the client config.'
      );
    }
    this.#fetch = fetchImpl;
  }

  /**
   * Builds the URL a seller visits to authorise your app. Generate `state`
   * with `generateOAuthState()`, store it in the user's session, and compare it
   * with the `state` on the callback before exchanging the returned `code` with
   * `client.auth.tokenCreate({ code })`.
   */
  getAuthorizationUrl(options: {
    readonly redirectUri: string;
    readonly state: string;
    readonly forceAuth?: boolean;
  }): string {
    if (typeof options?.state !== 'string' || options.state.trim() === '') {
      throw new TypeError(
        'AliExpressClient.getAuthorizationUrl: "state" is required to protect the OAuth callback against CSRF. Use generateOAuthState() and verify it on the callback.'
      );
    }
    const redirect = parseTrustedUrl(options.redirectUri, 'redirectUri');
    const url = new URL(`${this.#baseUrl}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('force_auth', String(options.forceAuth ?? true));
    url.searchParams.set('redirect_uri', redirect.toString());
    url.searchParams.set('client_id', this.#appKey);
    url.searchParams.set('state', options.state);
    return url.toString();
  }

  /** Executes any API definition. Never rejects; inspect `result.ok`. */
  async call<TParams, TResponse>(
    definition: ApiDefinition<TParams, TResponse>,
    params?: TParams,
    options: CallOptions = {}
  ): Promise<ApiResult<TResponse>> {
    const started = Date.now();
    let displayUrl = `${this.#baseUrl}`;
    let httpStatus: number | undefined;

    const fail = (
      error: AliExpressError,
      rawBody?: string
    ): ApiResult<TResponse> => {
      this.notify(
        definition.apiName,
        displayUrl,
        started,
        false,
        httpStatus,
        error.message
      );
      return { ok: false, error, httpStatus, rawBody };
    };

    let prepared: PreparedRequest;
    try {
      prepared = this.prepare(definition, params, options);
      displayUrl = prepared.displayUrl;
    } catch (cause) {
      return fail(
        new AliExpressError({
          kind: 'validation',
          apiName: definition.apiName,
          message: `Could not build the request for "${definition.apiName}": ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          cause,
        })
      );
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = combineSignals(timeoutSignal, options.signal);

    let body: string;
    try {
      const response = await this.#fetch(prepared.url, {
        ...prepared.init,
        signal,
      });
      httpStatus = response.status;
      body = await response.text();
    } catch (cause) {
      if (options.signal?.aborted) {
        return fail(
          new AliExpressError({
            kind: 'aborted',
            apiName: definition.apiName,
            message: `Request to "${definition.apiName}" was aborted by the caller's AbortSignal.`,
            cause,
          })
        );
      }
      if (timeoutSignal.aborted) {
        return fail(
          new AliExpressError({
            kind: 'timeout',
            apiName: definition.apiName,
            message: `Request to "${definition.apiName}" timed out after ${timeoutMs} ms.`,
            cause,
          })
        );
      }
      if (causeMentionsRedirect(cause)) {
        return fail(
          new AliExpressError({
            kind: 'http',
            apiName: definition.apiName,
            message: `"${definition.apiName}" was answered with an HTTP redirect, which is refused so credentials in the request are never replayed to another URL. Check "baseUrl", or pass a custom "fetch" to follow redirects deliberately.`,
            cause,
          })
        );
      }
      // The raw error text can contain the full request URL (including the
      // access token), so it stays on `error.cause` and out of the message.
      const code = networkErrorCode(cause);
      return fail(
        new AliExpressError({
          kind: 'network',
          apiName: definition.apiName,
          message: `Network error calling "${definition.apiName}" at ${this.#baseUrl}: fetch failed${code ? ` (${code})` : ''}. The underlying error is available on error.cause.`,
          cause,
        })
      );
    }

    return this.interpret(
      definition,
      body,
      httpStatus,
      started,
      displayUrl,
      fail
    );
  }

  private interpret<TResponse>(
    definition: ApiDefinition<unknown, TResponse>,
    body: string,
    httpStatus: number,
    started: number,
    displayUrl: string,
    fail: (error: AliExpressError, rawBody?: string) => ApiResult<TResponse>
  ): ApiResult<TResponse> {
    const httpOk = httpStatus >= 200 && httpStatus < 300;

    let parsed: unknown;
    try {
      parsed = parseJsonPreservingLongs(body);
    } catch (cause) {
      return fail(
        new AliExpressError({
          kind: httpOk ? 'parse' : 'http',
          apiName: definition.apiName,
          httpStatus,
          message: httpOk
            ? `"${definition.apiName}" returned HTTP ${httpStatus} with a body that is not valid JSON: ${snippet(body)}`
            : `"${definition.apiName}" failed with HTTP ${httpStatus}: ${snippet(body) || '(empty body)'}`,
          cause,
        }),
        body
      );
    }

    if (!isRecord(parsed)) {
      return fail(
        new AliExpressError({
          kind: 'parse',
          apiName: definition.apiName,
          httpStatus,
          message: `"${definition.apiName}" returned JSON that is not an object: ${snippet(body)}`,
        }),
        body
      );
    }

    // TOP wraps errors in `error_response`; GOP puts them at the top level.
    const errorSource = isRecord(parsed.error_response)
      ? parsed.error_response
      : parsed;
    const code = asText(errorSource.code);
    const requestId = asText(errorSource.request_id ?? parsed.request_id);
    const hasApiError =
      isRecord(parsed.error_response) || (code !== undefined && code !== '0');

    if (hasApiError) {
      const fields = {
        code,
        message: asText(errorSource.msg ?? errorSource.message),
        subCode: asText(errorSource.sub_code),
        subMessage: asText(errorSource.sub_msg),
        errorType: asText(errorSource.type),
        requestId,
      };
      return fail(
        new AliExpressError({
          kind: 'api',
          apiName: definition.apiName,
          httpStatus,
          ...fields,
          message: describeApiError(definition.apiName, fields),
        }),
        body
      );
    }

    if (!httpOk) {
      return fail(
        new AliExpressError({
          kind: 'http',
          apiName: definition.apiName,
          httpStatus,
          requestId,
          message: `"${definition.apiName}" failed with HTTP ${httpStatus}: ${snippet(body) || '(empty body)'}`,
        }),
        body
      );
    }

    this.notify(definition.apiName, displayUrl, started, true, httpStatus);
    return {
      ok: true,
      data: decodeObject(parsed, definition.response) as TResponse,
      requestId,
      httpStatus,
      rawBody: body,
    };
  }

  private prepare(
    definition: ApiDefinition<unknown, unknown>,
    params: unknown,
    options: CallOptions
  ): PreparedRequest {
    const protocol: Protocol = options.protocol ?? definition.protocol;
    assertSafeApiName(definition.apiName, protocol);
    const httpMethod = (
      options.httpMethod ?? definition.httpMethod
    ).toUpperCase();
    const accessToken = options.accessToken ?? this.#accessToken;

    const { fields, files } = encodeParams(
      params as Record<string, unknown> | undefined,
      definition.params
    );

    const common: Record<string, string> = {
      app_key: this.#appKey,
      timestamp: String(options.timestamp ?? Date.now()),
      sign_method: 'sha256',
      partner_id: PARTNER_ID,
    };
    let signPrefix = '';
    let path: string;
    if (protocol === 'gop') {
      if (accessToken) common.access_token = accessToken;
      signPrefix = definition.apiName;
      path = `/rest${definition.apiName}`;
    } else {
      common.v = '2.0';
      common.method = definition.apiName;
      common.format = 'json';
      common.simplify = 'true';
      if (accessToken) common.session = accessToken;
      path = '/sync';
    }
    common.sign = signRequest(
      signPrefix,
      { ...common, ...fields },
      this.#appSecret
    );

    const hasFiles = Object.keys(files).length > 0;
    const isPost = httpMethod === 'POST' || hasFiles;
    const queryFields = isPost ? common : { ...common, ...fields };
    const target = new URL(`${this.#baseUrl}${path}`);
    for (const [name, value] of Object.entries(queryFields)) {
      target.searchParams.append(name, value);
    }
    const url = target.toString();
    const displayUrl = `${this.#baseUrl}${path}${protocol === 'top' ? `?method=${definition.apiName}` : ''}`;

    const headers: Record<string, string> = { Accept: 'application/json' };

    if (!isPost) {
      return {
        url,
        displayUrl,
        init: { method: 'GET', headers, redirect: 'error' },
      };
    }
    if (hasFiles) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields))
        form.append(name, value);
      for (const [name, file] of Object.entries(files)) {
        form.append(name, toBlob(file), file.fileName);
      }
      return {
        url,
        displayUrl,
        init: { method: 'POST', headers, body: form, redirect: 'error' },
      };
    }
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return {
      url,
      displayUrl,
      init: {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields).toString(),
        redirect: 'error',
      },
    };
  }

  private notify(
    apiName: string,
    url: string,
    started: number,
    ok: boolean,
    httpStatus?: number,
    errorMessage?: string
  ): void {
    try {
      this.#onRequest?.({
        apiName,
        url,
        durationMs: Date.now() - started,
        httpStatus,
        ok,
        errorMessage,
      });
    } catch {
      // A faulty observer must never break an API call.
    }
  }

  /**
   * Attaches `client.<namespace>.<method>` accessors. Bound methods are built
   * lazily the first time a namespace is touched.
   */
  protected bindNamespaces(
    registry: Readonly<Record<string, Readonly<Record<string, ApiDefinition>>>>
  ): void {
    for (const [namespace, definitions] of Object.entries(registry)) {
      let bound: Record<string, unknown> | undefined;
      Object.defineProperty(this, namespace, {
        enumerable: false,
        get: (): Record<string, unknown> => {
          if (!bound) {
            bound = {};
            for (const [method, definition] of Object.entries(definitions)) {
              bound[method] = (params?: unknown, options?: CallOptions) =>
                this.call(definition, params, options);
            }
          }
          return bound;
        },
      });
    }
  }
}
