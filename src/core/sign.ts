import { createHmac } from 'node:crypto';

/**
 * Signs an IOP request: HMAC-SHA256 over `prefix + sorted(key + value)...`,
 * returned as upper-case hex. Empty keys/values are skipped, matching the
 * Java SDK. `prefix` is the API path for GOP and the empty string for TOP.
 */
export function signRequest(
  prefix: string,
  params: Readonly<Record<string, string>>,
  appSecret: string
): string {
  let payload = prefix;
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (key !== '' && value !== undefined && value !== '') {
      payload += key + value;
    }
  }
  return createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex')
    .toUpperCase();
}
