# Contributing

[Back to README](./README.md)

| [Set Up](#set-up) | [Scripts](#scripts) | [Project Layout](#project-layout) | [Rebuild the API Code](#rebuild-the-api-code) | [Publish a Release](#publish-a-release) | [Report a Problem](#report-a-problem) |

## Set Up

You need Node.js 18 or newer. Then run:

```bash
git clone https://github.com/RichardMcQuiston01/aliexpress-api-ts.git
cd aliexpress-api-ts
npm ci
npm test
```

[Back to Top](#contributing)

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Runs all tests, including one set per Application Programming Interface (API) method. Live tests are skipped. |
| `npm run test:live` | Runs the live tests. They need the environment variables in [Configuration](./CONFIGURATION.md#environment-variables). |
| `npm run typecheck` | Checks the types. |
| `npm run build` | Builds the package into `dist`. |
| `npm run format` | Formats the code with Prettier. |
| `npm run format:check` | Checks the formatting. |
| `npm run generate -- --src <folder>` | Rebuilds the code in `src/generated`. |
| `npm run get-token` | Walks through the Open Authorization (OAuth) login and prints an access token. |

Pull requests run the format check, the type check, the tests, and the build on Node.js 18, 20, and 22.

[Back to Top](#contributing)

## Project Layout

| Folder | Holds |
| --- | --- |
| `src/core` | The hand-written client: signing, requests, errors, and number handling. |
| `src/generated` | The API code. It is made by a script. Do not edit it by hand. |
| `scripts` | The script that reads the Java Software Development Kit (SDK) and writes `src/generated`. |
| `examples` | The `get-token` script. It is not part of the published package. |
| `test` | The tests. |

[Back to Top](#contributing)

## Rebuild the API Code

`src/generated` comes from the AliExpress Java SDK source. To rebuild it:

1. Unzip the SDK download, and unzip the `-source.jar` file inside it.
2. Find the folder `src/main/java/com/aliexpress/open`. It holds the `request`, `response`, and `domain` folders.
3. Run the script with that folder:

```bash
npm run generate -- --src path/to/src/main/java/com/aliexpress/open
```

The output is the same every time for the same SDK version. Run the tests after you rebuild. Commit the changed files in `src/generated`.

[Back to Top](#contributing)

## Publish a Release

1. Change the version in `package.json`, and add a section to [CHANGELOG.md](./CHANGELOG.md).
2. Merge the change into `main`.
3. Create a tag that matches the version, such as `v0.2.0`, and push it.

The publish workflow checks that the tag is on `main` and matches `package.json`. It then runs the checks and publishes to npm with the `NPM_TOKEN` secret. A tag with a dash, such as `v1.0.0-beta.1`, is published under the `next` tag instead of `latest`.

[Back to Top](#contributing)

## Report a Problem

Open an issue on [GitHub](https://github.com/RichardMcQuiston01/aliexpress-api-ts/issues). Include the API name, the error `kind` and `code`, and the `requestId`. Remove tokens and secrets first.

[Back to Top](#contributing)

---

[Back to README](./README.md)
