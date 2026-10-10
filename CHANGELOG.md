# CHANGELOG

## Unreleased

- Data-driven tests for all 932 endpoints (definition sanity, request building and signing, response round-trip).
- Opt-in live smoke tests (`npm run test:live`).
- Fix: `FileItem` fields nested in response/domain models (an SDK quirk) are now typed `unknown` instead of `FileInput`.

## 0.1.0

- Initial release: typed client for all 932 IOP API methods with namespaced access.
- Signing, TOP/GOP protocols, multipart uploads, big-integer-safe parsing, typed errors.
