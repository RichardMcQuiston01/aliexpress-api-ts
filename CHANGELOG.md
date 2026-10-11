# CHANGELOG

[Back to README](./README.md)

| [Unreleased](#unreleased) | [0.2.1](#021) | [0.2.0](#020) | [0.1.0](#010) |

## Unreleased

- Translate the Chinese field comments in the generated code to English (5,581 unique comments, 12,717 lines). Only comment text changed; no types or code changed.
- The generator now reads `scripts/translations/zh-en.json` and has a `--strict` flag that fails on untranslated comments.
- Fill in `ROADMAP.md`. No code changes.

[Back to Top](#changelog)

## 0.2.1

- Add `npm run get-token` (`examples/get-token.ts`), a CLI that performs the OAuth login and prints an access token for testing.
- Rewrite the README and add the Getting Started, API, Configuration and Contributing guides. No code changes.

[Back to Top](#changelog)

## 0.2.0

Security hardening (fixes #3, #4, #5, #6, #7).

- **Breaking:** `getAuthorizationUrl()` now requires `state`; use the new `generateOAuthState()`.
  `redirectUri` must be an absolute `https` URL without credentials (loopback `http` allowed).
- `baseUrl` is validated: `https` only (loopback `http` allowed), no userinfo, query or fragment.
- Request URLs are built with the `URL` API; the duplicate raw `method` query value is gone and
  API names containing URL syntax are rejected before sending.
- `appSecret`, `accessToken` and the other config are private fields and namespaces are
  non-enumerable, so serialising or logging a client no longer leaks credentials.
- Transport error messages no longer embed the request URL; `error.cause` keeps the raw error.
  Credentials echoed in gateway error bodies are redacted from messages.
- Requests use `redirect: 'error'`; a redirect is reported as an `http` failure.

Also in this release:

- Data-driven tests for all 932 endpoints (definition sanity, request building and signing, response round-trip).
- Opt-in live smoke tests (`npm run test:live`).
- Fix: `FileItem` fields nested in response/domain models (an SDK quirk) are now typed `unknown` instead of `FileInput`.

[Back to Top](#changelog)

## 0.1.0

- Initial release: typed client for all 932 IOP API methods with namespaced access.
- Signing, TOP/GOP protocols, multipart uploads, big-integer-safe parsing, typed errors.

[Back to Top](#changelog)

---

[Back to README](./README.md)
