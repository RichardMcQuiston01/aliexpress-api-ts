import { describe, expect, it } from 'vitest';
import { parseCallback } from '../examples/callback.js';

describe('get-token callback parsing', () => {
  it('accepts a full URL whose state matches', () => {
    const result = parseCallback(
      'https://cb.example/callback?code=ABC123&state=s1',
      's1'
    );
    expect(result).toEqual({ ok: true, code: 'ABC123', stateVerified: true });
  });

  it('accepts a bare query string', () => {
    expect(parseCallback('?code=XYZ&state=s1', 's1')).toEqual({
      ok: true,
      code: 'XYZ',
      stateVerified: true,
    });
  });

  it('rejects a mismatched state', () => {
    const result = parseCallback(
      'https://cb.example/?code=ABC&state=evil',
      's1'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/state/);
  });

  it('rejects a URL with a code but no state', () => {
    expect(parseCallback('https://cb.example/?code=ABC', 's1').ok).toBe(false);
  });

  it('accepts a bare code but marks the state as unverified', () => {
    expect(parseCallback('  3_ABCdef  ', 's1')).toEqual({
      ok: true,
      code: '3_ABCdef',
      stateVerified: false,
    });
  });

  it('surfaces a provider error', () => {
    const result = parseCallback(
      'https://cb.example/?error=access_denied&error_description=User+said+no',
      's1'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('access_denied');
  });

  it('rejects empty input and URLs without a code', () => {
    expect(parseCallback('   ', 's1').ok).toBe(false);
    expect(parseCallback('https://cb.example/?foo=bar', 's1').ok).toBe(false);
  });
});
