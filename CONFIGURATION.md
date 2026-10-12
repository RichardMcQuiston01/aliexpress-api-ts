# Configuration

[Back to README](./README.md)

| [Client Options](#client-options) | [Call Options](#call-options) | [Use a Proxy](#use-a-proxy) | [Watch Requests](#watch-requests) | [Security Notes](#security-notes) | [Environment Variables](#environment-variables) |

## Client Options

Pass these to `new AliExpressClient({ ... })`.

| Option | Required | Meaning |
| --- | --- | --- |
| `appKey` | Yes | Your app key. |
| `appSecret` | Yes | Your app secret. It signs every request. |
| `accessToken` | No | The default seller token for every call. |
| `baseUrl` | No | The gateway address. The default is `https://api-sg.aliexpress.com`. |
| `timeoutMs` | No | How long to wait for a reply, in milliseconds. The default is 30000. |
| `fetch` | No | Your own `fetch` function. |
| `onRequest` | No | A function that is called after each request. |

The constructor throws a `TypeError` if the app key or secret is missing, or if `baseUrl` is not valid. `getAuthorizationUrl` also throws a `TypeError` for a bad `state` or redirect address. These mistakes are in your setup code, so the messages say what to fix. Calls to the Application Programming Interface (API) never throw.

[Back to Top](#configuration)

## Call Options

Pass these as the second argument of any method.

| Option | Meaning |
| --- | --- |
| `accessToken` | Use this token for this call only. |
| `timeoutMs` | Use this timeout for this call only. |
| `signal` | An `AbortSignal`. Aborting it stops the call with kind `aborted`. |
| `protocol` | Force `'top'` or `'gop'`. See the [API Guide](./API.md#request-styles). |
| `httpMethod` | Force `'GET'` or `'POST'`. |
| `timestamp` | The time to sign with, in milliseconds. This is useful in tests. |

[Back to Top](#configuration)

## Use a Proxy

The client uses the global `fetch` of Node.js. To send requests through a proxy, install the `undici` package and set its global dispatcher once, at start-up:

```ts
import { ProxyAgent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new ProxyAgent('http://proxy.example:8080'));
```

This was tested with `undici` version 6 on Node.js 22. You can also pass your own `fetch` function in the client options.

[Back to Top](#configuration)

## Watch Requests

Use `onRequest` to log timing and results. It never receives your token or the full Uniform Resource Locator (URL).

```ts
import { AliExpressClient } from '@richardmcquiston01/unofficial-aliexpress-api';

const client = new AliExpressClient({
  appKey,
  appSecret,
  onRequest: (event) => {
    console.log(event.apiName, event.ok, event.httpStatus, `${event.durationMs} ms`);
  },
});
```

If your function throws, the error is ignored, so it can never break a call.

[Back to Top](#configuration)

## Security Notes

- `baseUrl` must use `https`. Plain `http` is allowed only for `localhost`, `127.0.0.1`, and `[::1]`. It cannot hold a user name, a password, a query, or a fragment.
- `getAuthorizationUrl` needs a `state` value and an `https` redirect address. Use `generateOAuthState()`.
- Your app secret and token live in private fields. They do not show up in `JSON.stringify(client)`, `Object.keys(client)`, or most loggers.
- The client refuses Hypertext Transfer Protocol (HTTP) redirects. A redirect would resend your request body, including codes and tokens, to a new address. A refused redirect comes back as an `http` error.
- Error messages never include the request URL. The original error is on `error.cause`, and it may include the URL. Do not log `error.cause` or `rawBody` where others can read them.
- Names with odd characters, such as `&` or `?`, are rejected before anything is sent.

[Back to Top](#configuration)

## Environment Variables

The package itself reads no environment variables. The scripts and live tests in the repository do.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `ALIEXPRESS_APP_KEY` | `get-token`, live tests | Your app key. |
| `ALIEXPRESS_APP_SECRET` | `get-token`, live tests | Your app secret. |
| `ALIEXPRESS_ACCESS_TOKEN` | seller live tests | A seller access token. |
| `ALIEXPRESS_SELLER_TESTS` | live tests | Set to `1` to run the seller tests. |
| `ALIEXPRESS_TRACKING_ID` | live tests | Optional. Sent with affiliate product queries. |
| `ALIEXPRESS_REDIRECT_URI` | `get-token` | Your registered callback URL. |
| `ALIEXPRESS_BASE_URL` | `get-token`, live tests | Optional. Replaces the default gateway. |

[Back to Top](#configuration)

---

[Back to README](./README.md)
