import { describe, expect, test } from 'bun:test';
import { SpotifyLibraryInputSchema, SpotifySearchInputSchema, SpotifyUserDataInputSchema } from '../schemas/inputs.js';
import { PlaylistItemsResponseCodec, PlaylistSimplifiedCodec } from '../types/spotify.codecs.js';
import { buildUnauthorizedChallenge } from '../shared/mcp/security.js';
import { buildAuthorizationServerMetadata, buildProtectedResourceMetadata } from '../shared/oauth/discovery.js';

describe('Spotify 2026 compatibility', () => {
  test('search is capped at 10', () => {
    expect(SpotifySearchInputSchema.safeParse({ queries: ['x'], types: ['track'], limit: 10 }).success).toBe(true);
    expect(SpotifySearchInputSchema.safeParse({ queries: ['x'], types: ['track'], limit: 11 }).success).toBe(false);
  });
  test('library accepts at most 40 URIs', () => {
    expect(SpotifyLibraryInputSchema.safeParse({ action: 'tracks_add', uris: Array.from({ length: 40 }, (_, i) => `spotify:track:${i}`) }).success).toBe(true);
    expect(SpotifyLibraryInputSchema.safeParse({ action: 'tracks_add', uris: Array.from({ length: 41 }, (_, i) => `spotify:track:${i}`) }).success).toBe(false);
  });
  test('playlist item renames parse', () => {
    expect(PlaylistSimplifiedCodec.parse({ items: { total: 2 } }).items?.total).toBe(2);
    expect(PlaylistItemsResponseCodec.parse({ items: [{ item: { id: 'id', name: 'Track' } }] }).items?.[0]?.item?.id).toBe('id');
  });
  test('taste actions parse', () => {
    for (const action of ['profile','recently_played','top_tracks','top_artists']) expect(SpotifyUserDataInputSchema.safeParse({ action }).success).toBe(true);
  });
});

describe('ChatGPT OAuth', () => {
  test('challenge uses resource_metadata', () => {
    const challenge = buildUnauthorizedChallenge({ origin: 'https://mcp.example', sid: 's' });
    expect(challenge.headers['WWW-Authenticate']).toContain('resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"');
  });
  test('metadata is stable and supports DCR/PKCE', () => {
    const resource = buildProtectedResourceMetadata('https://mcp.example/mcp', 'https://mcp.example', ['user-library-read']);
    expect(resource.resource).toBe('https://mcp.example/mcp');
    const auth = buildAuthorizationServerMetadata('https://mcp.example', ['user-library-read']);
    expect(auth.registration_endpoint).toBe('https://mcp.example/register');
    expect(auth.code_challenge_methods_supported).toEqual(['S256']);
  });
});
