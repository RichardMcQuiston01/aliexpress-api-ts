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

function snippet(text: string): string {
  const flattened = text.replace(/\s+/g, ' ').trim();
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
  protected readonly config: Required<
    Pick<ClientConfig, 'appKey' | 'appSecret' | 'timeoutMs'>
  > &
    ClientConfig;
  protected readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

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
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError(
        'AliExpressClient: no global fetch found (Node.js 18+ is required). Pass a "fetch" implementation in the client config.'
      );
    }
  }

  /**
   * Builds the URL a seller visits to authorise your app. The redirect receives
   * a `code` to exchange with `client.auth.tokenCreate({ code })`.
   */
  getAuthorizationUrl(options: {
    readonly redirectUri: string;
    readonly state?: string;
    readonly forceAuth?: boolean;
  }): string {
    const query = new URLSearchParams({
      response_type: 'code',
      force_auth: String(options.forceAuth ?? true),
      redirect_uri: options.redirectUri,
      client_id: this.config.appKey,
    });
    if (options.state) query.set('state', options.state);
    return `${this.baseUrl}/oauth/authorize?${query.toString()}`;
  }

  /** Executes any API definition. Never rejects; inspect `result.ok`. */
  async call<TParams, TResponse>(
    definition: ApiDefinition<TParams, TResponse>,
    params?: TParams,
    options: CallOptions = {}
  ): Promise<ApiResult<TResponse>> {
    const started = Date.now();
    let displayUrl = `${this.baseUrl}/${definition.apiName}`;
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

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = combineSignals(timeoutSignal, options.signal);

    let body: string;
    try {
      const response = await this.fetchImpl(prepared.url, {
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
      const reason = cause instanceof Error ? cause.message : String(cause);
      const detail =
        cause instanceof Error && cause.cause instanceof Error
          ? ` (${cause.cause.message})`
          : '';
      return fail(
        new AliExpressError({
          kind: 'network',
          apiName: definition.apiName,
          message: `Network error calling "${definition.apiName}" at ${this.baseUrl}: ${reason}${detail}`,
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
    const httpMethod = (
      options.httpMethod ?? definition.httpMethod
    ).toUpperCase();
    const accessToken = options.accessToken ?? this.config.accessToken;

    const { fields, files } = encodeParams(
      params as Record<string, unknown> | undefined,
      definition.params
    );

    const common: Record<string, string> = {
      app_key: this.config.appKey,
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
      this.config.appSecret
    );

    const hasFiles = Object.keys(files).length > 0;
    const isPost = httpMethod === 'POST' || hasFiles;
    const queryFields = isPost ? common : { ...common, ...fields };
    const query = new URLSearchParams(queryFields).toString();
    const url = `${this.baseUrl}${path}${protocol === 'top' ? '?method=' + definition.apiName + '&' : '?'}${query}`;
    const displayUrl = `${this.baseUrl}${path}?method=${definition.apiName}`;

    const headers: Record<string, string> = { Accept: 'application/json' };

    if (!isPost) {
      return { url, displayUrl, init: { method: 'GET', headers } };
    }
    if (hasFiles) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields))
        form.append(name, value);
      for (const [name, file] of Object.entries(files)) {
        form.append(name, toBlob(file), file.fileName);
      }
      return { url, displayUrl, init: { method: 'POST', headers, body: form } };
    }
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return {
      url,
      displayUrl,
      init: {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields).toString(),
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
      this.config.onRequest?.({
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
        enumerable: true,
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
