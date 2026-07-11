import type { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { toolsMetadata } from '../../config/metadata.js';
import { type SpotifyUserDataInput, SpotifyUserDataInputSchema } from '../../schemas/inputs.js';
import { SpotifyUserDataOutputObject } from '../../schemas/outputs.js';
import { getSpotifyUserClient } from '../../services/spotify/sdk.js';
import { MeResponseCodec, RecentlyPlayedResponseCodec, TopArtistsResponseCodec, TopTracksResponseCodec } from '../../types/spotify.codecs.js';
import { toSlimArtistDetails, toSlimTrack, toUserProfile } from '../../utils/mappers.js';
import { toSafeSpotifyError } from './spotify-errors.js';
import { defineTool, type ToolContext, type ToolResult } from './types.js';

const result = (action: string, data: unknown, text: string): ToolResult => ({ content: [{ type: 'text', text }], structuredContent: { ok: true, action, _msg: text, data } });
const failure = (action: string, message: string, code?: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }], structuredContent: { ok: false, action, error: message, code } });
const endpoint = (path: string, params: URLSearchParams) => params.size ? `${path}?${params}` : path;
const get = <T>(client: SpotifyApi, path: string) => client.makeRequest<T>('GET', path);

export const spotifyUserDataTool = defineTool({
  name: toolsMetadata.spotify_user_data.name,
  title: toolsMetadata.spotify_user_data.title,
  description: toolsMetadata.spotify_user_data.description,
  inputSchema: SpotifyUserDataInputSchema,
  outputSchema: SpotifyUserDataOutputObject.shape,
  annotations: { title: toolsMetadata.spotify_user_data.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: async (args: SpotifyUserDataInput, context: ToolContext): Promise<ToolResult> => {
    try {
      const client = await getSpotifyUserClient(context);
      if (!client) return failure(args.action, 'Not authenticated', 'unauthorized');
      if (args.after !== undefined && args.before !== undefined) return failure(args.action, 'Use only one of after or before', 'invalid_arguments');
      if (args.action !== 'recently_played' && (args.after !== undefined || args.before !== undefined)) {
        return failure(args.action, 'after and before are only valid for recently_played', 'invalid_arguments');
      }
      if (args.action === 'profile') {
        const data = toUserProfile(MeResponseCodec.parse(await get<unknown>(client, 'me')));
        return result(args.action, data, `Signed in as ${data.display_name || data.id}.`);
      }
      const params = new URLSearchParams({ limit: String(args.limit ?? 20) });
      if (args.action === 'recently_played') {
        if (args.after !== undefined) params.set('after', String(args.after));
        if (args.before !== undefined) params.set('before', String(args.before));
        const page = RecentlyPlayedResponseCodec.parse(await get<unknown>(client, endpoint('me/player/recently-played', params)));
        const items = (page.items ?? []).flatMap((entry) => entry.track ? [{ ...toSlimTrack(entry.track), played_at: entry.played_at, context_uri: entry.context?.uri ?? undefined }] : []);
        return result(args.action, { limit: page.limit, cursors: page.cursors, next: page.next, items }, `Loaded ${items.length} recently played track(s).`);
      }
      params.set('offset', String(args.offset ?? 0));
      params.set('time_range', args.time_range ?? 'medium_term');
      if (args.action === 'top_tracks') {
        const page = TopTracksResponseCodec.parse(await get<unknown>(client, endpoint('me/top/tracks', params)));
        const items = (page.items ?? []).map(toSlimTrack);
        return result(args.action, { limit: page.limit, offset: page.offset, total: page.total, next: page.next, items }, `Loaded ${items.length} top track(s).`);
      }
      const page = TopArtistsResponseCodec.parse(await get<unknown>(client, endpoint('me/top/artists', params)));
      const items = (page.items ?? []).map(toSlimArtistDetails);
      return result(args.action, { limit: page.limit, offset: page.offset, total: page.total, next: page.next, items }, `Loaded ${items.length} top artist(s).`);
    } catch (error) {
      const safe = toSafeSpotifyError(error);
      return failure(args.action, safe.message, safe.code);
    }
  },
});
