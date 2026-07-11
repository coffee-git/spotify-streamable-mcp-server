import { describe, expect, test } from 'bun:test';
import {
  normalizeSpotifyDevelopmentModeResponse,
  rewriteSpotifyDevelopmentModeRequest,
} from '../services/spotify/development-mode-2026.js';
import { buildUnauthorizedChallenge } from '../shared/mcp/security.js';
import { buildProtectedResourceMetadata } from '../shared/oauth/discovery.js';
import { getSharedToolNames } from '../shared/tools/registry.js';

describe('Spotify Development Mode 2026 adapter', () => {
  test('renames playlist item endpoints and remove payloads', () => {
    expect(
      rewriteSpotifyDevelopmentModeRequest(
        'DELETE',
        'playlists/playlist-id/tracks',
        { tracks: [{ uri: 'spotify:track:abc' }], snapshot_id: 'snapshot' },
      ),
    ).toEqual({
      path: 'playlists/playlist-id/items',
      body: {
        items: [{ uri: 'spotify:track:abc' }],
        snapshot_id: 'snapshot',
      },
    });
  });

  test('uses the current-user playlist creation endpoint', () => {
    expect(
      rewriteSpotifyDevelopmentModeRequest(
        'POST',
        'users/legacy-user-id/playlists',
        { name: 'New playlist' },
      ),
    ).toEqual({
      path: 'me/playlists',
      body: { name: 'New playlist' },
    });
  });

  test('converts library IDs to query URIs', () => {
    const save = rewriteSpotifyDevelopmentModeRequest('PUT', 'me/tracks', {
      ids: ['abc', 'def'],
    });
    expect(save.body).toBeUndefined();
    expect(save.path).toBe(
      'me/library?uris=spotify%3Atrack%3Aabc%2Cspotify%3Atrack%3Adef',
    );
    expect(save.library).toEqual({
      method: 'PUT',
      uriBatches: [['spotify:track:abc', 'spotify:track:def']],
    });

    expect(
      rewriteSpotifyDevelopmentModeRequest(
        'GET',
        'me/tracks/contains?ids=abc,def',
      ).path,
    ).toBe(
      'me/library/contains?uris=spotify%3Atrack%3Aabc%2Cspotify%3Atrack%3Adef',
    );
  });

  test('splits generic library requests into batches of 40', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `track${index}`);
    const rewrite = rewriteSpotifyDevelopmentModeRequest('DELETE', 'me/tracks', {
      ids,
    });
    expect(rewrite.library?.uriBatches.map((batch) => batch.length)).toEqual([
      40, 10,
    ]);
  });

  test('marks removed batch track fetches for fan-out', () => {
    expect(
      rewriteSpotifyDevelopmentModeRequest('GET', 'tracks?ids=abc,def')
        .fanOutTrackIds,
    ).toEqual(['abc', 'def']);
  });

  test('caps search requests at 10', () => {
    expect(
      rewriteSpotifyDevelopmentModeRequest('GET', 'search?q=test&limit=50').path,
    ).toBe('search?q=test&limit=10');
  });

  test('normalizes playlist response field renames', () => {
    expect(
      normalizeSpotifyDevelopmentModeResponse({
        items: [
          {
            added_at: '2026-01-01T00:00:00Z',
            item: { type: 'track', id: 'abc', name: 'Track' },
          },
        ],
      }),
    ).toEqual({
      items: [
        {
          added_at: '2026-01-01T00:00:00Z',
          item: { type: 'track', id: 'abc', name: 'Track' },
          track: { type: 'track', id: 'abc', name: 'Track' },
        },
      ],
    });

    expect(
      normalizeSpotifyDevelopmentModeResponse({
        type: 'playlist',
        id: 'playlist-id',
        items: { total: 4 },
      }),
    ).toEqual({
      type: 'playlist',
      id: 'playlist-id',
      items: { total: 4 },
      tracks: { total: 4 },
    });
  });
});

describe('ChatGPT OAuth discovery', () => {
  test('uses the standard resource_metadata challenge', () => {
    const challenge = buildUnauthorizedChallenge({
      origin: 'https://spotify-mcp.example',
      sid: 'session-id',
    });
    expect(challenge.headers['WWW-Authenticate']).toBe(
      'Bearer realm="MCP", resource_metadata="https://spotify-mcp.example/.well-known/oauth-protected-resource"',
    );
  });

  test('publishes a stable resource and issuer base URL', () => {
    expect(
      buildProtectedResourceMetadata(
        'https://spotify-mcp.example/mcp',
        'https://spotify-mcp.example',
        ['user-library-read'],
      ),
    ).toEqual({
      authorization_servers: ['https://spotify-mcp.example'],
      resource: 'https://spotify-mcp.example/mcp',
      scopes_supported: ['user-library-read'],
      bearer_methods_supported: ['header'],
    });
  });

  test('registers the listening data tool', () => {
    expect(getSharedToolNames()).toContain('spotify_user_data');
  });
});
