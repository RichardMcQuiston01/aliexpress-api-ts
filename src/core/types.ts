import type { AliExpressError } from './errors.js';
import type { ParamSchema, Schema } from './schema.js';

/**
 * A Java `Long` returned by the API. It is a `number` unless the value exceeds
 * `Number.MAX_SAFE_INTEGER` (common for order ids), in which case it is the
 * exact decimal `string` so no precision is lost.
 */
export type Long = number | string;

/** A `Long` accepted as request input. */
export type LongInput = number | string | bigint;

/** A file to upload with a multipart request. */
export interface FileInput {
  readonly fileName: string;
  readonly content: Uint8Array | Blob;
  /** Defaults to `application/octet-stream`. */
  readonly mimeType?: string;
}

/**
 * `top`: business APIs (`aliexpress.*`) sent to `/sync`.
 * `gop`: system/REST-style APIs (names starting with `/`) sent to `/rest`.
 */
export type Protocol = 'top' | 'gop';

export interface ApiDefinition<TParams = unknown, TResponse = unknown> {
  readonly apiName: string;
  readonly protocol: Protocol;
  /** `POST` or `GET`. Anything other than `POST` is sent as `GET`, as in the Java SDK. */
  readonly httpMethod: string;
  readonly params: ParamSchema;
  readonly response: Schema;
  /** Phantom property that carries the parameter/response types. Never set. */
  readonly types?: { readonly params: TParams; readonly response: TResponse };
}

export interface ClientConfig {
  readonly appKey: string;
  readonly appSecret: string;
  /**
   * Defaults to `https://api-sg.aliexpress.com`. Must be https (http only for
   * localhost) and must not contain credentials, a query or a fragment.
   */
  readonly baseUrl?: string;
  /** Default access token (seller/user authorization) for every call. */
  readonly accessToken?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  readonly timeoutMs?: number;
  /** Custom `fetch`, e.g. one backed by an undici `ProxyAgent`. */
  readonly fetch?: typeof fetch;
  /** Called after every request with a redacted summary. Never throws into the client. */
  readonly onRequest?: (event: RequestEvent) => void;
}

export interface CallOptions {
  readonly accessToken?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Force a protocol instead of inferring it from the API name. */
  readonly protocol?: Protocol;
  /** Override the HTTP method (`GET` or `POST`). */
  readonly httpMethod?: 'GET' | 'POST';
  /** Millisecond epoch timestamp to sign with; defaults to `Date.now()`. */
  readonly timestamp?: number;
}

export interface RequestEvent {
  readonly apiName: string;
  readonly url: string;
  readonly durationMs: number;
  readonly httpStatus?: number;
  readonly ok: boolean;
  readonly errorMessage?: string;
}

export interface ApiSuccess<TResponse> {
  readonly ok: true;
  readonly data: TResponse;
  readonly requestId?: string;
  readonly httpStatus: number;
  readonly rawBody: string;
}

export interface ApiFailure {
  readonly ok: false;
  readonly error: AliExpressError;
  readonly httpStatus?: number;
  readonly rawBody?: string;
}

/** Every client call resolves to this; calls never reject. Check `ok`. */
export type ApiResult<TResponse> = ApiSuccess<TResponse> | ApiFailure;

/** Maps a generated `{ name: ApiDefinition }` record to bound client methods. */
export type BoundApis<TApis> = {
  readonly [K in keyof TApis]: TApis[K] extends ApiDefinition<
    infer TParams,
    infer TResponse
  >
    ? (params?: TParams, options?: CallOptions) => Promise<ApiResult<TResponse>>
    : never;
};
