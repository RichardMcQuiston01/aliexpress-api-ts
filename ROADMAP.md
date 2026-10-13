# Roadmap

[Back to README](./README.md)

| [Released](#released) | [Next](#next) | [Later](#later) | [Version 1.0](#version-10) |

This roadmap is a plan, not a promise. The order can change. Ideas marked "Later" may never ship. Open an issue on [GitHub](https://github.com/RichardMcQuiston01/aliexpress-api-ts/issues) if one matters to you.

## Released

- **0.1.0:** A typed client for all 932 methods of the AliExpress Application Programming Interface (API), with namespaced access, request signing, file uploads, and clear errors.
- **0.2.0:** Security fixes for URL building, the login `state` value, credential exposure, error text, and redirects.
- **0.2.1:** A new README, four guides, and the `get-token` script. No code changes.
- **0.2.2:** English comments in the generated code. No code changes.

See the [Changelog](./CHANGELOG.md) for the details.

[Back to Top](#roadmap)

## Next

These items close the gaps in what is already built.

1. **Finish the live gateway tests.** The Affiliate calls `categoryGet` and `productQuery` now pass against the real gateway. That covers signing, TOP routing for POST calls, and response decoding. Still untested live: the other request style (names that start with `/`, such as `auth.tokenCreate`) and the seller APIs, which need an app with seller access.
2. **Confirm the login address.** The address in `getAuthorizationUrl` is not in the Java Software Development Kit (SDK), and no one has checked it against a real login yet. Run one and fix it if it is wrong.
3. **Confirm the `GET` rule.** The Java SDK sends every method that is not `POST`, including `HSF`, as a `GET`. This package copies that rule. Check that the gateway accepts it for all 66 `HSF` methods, and change the rule if it does not.

[Back to Top](#roadmap)

## Later

These are ideas. None of them has started.

- **Proofread the translations.** The English comments were machine translated and checked by script, not by a native speaker. A careful read-through would catch awkward or wrong wording.
- **Retries.** Try again after a network failure or a timeout, with a growing wait between tries. Today the client makes one attempt per call.
- **Paging helpers.** Many list methods return one page at a time. A helper could walk through every page.
- **Token refresh.** Renew an access token before it expires, so long-running programs keep working.
- **Smaller imports.** The built package is about 1.5 megabytes. Separate entry points for each namespace, such as one for `solution` only, would let apps load less code.
- **Other runtimes.** The signing code uses `node:crypto`, so the package needs Node.js. Using the Web Crypto standard would allow Deno, Bun, and edge workers.
- **Required fields.** Every parameter is optional in the types, because the Java SDK does not say which ones are required. If AliExpress publishes that data, the types could show it.
- **A sample callback server.** A small container that shows the login `code` and `state`, for people who need a public address to register their app.
- **New SDK versions.** Check for a newer Java SDK and rebuild the generated code. Today this is a manual step. See [Contributing](./CONTRIBUTING.md#rebuild-the-api-code).

[Back to Top](#roadmap)

## Version 1.0

Version 1.0 will mean the public API is stable. It needs these things first:

- The live gateway checks under "Next" are done and the fixes are released.
- The method names and result shapes have been used in real apps without changes.
- Any breaking change after 1.0 will wait for a new major version.

Until then, a minor version, such as 0.3.0, may include a breaking change. The changelog will say so.

[Back to Top](#roadmap)

---

[Back to README](./README.md)
