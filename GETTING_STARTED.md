# Getting Started Guide

[Back to README](./README.md)

| [Before You Begin](#before-you-begin) | [Register Your App](#register-your-app) | [Log In a Seller](#log-in-a-seller) | [Use the Token](#use-the-token) | [Run the Live Tests](#run-the-live-tests) | [Build a Callback Page](#build-a-callback-page) |

## Before You Begin

You need three things:

- Node.js 18 or newer.
- A developer account on the [AliExpress Open Platform](https://openservice.aliexpress.com/).
- A public web address that can receive the login redirect. This is called the callback Uniform Resource Locator (URL).

AliExpress does not accept `localhost` addresses as a callback URL. Use a public HTTPS address. HTTPS means Hypertext Transfer Protocol Secure. A tunnel tool or a small hosted page both work. See [Build a Callback Page](#build-a-callback-page).

[Back to Top](#getting-started-guide)

## Register Your App

1. Open the developer console and create an app.
2. Copy the app key and the app secret. Keep the secret private.
3. Register your callback URL for the app.

You will use the same callback URL in the next step. It must match exactly.

[Back to Top](#getting-started-guide)

## Log In a Seller

Many calls to the Application Programming Interface (API) act on a seller's account. For those calls, the seller must approve your app first. This uses a login standard called OAuth (Open Authorization).

The fastest way is the script in this repository. Clone the repository, run `npm ci`, and then run:

```bash
ALIEXPRESS_APP_KEY=your-key \
ALIEXPRESS_APP_SECRET=your-secret \
ALIEXPRESS_REDIRECT_URI=https://your-callback.example/callback \
npm run get-token
```

The script does these steps:

1. It prints a login link. The link holds a random `state` value.
2. You open the link in a browser and approve the app.
3. AliExpress sends the browser to your callback URL with `?code=...` added.
4. You paste that full address, or just the code, into the terminal.
5. The script checks the `state`, trades the code for a token, and prints it.

Codes usually expire fast and work only once. Paste yours right away.

You can also do the same steps in your own code:

```ts
import {
  AliExpressClient,
  generateOAuthState,
} from '@richardmcquiston01/unofficial-aliexpress-api';

const client = new AliExpressClient({ appKey, appSecret });

// Step 1: send the seller to the login page.
const state = generateOAuthState();
saveInSession('oauthState', state);
const loginUrl = client.getAuthorizationUrl({
  redirectUri: 'https://your-callback.example/callback',
  state,
});

// Step 2: on your callback, check the state, then trade the code.
if (receivedState !== loadFromSession('oauthState')) {
  throw new Error('The state does not match. Do not use this code.');
}
const token = await client.auth.tokenCreate({ code: receivedCode });
```

The `state` value protects you from cross-site request forgery. This is a trick where another site starts a login on your behalf. Always check it before you use the code.

[Back to Top](#getting-started-guide)

## Use the Token

Treat tokens like passwords. Do not save them in Git or paste them into chats.

Pass the token to the client:

```ts
import { AliExpressClient } from '@richardmcquiston01/unofficial-aliexpress-api';

const client = new AliExpressClient({
  appKey,
  appSecret,
  accessToken: process.env.ALIEXPRESS_ACCESS_TOKEN,
});
```

Or pass it for one call:

```ts
await client.solution.productListGet(params, { accessToken: sellerToken });
```

Tokens expire. The token response includes a refresh token. Use it to get a new access token:

```ts
const refreshed = await client.auth.tokenRefresh({ refreshToken });
```

[Back to Top](#getting-started-guide)

## Run the Live Tests

The normal tests use a mock gateway. The live tests call the real AliExpress gateway. They are off unless you set three environment variables:

```bash
export ALIEXPRESS_APP_KEY=your-key
export ALIEXPRESS_APP_SECRET=your-secret
export ALIEXPRESS_ACCESS_TOKEN=token-from-get-token
npm run test:live
```

The live tests make three read-only calls:

- `solution.productListGet`
- `solution.sellerCategoryTreeQuery`
- One call signed with a wrong secret. It should come back as an API error, not a network error.

If a live test fails, the error message names the API and the error code. Start there.

[Back to Top](#getting-started-guide)

## Build a Callback Page

The callback page can be very simple. Its only job is to show you the `code` and the `state` from the address.

A few tips:

- Serve it over HTTPS.
- Do not write the query string to your logs. The code works like a password until it is used.
- Do not keep the app secret on the page. The page does not need it.
- Keep the `state` check in the script or in your app. A static page cannot do that check.

[Back to Top](#getting-started-guide)

---

[Back to README](./README.md)
