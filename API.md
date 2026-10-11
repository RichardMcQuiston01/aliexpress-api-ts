# API Guide

[Back to README](./README.md)

| [Find a Method](#find-a-method) | [Call a Method](#call-a-method) | [Results](#results) | [Errors](#errors) | [Number Types](#number-types) | [Field Names](#field-names) | [File Uploads](#file-uploads) | [Request Styles](#request-styles) | [Use a Definition Directly](#use-a-definition-directly) |

## Find a Method

Every method is named from its AliExpress Application Programming Interface (API) name. Follow these rules:

1. Drop a leading `/`. Treat each `/` and `.` as a break between words.
2. Drop a leading `aliexpress` word.
3. The first word that is left is the namespace.
4. The rest becomes the method name in camelCase.

| API name | Call |
| --- | --- |
| `aliexpress.solution.product.list.get` | `client.solution.productListGet()` |
| `/auth/token/create` | `client.auth.tokenCreate()` |
| `/auth/token/refresh` | `client.auth.tokenRefresh()` |
| `aliexpress.affiliate.image.search` | `client.affiliate.imageSearch()` |
| `/ds/recommend/feed/get` | `client.ds.recommendFeedGet()` |
| `aliexpress.ds.recommend.feed.get` | `client.ds.aliexpressDsRecommendFeedGet()` |

The last two rows show an exception. Both APIs would be named `recommendFeedGet`. When two APIs would get the same name, one of them keeps its full name. Your editor's auto-complete shows the real names.

Each type in the generated code starts with the AliExpress class name. For example, the parameters for `productListGet` are `AliexpressSolutionProductListGetParams`. The response is `AliexpressSolutionProductListGetResponse`.

[Back to Top](#api-guide)

## Call a Method

Every method takes two optional arguments: the parameters and the call options.

```ts
const result = await client.solution.productListGet(
  { aeopAEProductListQuery: { currentPage: 1 } },
  { timeoutMs: 10_000 }
);
```

All parameters are optional in the types. The gateway decides which ones it requires. Read the comments in the types for each field. See [Configuration](./CONFIGURATION.md) for the call options.

[Back to Top](#api-guide)

## Results

A call never throws. It always gives back one of two shapes.

On success:

| Field | Meaning |
| --- | --- |
| `ok` | Always `true`. |
| `data` | The typed response. |
| `requestId` | The request ID from the gateway, if there is one. |
| `httpStatus` | The Hypertext Transfer Protocol (HTTP) status code. |
| `rawBody` | The exact text the gateway sent. |

On failure:

| Field | Meaning |
| --- | --- |
| `ok` | Always `false`. |
| `error` | An `AliExpressError`. See below. |
| `httpStatus` | The HTTP status code, if a response arrived. |
| `rawBody` | The response text, if a response arrived. |

Check `ok` first. TypeScript then knows which fields exist.

```ts
const result = await client.solution.productListGet();
if (!result.ok) {
  console.error(result.error.message);
  return;
}
console.log(result.data);
```

The `rawBody` field is not cleaned up. It may hold sensitive data, so handle it with care.

[Back to Top](#api-guide)

## Errors

`result.error` is an `AliExpressError`. Its `kind` field tells you what went wrong.

| Kind | Meaning |
| --- | --- |
| `validation` | The request could not be built. For example, an API name had odd characters. Nothing was sent. |
| `network` | The gateway could not be reached. The message may include a code such as `ENOTFOUND`. |
| `timeout` | The call took longer than the timeout. |
| `aborted` | Your `AbortSignal` stopped the call. |
| `http` | The gateway sent an error status with no API error in it, or it tried to redirect. |
| `parse` | The reply was not valid JavaScript Object Notation (JSON). |
| `api` | The gateway sent an API error. |

API errors also fill in `code`, `subCode`, `subMessage`, `errorType`, and `requestId`. The message names the API and lists them, so you can search the AliExpress docs for the code.

The message never holds the request Uniform Resource Locator (URL), because the URL contains your access token. The original error is on `error.cause`. Credentials that a gateway echoes back in an error page are replaced with `[redacted]` in the message.

[Back to Top](#api-guide)

## Number Types

AliExpress uses 64-bit numbers for identifiers (IDs). A JavaScript `number` is exact only up to 9,007,199,254,740,991. Order IDs can be longer than that.

This package handles it this way:

- In a response, a `Long` value is a `number` when it is safe. If it is too big, it is a `string` with the exact digits.
- In a request, a top-level `Long` field accepts a `number`, a `string`, or a `bigint`. A field inside a nested object accepts a `number` or a `string`.

The response type is `number | string`, and the package exports it as `Long`.

[Back to Top](#api-guide)

## Field Names

TypeScript properties use camelCase, such as `currentPage`. The package converts them to the names the gateway expects, such as `current_page`. You never write the gateway names.

If the gateway returns a field the types do not list, the field is kept as it came. New fields do not disappear.

[Back to Top](#api-guide)

## File Uploads

A field of type `FileInput` is a file upload. The request is sent as a multipart form.

```ts
import type { FileInput } from '@richardmcquiston01/unofficial-aliexpress-api';

const file: FileInput = {
  fileName: 'photo.png',
  content: bytes, // Uint8Array or Blob
  mimeType: 'image/png', // optional
};
```

The Java Software Development Kit (SDK) declares a few file fields inside response models by mistake. This package types those as `unknown`.

[Back to Top](#api-guide)

## Request Styles

The Java SDK has two request styles. Their names, `TOP` and `GOP`, come from that SDK.

| Style | Used for | Sent to |
| --- | --- | --- |
| TOP | Names like `aliexpress.solution.product.list.get` | `/sync`, with a `method` value |
| GOP | Names that start with `/`, like `/auth/token/create` | `/rest` plus the API name |

The package picks the style from the API name. It signs each request with a Hash-based Message Authentication Code (HMAC-SHA256) of the sorted parameters. The code is made with your app secret.

The Java SDK sends a request as `POST` only when the API says `POST`. Anything else, including `HSF`, goes out as `GET`. This package does the same. A request that has a file is always a `POST`. You can change either choice for one call:

```ts
await client.solution.productListGet(params, { protocol: 'top', httpMethod: 'POST' });
```

[Back to Top](#api-guide)

## Use a Definition Directly

Each API is also a plain object. You can read it or pass it to `client.call`.

```ts
import { solutionApis } from '@richardmcquiston01/unofficial-aliexpress-api';

console.log(solutionApis.productListGet.apiName);
const result = await client.call(solutionApis.productListGet, params);
```

The package also exports `namespaceRegistry`, which holds every namespace.

[Back to Top](#api-guide)

---

[Back to README](./README.md)
