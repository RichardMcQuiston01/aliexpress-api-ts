/**
 * Opt-in smoke tests against the real AliExpress gateway. They are skipped
 * unless these environment variables are set:
 *
 *   ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_ACCESS_TOKEN
 *
 * Only read-only calls are made. Run with: npm run test:live
 */
import { describe, expect, it } from 'vitest';
import { AliExpressClient } from '../src/index.js';

const appKey = process.env.ALIEXPRESS_APP_KEY;
const appSecret = process.env.ALIEXPRESS_APP_SECRET;
const accessToken = process.env.ALIEXPRESS_ACCESS_TOKEN;
const baseUrl = process.env.ALIEXPRESS_BASE_URL;
const hasCredentials = Boolean(appKey && appSecret && accessToken);

describe.skipIf(!hasCredentials)('live AliExpress gateway (read-only)', () => {
  // Built lazily: describe callbacks run even when the suite is skipped.
  const makeClient = (secret = appSecret): AliExpressClient =>
    new AliExpressClient({
      appKey: appKey ?? '',
      appSecret: secret ?? '',
      accessToken,
      baseUrl,
      timeoutMs: 30_000,
    });

  it('TOP: solution.productListGet returns a typed result', async () => {
    const result = await makeClient().solution.productListGet({
      aeopAEProductListQuery: { currentPage: 1, pageSize: 1 },
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (result.ok) {
      expect(result.requestId).toBeTruthy();
      expect(result.data.result).toBeDefined();
    }
  });

  it('TOP: solution.sellerCategoryTreeQuery returns a typed result', async () => {
    const result = await makeClient().solution.sellerCategoryTreeQuery({
      categoryId: 0,
      filterNoPermission: true,
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
  });

  it('a request signed with a wrong secret is rejected as an api error', async () => {
    const result = await makeClient(
      'definitely-not-the-secret'
    ).solution.productListGet();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must be answered by the gateway (signature rejection), not a transport failure.
      expect(result.error.kind).toBe('api');
    }
  });
});
