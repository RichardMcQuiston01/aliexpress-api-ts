/**
 * Parses what a seller pastes after approving the app: either the full
 * redirected URL (preferred, so `state` can be verified) or a bare code.
 */
export type CallbackResult =
  | {
      readonly ok: true;
      readonly code: string;
      readonly stateVerified: boolean;
    }
  | { readonly ok: false; readonly message: string };

function queryOf(input: string): URLSearchParams | undefined {
  try {
    return new URL(input).searchParams;
  } catch {
    // Not an absolute URL. Accept "?code=..&state=.." or "code=..&state=..".
    if (input.includes('=')) {
      return new URLSearchParams(input.replace(/^\?/, ''));
    }
    return undefined;
  }
}

export function parseCallback(
  rawInput: string,
  expectedState: string
): CallbackResult {
  const input: string = rawInput.trim();
  if (input === '') {
    return {
      ok: false,
      message: 'Nothing was pasted. Paste the full redirected URL or the code.',
    };
  }

  const query: URLSearchParams | undefined = queryOf(input);
  if (!query) {
    // A bare code cannot be checked against `state`.
    return { ok: true, code: input, stateVerified: false };
  }

  const providerError: string | null = query.get('error');
  if (providerError) {
    const detail: string =
      query.get('error_description') ?? 'no description given';
    return {
      ok: false,
      message: `AliExpress returned an error instead of a code: ${providerError} (${detail}).`,
    };
  }

  const code: string | null = query.get('code');
  if (!code) {
    return {
      ok: false,
      message:
        'The pasted URL has no "code" parameter. Paste the full address from the browser after approving the app.',
    };
  }

  const returnedState: string | null = query.get('state');
  if (returnedState === null) {
    return {
      ok: false,
      message:
        'The pasted URL has no "state" parameter, so it cannot be verified. Start again, or paste only the code if you are sure it came from this login.',
    };
  }
  if (returnedState !== expectedState) {
    return {
      ok: false,
      message:
        'The "state" in the pasted URL does not match this session. Do not use this code; start the script again.',
    };
  }
  return { ok: true, code, stateVerified: true };
}
