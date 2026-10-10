export { AliExpressClientBase } from './client.js';
export { AliExpressError, describeApiError } from './errors.js';
export type { AliExpressErrorKind, AliExpressErrorDetails } from './errors.js';
export { signRequest } from './sign.js';
export { parseJsonPreservingLongs } from './json.js';
export type {
  ApiDefinition,
  ApiFailure,
  ApiResult,
  ApiSuccess,
  BoundApis,
  CallOptions,
  ClientConfig,
  FileInput,
  Long,
  LongInput,
  Protocol,
  RequestEvent,
} from './types.js';
export type { FieldSpec, ParamSchema, Schema, TypeCode } from './schema.js';
