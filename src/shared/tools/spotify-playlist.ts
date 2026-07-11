import type { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { toolsMetadata } from '../../config/metadata.js';
import { type SpotifyPlaylistInput, SpotifyPlaylistInputSchema } from '../../schemas/inputs.js';
import { SpotifyPlaylistOutputObject } from '../../schemas/outputs.js';
import { getSpotifyUserClient } from '../../services/spotify/sdk.js';
import { PlaylistDetailsResponseCodec, PlaylistItemsResponseCodec, PlaylistListResponseCodec, SnapshotResponseCodec, TrackCodec } from '../../types/spotify.codecs.js';
import { toPlaylistDetails, toPlaylistSummary, toSlimTrack } from '../../utils/mappers.js';
import { toSafeSpotifyError } from './spotify-errors.js';
import { defineTool, type ToolContext, type ToolResult } from './types.js';

const ok = (action: string, data: unknown, text: string): ToolResult => ({ content: [{ type: 'text', text }], structuredContent: { ok: true, action, _msg: text, data } });
const fail = (action: string, message: string, code?: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }], structuredContent: { ok: false, action, error: message, code } });
const endpoint = (path: string, params: URLSearchParams) => params.size ? `${path}?${params}` : path;
const request = <T>(client: SpotifyApi, method: 'GET'|'POST'|'PUT'|'DELETE', path: string, body?: unknown) => client.makeRequest<T>(method, path, body);

export const spotifyPlaylistTool = defineTool({
  name: toolsMetadata.spotify_playlist.name,
  title: toolsMetadata.spotify_playlist.title,
  description: toolsMetadata.spotify_playlist.description,
  inputSchema: SpotifyPlaylistInputSchema,
  outputSchema: SpotifyPlaylistOutputObject.shape,
  annotations: { title: toolsMetadata.spotify_playlist.title, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  handler: async (args: SpotifyPlaylistInput, context: ToolContext): Promise<ToolResult> => {
    try {
      const client = await getSpotifyUserClient(context);
      if (!client) return fail(args.action, 'Not authenticated', 'unauthorized');
      if (args.action === 'list_user') {
        const params = new URLSearchParams({ limit: String(args.limit ?? 20), offset: String(args.offset ?? 0) });
        const page = PlaylistListResponseCodec.parse(await request<unknown>(client, 'GET', endpoint('me/playlists', params)));
        const items = (page.items ?? []).map(toPlaylistSummary);
        return ok(args.action, { limit: page.limit, offset: page.offset, total: page.total, items }, `Found ${items.length} playlist(s).`);
      }
      if (args.action === 'create') {
        const playlist = PlaylistDetailsResponseCodec.parse(await request<unknown>(client, 'POST', 'me/playlists', { name: args.name?.trim() || 'New Playlist', description: args.description, public: args.public, collaborative: args.collaborative }));
        return ok(args.action, toPlaylistDetails(playlist), `Created playlist '${playlist.name}'.`);
      }
      if (!args.playlist_id) return fail(args.action, 'playlist_id is required', 'invalid_arguments');
      const id = args.playlist_id;
      if (args.action === 'get') {
        const playlist = PlaylistDetailsResponseCodec.parse(await request<unknown>(client, 'GET', `playlists/${id}`));
        return ok(args.action, toPlaylistDetails(playlist), `Fetched playlist '${playlist.name}'.`);
      }
      if (args.action === 'items') {
        const params = new URLSearchParams({ limit: String(args.limit ?? 20), offset: String(args.offset ?? 0) });
        if (args.market) params.set('market', args.market);
        if (args.fields) params.set('fields', args.fields);
        const page = PlaylistItemsResponseCodec.parse(await request<unknown>(client, 'GET', endpoint(`playlists/${id}/items`, params)));
        const base = page.offset ?? args.offset ?? 0;
        let skipped_non_track = 0;
        const items = (page.items ?? []).flatMap((entry, index) => {
          const raw = entry.item ?? entry.track;
          if (!raw) return [];
          const type = (raw as { type?: string }).type;
          if (type && type !== 'track') { skipped_non_track += 1; return []; }
          return [{ ...toSlimTrack(TrackCodec.parse(raw)), position: base + index }];
        });
        return ok(args.action, { playlist_id: id, playlist_uri: `spotify:playlist:${id}`, limit: page.limit, offset: base, total: page.total, skipped_non_track, items }, `Loaded ${items.length} track item(s).`);
      }
      if (args.action === 'update_details') {
        await request(client, 'PUT', `playlists/${id}`, { name: args.name, description: args.description, public: args.public, collaborative: args.collaborative });
        return ok(args.action, { playlist_id: id }, 'Updated playlist details.');
      }
      if (args.action === 'add_items') {
        if (!args.uris?.length) return fail(args.action, 'uris are required', 'invalid_arguments');
        const snapshot = SnapshotResponseCodec.parse(await request<unknown>(client, 'POST', `playlists/${id}/items`, { uris: args.uris }));
        return ok(args.action, { snapshot_id: snapshot.snapshot_id, uris: args.uris }, `Added ${args.uris.length} item(s).`);
      }
      if (args.action === 'remove_items') {
        const items = args.items ?? args.tracks;
        if (!items?.length) return fail(args.action, 'items are required', 'invalid_arguments');
        const snapshot = SnapshotResponseCodec.parse(await request<unknown>(client, 'DELETE', `playlists/${id}/items`, { items, snapshot_id: args.snapshot_id }));
        return ok(args.action, { snapshot_id: snapshot.snapshot_id, items }, `Removed ${items.length} item(s).`);
      }
      if (args.range_start == null || args.insert_before == null) return fail(args.action, 'range_start and insert_before are required', 'invalid_arguments');
      const snapshot = SnapshotResponseCodec.parse(await request<unknown>(client, 'PUT', `playlists/${id}/items`, { range_start: args.range_start, insert_before: args.insert_before, range_length: args.range_length, snapshot_id: args.snapshot_id }));
      return ok(args.action, { snapshot_id: snapshot.snapshot_id }, 'Reordered playlist items.');
    } catch (error) {
      const safe = toSafeSpotifyError(error);
      return fail(args.action, safe.message, safe.code);
    }
  },
});
