/**
 * Opt-in smoke tests against the real AliExpress gateway. Only read-only
 * calls are made. Run with: npm run test:live
 *
 * Environment variables:
 *
 *   ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET   Required for every live test.
 *   ALIEXPRESS_TRACKING_ID                      Optional. Sent with affiliate product queries.
 *   ALIEXPRESS_ACCESS_TOKEN                     Required for the seller tests only.
 *   ALIEXPRESS_SELLER_TESTS=1                   Turns on the seller tests.
 *   ALIEXPRESS_BASE_URL                         Optional gateway override.
 */
import { describe, expect, it } from 'vitest';
import { AliExpressClient } from '../src/index.js';

const appKey = process.env.ALIEXPRESS_APP_KEY;
const appSecret = process.env.ALIEXPRESS_APP_SECRET;
const accessToken = process.env.ALIEXPRESS_ACCESS_TOKEN;
const trackingId = process.env.ALIEXPRESS_TRACKING_ID;
const baseUrl = process.env.ALIEXPRESS_BASE_URL;
const hasAppCredentials = Boolean(appKey && appSecret);
const runSellerTests = Boolean(
  hasAppCredentials &&
  accessToken &&
  process.env.ALIEXPRESS_SELLER_TESTS === '1'
);

// Built lazily: describe callbacks run even when the suite is skipped.
const makeClient = (
  secret: string | undefined = appSecret,
  token: string | undefined = undefined
): AliExpressClient =>
  new AliExpressClient({
    appKey: appKey ?? '',
    appSecret: secret ?? '',
    accessToken: token,
    baseUrl,
    timeoutMs: 30_000,
  });

describe.skipIf(!hasAppCredentials)(
  'live AliExpress gateway: affiliate (read-only, no access token)',
  () => {
    it('affiliate.categoryGet returns a typed result', async () => {
      const result = await makeClient().affiliate.categoryGet();
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.requestId).toBeTruthy();
        expect(result.data.respResult).toBeDefined();
      }
    });

    it('affiliate.productQuery returns a typed result', async () => {
      const result = await makeClient().affiliate.productQuery({
        keywords: 'phone case',
        pageNo: 1,
        pageSize: 1,
        trackingId,
      });
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.requestId).toBeTruthy();
        expect(result.data.respResult).toBeDefined();
      }
    });

    it('affiliate.hotproductQuery returns a typed result', async () => {
      const result = await makeClient().affiliate.hotproductQuery({
        keywords: 'phone case',
        pageNo: 1,
        pageSize: 1,
        trackingId,
      });
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.requestId).toBeTruthy();
        expect(result.data.respResult).toBeDefined();
      }
    });

    it('affiliate.productdetailGet and productShippingGet accept a product id from a query', async () => {
      const client = makeClient();
      const query = await client.affiliate.productQuery({
        keywords: 'phone case',
        pageNo: 1,
        pageSize: 1,
        trackingId,
      });
      expect(query.ok, query.ok ? '' : query.error.message).toBe(true);
      if (!query.ok) return;
      const productId = query.data.respResult?.result?.products?.[0]?.productId;
      expect(productId, 'the product query returned no products').toBeDefined();
      if (productId === undefined) return;

      const detail = await client.affiliate.productdetailGet({
        productIds: String(productId),
        trackingId,
      });
      expect(detail.ok, detail.ok ? '' : detail.error.message).toBe(true);
      if (detail.ok) {
        expect(detail.data.respResult).toBeDefined();
      }

      const shipping = await client.affiliate.productShippingGet({
        productId,
        shipToCountry: 'US',
      });
      expect(shipping.ok, shipping.ok ? '' : shipping.error.message).toBe(true);
    });

    it('a request signed with a wrong secret is rejected as an api error', async () => {
      const result = await makeClient(
        'definitely-not-the-secret'
      ).affiliate.categoryGet();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Must be answered by the gateway (signature rejection), not a transport failure.
        expect(result.error.kind).toBe('api');
      }
    });
  }
);

describe.skipIf(!runSellerTests)(
  'live AliExpress gateway: seller (read-only, needs a seller access token)',
  () => {
    it('solution.productListGet returns a typed result', async () => {
      const result = await makeClient(
        appSecret,
        accessToken
      ).solution.productListGet({
        aeopAEProductListQuery: { currentPage: 1, pageSize: 1 },
      });
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.requestId).toBeTruthy();
        expect(result.data.result).toBeDefined();
      }
    });

    it('solution.sellerCategoryTreeQuery returns a typed result', async () => {
      const result = await makeClient(
        appSecret,
        accessToken
      ).solution.sellerCategoryTreeQuery({
        categoryId: 0,
        filterNoPermission: true,
      });
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    });
  }
);
