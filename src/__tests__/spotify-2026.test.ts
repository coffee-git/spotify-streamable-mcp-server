import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { SpotifyControlInputSchema, SpotifyLibraryInputSchema, SpotifySearchInputSchema, SpotifyUserDataInputSchema } from '../schemas/inputs.js';
import { buildUnauthorizedChallenge } from '../shared/mcp/security.js';
import { verifyClientId } from '../shared/oauth/client-registration.js';
import { handleRegister, handleRevoke } from '../shared/oauth/endpoints.js';
import { handleToken } from '../shared/oauth/flow.js';
import { buildAuthorizationServerMetadata, buildProtectedResourceMetadata } from '../shared/oauth/discovery.js';
import { MemoryTokenStore } from '../shared/storage/memory.js';
import { PlaylistItemsResponseCodec, PlaylistSimplifiedCodec } from '../types/spotify.codecs.js';

const signingKey = 'test-signing-key-that-is-stable';
const resource = 'https://mcp.example/mcp';
const redirectUri = 'https://chatgpt.example/oauth/callback';

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function registeredClientId(): Promise<string> {
  const registered = await handleRegister(
    { redirect_uris: [redirectUri], client_name: 'ChatGPT test' },
    'https://mcp.example',
    redirectUri,
    signingKey,
  );
  return registered.client_id;
}

describe('Spotify 2026 compatibility', () => {
  test('search is capped at 10', () => {
    expect(SpotifySearchInputSchema.safeParse({ queries: ['x'], types: ['track'], limit: 10 }).success).toBe(true);
    expect(SpotifySearchInputSchema.safeParse({ queries: ['x'], types: ['track'], limit: 11 }).success).toBe(false);
  });

  test('library accepts at most 40 track URIs', () => {
    const uris = Array.from({ length: 40 }, (_, i) => `spotify:track:abc${i}`);
    expect(SpotifyLibraryInputSchema.safeParse({ action: 'tracks_add', uris }).success).toBe(true);
    expect(SpotifyLibraryInputSchema.safeParse({ action: 'tracks_add', uris: [...uris, 'spotify:track:overflow'] }).success).toBe(false);
  });

  test('control rejects context and direct URIs together', () => {
    const parsed = SpotifyControlInputSchema.safeParse({
      operations: [{ action: 'play', context_uri: 'spotify:playlist:abc', uris: ['spotify:track:abc'] }],
    });
    expect(parsed.success).toBe(false);
  });

  test('playlist item renames parse', () => {
    expect(PlaylistSimplifiedCodec.parse({ items: { total: 2 } }).items?.total).toBe(2);
    expect(PlaylistItemsResponseCodec.parse({ items: [{ item: { id: 'id', name: 'Track' } }] }).items?.[0]?.item?.id).toBe('id');
  });

  test('taste actions parse', () => {
    for (const action of ['profile', 'recently_played', 'top_tracks', 'top_artists']) {
      expect(SpotifyUserDataInputSchema.safeParse({ action }).success).toBe(true);
    }
  });
});

describe('ChatGPT OAuth security', () => {
  test('challenge uses resource_metadata', () => {
    const authChallenge = buildUnauthorizedChallenge({ origin: 'https://mcp.example', sid: 's' });
    expect(authChallenge.headers['WWW-Authenticate']).toContain('resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"');
  });

  test('metadata advertises DCR and PKCE', () => {
    const protectedResource = buildProtectedResourceMetadata(resource, 'https://mcp.example', ['user-library-read']);
    expect(protectedResource.resource).toBe(resource);
    const auth = buildAuthorizationServerMetadata('https://mcp.example', ['user-library-read']);
    expect(auth.registration_endpoint).toBe('https://mcp.example/register');
    expect(auth.code_challenge_methods_supported).toEqual(['S256']);
  });

  test('registered client IDs are signed and redirect-bound', async () => {
    const clientId = await registeredClientId();
    const decoded = await verifyClientId(clientId, signingKey);
    expect(decoded?.redirect_uris).toEqual([redirectUri]);
    expect(await verifyClientId(`${clientId}x`, signingKey)).toBeNull();
  });

  test('authorization code is single-use and audience-bound', async () => {
    const store = new MemoryTokenStore();
    const clientId = await registeredClientId();
    const verifier = 'a-secure-verifier-value-for-pkce';
    const transactionId = 'txn-1';
    const code = 'code-1';
    await store.saveTransaction(transactionId, {
      clientId,
      codeChallenge: challenge(verifier),
      redirectUri,
      resource,
      createdAt: Date.now(),
      provider: {
        access_token: 'spotify-access',
        refresh_token: 'spotify-refresh',
        expires_at: Date.now() + 3600_000,
        scopes: ['user-library-read'],
        client_id: clientId,
        resource,
      },
    });
    await store.saveCode(code, transactionId);

    const first = await handleToken({
      grant: 'authorization_code',
      clientId,
      code,
      codeVerifier: verifier,
      redirectUri,
      resource,
    }, store);
    expect(first.access_token).toBeTruthy();

    await expect(handleToken({
      grant: 'authorization_code',
      clientId,
      code,
      codeVerifier: verifier,
      redirectUri,
      resource,
    }, store)).rejects.toThrow('invalid_grant');
  });

  test('resource mismatch is rejected and revocation is persisted', async () => {
    const store = new MemoryTokenStore();
    const clientId = await registeredClientId();
    await store.storeRsMapping('access', {
      access_token: 'spotify-access',
      refresh_token: 'spotify-refresh',
      expires_at: Date.now() + 3600_000,
      rs_access_expires_at: Date.now() + 3600_000,
      client_id: clientId,
      resource,
    }, 'refresh');

    await expect(handleToken({
      grant: 'refresh_token',
      clientId,
      refreshToken: 'refresh',
      resource: 'https://evil.example/mcp',
    }, store)).rejects.toThrow('invalid_target');

    await handleRevoke('refresh', store);
    expect((await store.getByRsRefresh('refresh'))?.provider.revoked_at).toBeNumber();
  });
});
