# @richardmcquiston01/unofficial-aliexpress-api

- Author: [Richard McQuiston](mailto:richard.mcquiston@gmail.com)
- Website: https://richardmcquiston.com/

## Table of Contents

| [Overview](#overview) | [Features](#features) | [Getting Started](#getting-started) | [More Information](#more-information) | [Buy Me a Coffee](#buy-me-a-coffee) | [License](#license) | [Copyright](#copyright) |

## Overview

This is an unofficial TypeScript client for the AliExpress Open Platform. It lets your code call the AliExpress Application Programming Interface (API) with full type hints.

It covers all 932 API methods from the AliExpress Java Software Development Kit (SDK). The methods are grouped into 83 namespaces, such as `client.solution` and `client.auth`.

This package is not made by, or tied to, AliExpress or Alibaba. Its models come from version 1.3.5-ae of the Java SDK.

The tests use a mock gateway. Live tests also exist, but you run them yourself with your own app key. See the [Getting Started Guide](./GETTING_STARTED.md).

[Back to Top](#table-of-contents)

## Features

- All 932 API methods, with typed requests and responses.
- Simple names, such as `client.solution.productListGet()`.
- Calls never throw. Each call returns `{ ok: true, data }` or `{ ok: false, error }`.
- Clear error messages that name the API, the error code, and the request ID.
- Request signing is done for you.
- Supports both request styles that the Java SDK uses, and file uploads.
- Big numbers, such as order identifiers (IDs), stay exact.
- No runtime dependencies. Works with both `import` and `require`.

[Back to Top](#table-of-contents)

## Getting Started

### Prerequisites

- Node.js 18 or newer.
- An app key and an app secret from the [AliExpress Open Platform](https://openservice.aliexpress.com/).
- An access token for calls that act on a seller's account. The [Getting Started Guide](./GETTING_STARTED.md) shows how to get one.

### Installation

```bash
npm install @richardmcquiston01/unofficial-aliexpress-api
```

### Usage

Create a client, call a method, and check `ok` before you use the data.

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
  console.error(result.error.kind, result.error.message);
} else {
  console.log(result.data.result);
}
```

A method name comes from the API name. The API `aliexpress.solution.product.list.get` becomes `client.solution.productListGet`. The API `/auth/token/create` becomes `client.auth.tokenCreate`. See the [API Guide](./API.md) for the full rules.

### Examples

List the top seller categories:

```ts
const categories = await client.solution.sellerCategoryTreeQuery({
  categoryId: 0,
  filterNoPermission: true,
});
```

Trade a login code for an access token:

```ts
const token = await client.auth.tokenCreate({ code: 'CODE_FROM_THE_CALLBACK' });
if (token.ok) {
  console.log(token.data.accessToken, token.data.refreshToken);
}
```

Upload a file. Any API with a file field sends the request as a multipart form:

```ts
await client.affiliate.imageSearch({
  imageFileBytes: { fileName: 'photo.png', content: bytes, mimeType: 'image/png' },
});
```

Set a timeout or a different token for one call:

```ts
await client.solution.productListGet(params, {
  accessToken: 'another-seller-token',
  timeoutMs: 10_000,
});
```

[Back to Top](#table-of-contents)

## More Information

- [Getting Started Guide](./GETTING_STARTED.md): create an app, log in a seller, and get a token.
- [API Guide](./API.md): method names, results, errors, and number types.
- [Configuration](./CONFIGURATION.md): client options, call options, proxies, and security notes.
- [Contributing](./CONTRIBUTING.md): run the tests, rebuild the API code, and publish a release.
- [Changelog](./CHANGELOG.md): what changed in each version.

[Back to Top](#table-of-contents)

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

[Back to Top](#table-of-contents)

## License

Apache 2

[Back to Top](#table-of-contents)

## Copyright

(c)2026 Richard McQuiston. All rights reserved.

[Back to Top](#table-of-contents)
