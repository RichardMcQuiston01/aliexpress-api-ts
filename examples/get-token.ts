/**
 * Gets an AliExpress access token for testing.
 *
 *   ALIEXPRESS_APP_KEY=... ALIEXPRESS_APP_SECRET=... \
 *   ALIEXPRESS_REDIRECT_URI=https://your-callback.example/callback \
 *   npm run get-token
 *
 * Steps: open the printed login link, approve the app, then paste the address
 * the browser ends up on (or just the `code`) back into this terminal.
 * ALIEXPRESS_REDIRECT_URI must exactly match the callback URL registered for
 * the app. Optional: ALIEXPRESS_BASE_URL.
 *
 * When using the published package, import from
 * '@richardmcquiston01/unofficial-aliexpress-api' instead of '../src/index.js'.
 */
import { createInterface } from 'node:readline/promises';
import { AliExpressClient, generateOAuthState } from '../src/index.js';
import { parseCallback } from './callback.js';

function requireEnv(name: string): string | undefined {
  const value: string | undefined = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

async function main(): Promise<number> {
  const appKey: string | undefined = requireEnv('ALIEXPRESS_APP_KEY');
  const appSecret: string | undefined = requireEnv('ALIEXPRESS_APP_SECRET');
  const redirectUri: string | undefined = requireEnv('ALIEXPRESS_REDIRECT_URI');
  const missing: string[] = [
    ['ALIEXPRESS_APP_KEY', appKey],
    ['ALIEXPRESS_APP_SECRET', appSecret],
    ['ALIEXPRESS_REDIRECT_URI', redirectUri],
  ]
    .filter(([, value]) => value === undefined)
    .map(([name]) => name as string);
  if (!appKey || !appSecret || !redirectUri) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'ALIEXPRESS_REDIRECT_URI must exactly match the callback URL registered for your app.'
    );
    return 1;
  }

  let client: AliExpressClient;
  let loginUrl: string;
  const state: string = generateOAuthState();
  try {
    client = new AliExpressClient({
      appKey,
      appSecret,
      baseUrl: requireEnv('ALIEXPRESS_BASE_URL'),
    });
    loginUrl = client.getAuthorizationUrl({ redirectUri, state });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log('\n1. Open this link in a browser and approve the app:\n');
  console.log(`   ${loginUrl}\n`);
  console.log(
    '2. AliExpress will redirect to your callback URL with ?code=... added.'
  );
  console.log(
    '   Copy the full address from the browser (or just the code value).'
  );
  console.log(
    '   The code is short-lived and works once, so continue right away.\n'
  );

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const pasted: string = await prompt.question(
    'Paste the redirected URL or code: '
  );
  prompt.close();

  const parsed = parseCallback(pasted, state);
  if (!parsed.ok) {
    console.error(`\n${parsed.message}`);
    return 1;
  }
  if (!parsed.stateVerified) {
    console.warn(
      '\nWarning: a bare code was pasted, so the "state" check was skipped.'
    );
  }

  const result = await client.auth.tokenCreate({ code: parsed.code });
  if (!result.ok) {
    console.error(
      `\nToken exchange failed (${result.error.kind}): ${result.error.message}`
    );
    return 1;
  }

  const token = result.data;
  if (!token.accessToken) {
    console.error(
      '\nThe gateway answered without an access token. Raw response:\n' +
        result.rawBody
    );
    return 1;
  }
  console.log(
    '\nSuccess. Account: ' +
      (token.account ?? token.userNick ?? token.sellerId ?? 'unknown')
  );
  console.log(
    `Access token expires in: ${token.expiresIn ?? 'unknown'} seconds`
  );
  console.log(
    '\nTreat these like passwords. Do not commit them or paste them into chats:\n'
  );
  console.log(`export ALIEXPRESS_ACCESS_TOKEN='${token.accessToken}'`);
  if (token.refreshToken) {
    console.log(`export ALIEXPRESS_REFRESH_TOKEN='${token.refreshToken}'`);
  }
  console.log('\nThen run: npm run test:live');
  return 0;
}

main().then(
  (code: number) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
);
