# @richardmcquiston01/unofficial-aliexpress-api

- Author:  Richard McQuiston
- Website:  https://richardmcquiston.com/

## Overview

TypeScript based package wrapper for the AliExpress API.

## Features

- All **932** AliExpress Open Platform (IOP) API methods, fully typed (2,400+ request/response models).
- Namespaced client: `client.<namespace>.<method>()`, e.g. `client.solution.productListGet()`.
- camelCase TypeScript properties mapped to the gateway's wire names.
- Calls never throw: every call resolves to `{ ok: true, data }` or `{ ok: false, error }` with a descriptive `AliExpressError`.
- HMAC-SHA256 request signing, TOP (`/sync`) and GOP (`/rest`) protocols, multipart file uploads.
- 16-19 digit ids (order ids) stay exact: `Long` values beyond `Number.MAX_SAFE_INTEGER` are returned as strings.
- Zero runtime dependencies. ESM + CJS. Node.js 18+.

## Getting Started

### Prerequisites

- Node.js 18 or later.
- An app key and secret from the [AliExpress Open Platform](https://openservice.aliexpress.com/).
- An access token for the seller/user account (see [Authorization](#authorization)).

### Installation

```bash
npm install @richardmcquiston01/unofficial-aliexpress-api
```

### Usage

```ts
import { AliExpressClient } from '@richardmcquiston01/unofficial-aliexpress-api';

const client = new AliExpressClient({
  appKey: process.env.ALIEXPRESS_APP_KEY!,
  appSecret: process.env.ALIEXPRESS_APP_SECRET!,
  accessToken: process.env.ALIEXPRESS_ACCESS_TOKEN,
});

const result = await client.solution.productListGet({
  aeopAEProductListQuery: { currentPage: 1, pageSize: 20 },
});

if (!result.ok) {
  // e.g. AliExpress API "aliexpress.solution.product.list.get" returned an
  // error (code=IllegalAccessToken, request_id=...): The access token is invalid
  console.error(result.error.kind, result.error.message);
} else {
  console.log(result.data.result);
}
```

Namespaces and method names come from the API name: `aliexpress.solution.product.list.get` is
`client.solution.productListGet`, and `/auth/token/create` is `client.auth.tokenCreate`. Every
definition is also available through `namespaceRegistry` and `client.call(definition, params)`.

#### Authorization

```ts
const url = client.getAuthorizationUrl({ redirectUri: 'https://example.com/callback' });
// Send the seller to `url`; AliExpress redirects back with ?code=...
const token = await client.auth.tokenCreate({ code });
if (token.ok) console.log(token.data.accessToken, token.data.refreshToken);
```

#### Per-call options

```ts
await client.ds.recommendFeedGet(params, {
  accessToken: 'other-seller-token',
  timeoutMs: 10_000,
  signal: abortController.signal,
});
```

#### Errors

`result.error.kind` is one of `validation`, `network`, `timeout`, `aborted`, `http`, `parse`, `api`.
API errors expose `code`, `subCode`, `subMessage`, `errorType` and `requestId`.

#### Proxy

Pass a custom `fetch`, for example with undici:

```ts
import { ProxyAgent, fetch as undiciFetch } from 'undici';
const dispatcher = new ProxyAgent('http://proxy:8080');
const client = new AliExpressClient({
  appKey, appSecret,
  fetch: (url, init) => undiciFetch(url as string, { ...init, dispatcher } as never) as never,
});
```

### Examples

File uploads take a `FileInput`:

```ts
// Any API with a file parameter (type `FileInput`) is sent as multipart/form-data.
await client.affiliate.imageSearch({
  imageFileBytes: { fileName: 'photo.png', content: bytes, mimeType: 'image/png' },
});
```

## Regenerating the API surface

`src/generated/` is produced from AliExpress's official Java SDK (`iop-api-sdk`). To refresh it:

```bash
unzip -q gop-sdk-Java-source.jar -d sdk && unzip -q sdk/*.jar -d sdk/src
npm run generate -- --src sdk/src/src/main/java/com/aliexpress/open
```

Notes on fidelity with the Java SDK: protocol is inferred from the API name (names starting with `/`
use GOP, the rest TOP); requests whose declared method is not `POST` (including `HSF`) are sent as
`GET`, as the Java SDK does. Override with the `httpMethod` / `protocol` call options.

## Disclaimer

This is an unofficial community package. It is not affiliated with or endorsed by AliExpress or
Alibaba. The request/response models are derived from AliExpress's published Java SDK.

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

## License

Apache 2

## Copyright

(c)2026 Richard McQuiston.  All rights reserved.
