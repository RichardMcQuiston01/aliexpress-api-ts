export type AliExpressErrorKind =
  /** Bad client configuration or request parameters, detected before sending. */
  | 'validation'
  /** DNS, TLS, connection reset, or other failure to reach the gateway. */
  | 'network'
  | 'timeout'
  | 'aborted'
  /** Gateway answered with a non-2xx status that carried no API error body. */
  | 'http'
  /** The response body was not valid JSON. */
  | 'parse'
  /** The gateway returned an API-level error (`code` / `error_response`). */
  | 'api';

export interface AliExpressErrorDetails {
  readonly kind: AliExpressErrorKind;
  readonly apiName: string;
  readonly message: string;
  readonly code?: string;
  readonly subCode?: string;
  readonly subMessage?: string;
  readonly errorType?: string;
  readonly requestId?: string;
  readonly httpStatus?: number;
  readonly cause?: unknown;
}

export class AliExpressError extends Error {
  readonly kind: AliExpressErrorKind;
  readonly apiName: string;
  readonly code?: string;
  readonly subCode?: string;
  readonly subMessage?: string;
  readonly errorType?: string;
  readonly requestId?: string;
  readonly httpStatus?: number;

  constructor(details: AliExpressErrorDetails) {
    super(details.message, { cause: details.cause });
    this.name = 'AliExpressError';
    this.kind = details.kind;
    this.apiName = details.apiName;
    this.code = details.code;
    this.subCode = details.subCode;
    this.subMessage = details.subMessage;
    this.errorType = details.errorType;
    this.requestId = details.requestId;
    this.httpStatus = details.httpStatus;
  }
}

/** Builds the descriptive message used for API-level errors. */
export function describeApiError(
  apiName: string,
  fields: {
    code?: string;
    message?: string;
    subCode?: string;
    subMessage?: string;
    errorType?: string;
    requestId?: string;
  }
): string {
  const parts: string[] = [];
  if (fields.code) parts.push(`code=${fields.code}`);
  if (fields.subCode) parts.push(`sub_code=${fields.subCode}`);
  if (fields.errorType) parts.push(`type=${fields.errorType}`);
  if (fields.requestId) parts.push(`request_id=${fields.requestId}`);
  const detail = [fields.message, fields.subMessage]
    .filter((text): text is string => Boolean(text))
    .join(' - ');
  return (
    `AliExpress API "${apiName}" returned an error` +
    (parts.length > 0 ? ` (${parts.join(', ')})` : '') +
    (detail ? `: ${detail}` : '')
  );
}
