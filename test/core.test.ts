import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeObject, encodeJson, encodeParams } from '../src/core/schema.js';
import { parseJsonPreservingLongs } from '../src/core/json.js';
import { signRequest } from '../src/core/sign.js';
import type { Schema } from '../src/core/schema.js';

describe('signRequest', () => {
  it('signs prefix + sorted key/value pairs with HMAC-SHA256 (upper hex)', () => {
    const params: Record<string, string> = { b: '2', a: '1', empty: '' };
    const expected = createHmac('sha256', 'secret')
      .update('/auth/token/createa1b2')
      .digest('hex')
      .toUpperCase();
    expect(signRequest('/auth/token/create', params, 'secret')).toBe(expected);
  });

  it('uses an empty prefix for TOP requests', () => {
    const expected = createHmac('sha256', 's')
      .update('k1v')
      .digest('hex')
      .toUpperCase();
    expect(signRequest('', { k1: 'v' }, 's')).toBe(expected);
  });

  it('matches a fixed known vector', () => {
    expect(
      signRequest(
        '',
        { app_key: '12345', timestamp: '1', sign_method: 'sha256' },
        'helloworld'
      )
    ).toBe(
      createHmac('sha256', 'helloworld')
        .update('app_key12345sign_methodsha256timestamp1')
        .digest('hex')
        .toUpperCase()
    );
  });
});

describe('parseJsonPreservingLongs', () => {
  it('keeps 19-digit order ids exact as strings', () => {
    const parsed = parseJsonPreservingLongs(
      '{"id":3012345678901234567,"n":42,"s":"3012345678901234567"}'
    );
    expect(parsed).toEqual({
      id: '3012345678901234567',
      n: 42,
      s: '3012345678901234567',
    });
  });

  it('does not touch digits inside strings or decimals', () => {
    const parsed = parseJsonPreservingLongs(
      '{"t":"a 1234567890123456789 \\" b","d":1234567890123456.5}'
    );
    expect(parsed).toEqual({
      t: 'a 1234567890123456789 " b',
      d: 1234567890123456.5,
    });
  });
});

describe('schema encode/decode', () => {
  const child: Schema = { skuCode: ['sku_code', 's'], stock: ['stock', 'l'] };
  const parent: Schema = {
    productId: ['product_id', 'l'],
    skus: ['skus', '[o', () => child],
    tags: ['tag_list', '[s'],
    extra: ['extra', 'x'],
  };

  it('encodes nested objects with wire names and raw bigint digits', () => {
    const json = encodeJson(
      {
        productId: 3012345678901234567n,
        skus: [{ skuCode: 'A', stock: '10' }],
        tags: ['x'],
      },
      'o',
      () => parent
    );
    expect(json).toBe(
      '{"product_id":3012345678901234567,"skus":[{"sku_code":"A","stock":10}],"tag_list":["x"]}'
    );
  });

  it('encodes scalar params as text and complex ones as JSON', () => {
    const schema: Schema = {
      eanCode: ['ean_code', 's'],
      page: ['current_page', 'i'],
      ids: ['product_ids', '[l'],
      query: ['query', 'o', () => child],
    };
    const { fields } = encodeParams(
      { eanCode: 'e1', page: 2, ids: [1, '2'], query: { skuCode: 'S' } },
      schema
    );
    expect(fields).toEqual({
      ean_code: 'e1',
      current_page: '2',
      product_ids: '[1,2]',
      query: '{"sku_code":"S"}',
    });
  });

  it('decodes wire names, embedded JSON strings, coercions and unknown keys', () => {
    const decoded = decodeObject(
      {
        product_id: '3012345678901234567',
        skus: '[{"sku_code":"A","stock":"5"}]',
        tag_list: ['a', 1],
        extra: { k: 1 },
        brand_new_field: true,
      },
      parent
    );
    expect(decoded).toEqual({
      productId: '3012345678901234567',
      skus: [{ skuCode: 'A', stock: 5 }],
      tags: ['a', '1'],
      extra: { k: 1 },
      brand_new_field: true,
    });
  });
});
