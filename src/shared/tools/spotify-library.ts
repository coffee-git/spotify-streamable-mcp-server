import type { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { toolsMetadata } from '../../config/metadata.js';
import { type SpotifyLibraryInput, SpotifyLibraryInputSchema } from '../../schemas/inputs.js';
import { SpotifyLibraryOutputObject } from '../../schemas/outputs.js';
import { getSpotifyUserClient } from '../../services/spotify/sdk.js';
import { SavedTracksResponseCodec } from '../../types/spotify.codecs.js';
import { toSlimTrack } from '../../utils/mappers.js';
import { defineTool, type ToolContext, type ToolResult } from './types.js';

const ok = (action: string, data: unknown, text: string): ToolResult => ({ content: [{ type: 'text', text }], structuredContent: { ok: true, action, _msg: text, data } });
const fail = (action: string, error: unknown): ToolResult => ({ isError: true, content: [{ type: 'text', text: String(error) }], structuredContent: { ok: false, action, error: String(error) } });
const endpoint = (path: string, params: URLSearchParams) => params.size ? `${path}?${params}` : path;
const request = <T>(client: SpotifyApi, method: 'GET'|'PUT'|'DELETE', path: string) => client.makeRequest<T>(method, path);
const normalizeUris = (args: SpotifyLibraryInput) => args.uris?.length ? args.uris : (args.ids ?? []).map((id) => `spotify:track:${id}`);

export const spotifyLibraryTool = defineTool({
  name: toolsMetadata.spotify_library.name,
  title: toolsMetadata.spotify_library.title,
  description: toolsMetadata.spotify_library.description,
  inputSchema: SpotifyLibraryInputSchema,
  outputSchema: SpotifyLibraryOutputObject.shape,
  annotations: { title: toolsMetadata.spotify_library.title, readOnlyHint: false, openWorldHint: true },
  handler: async (args: SpotifyLibraryInput, context: ToolContext): Promise<ToolResult> => {
    try {
      const client = await getSpotifyUserClient(context);
      if (!client) return fail(args.action, 'Not authenticated');
      if (args.action === 'tracks_get') {
        const params = new URLSearchParams({ limit: String(args.limit ?? 20), offset: String(args.offset ?? 0) });
        if (args.market) params.set('market', args.market);
        const page = SavedTracksResponseCodec.parse(await request<unknown>(client, 'GET', endpoint('me/tracks', params)));
        const items = (page.items ?? []).flatMap((entry) => entry.track ? [{ ...toSlimTrack(entry.track), added_at: entry.added_at }] : []);
        return ok(args.action, { limit: page.limit, offset: page.offset, total: page.total, items }, `Loaded ${items.length} saved track(s).`);
      }
      const uris = normalizeUris(args);
      if (!uris.length) return fail(args.action, 'uris are required');
      const params = new URLSearchParams({ uris: uris.join(',') });
      if (args.action === 'tracks_contains') {
        const contains = await request<boolean[]>(client, 'GET', endpoint('me/library/contains', params));
        return ok(args.action, { uris, contains }, `Already saved: ${contains.filter(Boolean).length}/${uris.length}.`);
      }
      if (args.action === 'tracks_add') {
        await request(client, 'PUT', endpoint('me/library', params));
        return ok(args.action, { uris }, `Saved ${uris.length} track(s).`);
      }
      await request(client, 'DELETE', endpoint('me/library', params));
      return ok(args.action, { uris }, `Removed ${uris.length} saved track(s).`);
    } catch (error) { return fail(args.action, (error as Error).message); }
  },
});
