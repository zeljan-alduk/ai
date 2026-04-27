import { beforeEach, describe, expect, it } from 'vitest';
import { clearCredentials, readCredentials, writeCredentials } from '../src/api/credentials.js';
import { _makeExtensionContext, _resetVscodeMock } from './vscode-mock.js';

describe('credentials', () => {
  beforeEach(() => {
    _resetVscodeMock();
  });

  it('round-trips an api base url + token', async () => {
    const ctx = _makeExtensionContext() as unknown as Parameters<typeof writeCredentials>[0];
    await writeCredentials(ctx, {
      apiBaseUrl: 'https://aldo.local',
      token: 't0p-secret',
    });
    const got = await readCredentials(ctx);
    expect(got).toEqual({ apiBaseUrl: 'https://aldo.local', token: 't0p-secret' });
  });

  it('returns null when nothing is stored', async () => {
    const ctx = _makeExtensionContext() as unknown as Parameters<typeof writeCredentials>[0];
    expect(await readCredentials(ctx)).toBeNull();
  });

  it('clear removes the secret', async () => {
    const ctx = _makeExtensionContext() as unknown as Parameters<typeof writeCredentials>[0];
    await writeCredentials(ctx, {
      apiBaseUrl: 'https://aldo.local',
      token: 'tk',
    });
    await clearCredentials(ctx);
    expect(await readCredentials(ctx)).toBeNull();
  });
});
