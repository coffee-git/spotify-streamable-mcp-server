import { z } from 'zod';
import { getSpotifyUserClient } from '../../services/spotify/sdk.js';
import { defineTool, type ToolContext, type ToolResult } from './types.js';

const SpotifyUserDataInputSchema = z.object({
  action: z
    .enum(['profile', 'recently_played', 'top_tracks', 'top_artists'])
    .describe('Spotify user data to read.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .optional()
    .describe('Maximum number of listening items to return.'),
  offset: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(0)
    .optional()
    .describe('Pagination offset for top tracks and artists.'),
  time_range: z
    .enum(['short_term', 'medium_term', 'long_term'])
    .default('medium_term')
    .optional()
    .describe('Time range for top tracks and artists.'),
  after: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Unix timestamp in milliseconds for recently played pagination.'),
  before: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Unix timestamp in milliseconds for recently played pagination.'),
});

const SlimTrackSchema = z.object({
  type: z.literal('track'),
  id: z.string(),
  uri: z.string().optional(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string().optional(),
  duration_ms: z.number().optional(),
});

const SlimArtistSchema = z.object({
  type: z.literal('artist'),
  id: z.string(),
  uri: z.string().optional(),
  name: z.string(),
  genres: z.array(z.string()).optional(),
});

const RecentlyPlayedSchema = z.object({
  type: z.literal('recently_played'),
  played_at: z.string(),
  track: SlimTrackSchema,
});

const ProfileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
  uri: z.string().optional(),
  images: z.array(z.string()).optional(),
});

const SpotifyUserDataOutputSchema = z.object({
  action: z.enum(['profile', 'recently_played', 'top_tracks', 'top_artists']),
  profile: ProfileSchema.optional(),
  items: z
    .array(z.union([SlimTrackSchema, SlimArtistSchema, RecentlyPlayedSchema]))
    .optional(),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  next: z.string().nullable().optional(),
  cursors: z
    .object({
      after: z.string().optional(),
      before: z.string().optional(),
    })
    .optional(),
  _msg: z.string(),
});

type SpotifyUserDataInput = z.infer<typeof SpotifyUserDataInputSchema>;
type SlimTrack = z.infer<typeof SlimTrackSchema>;
type SlimArtist = z.infer<typeof SlimArtistSchema>;
type RecentlyPlayed = z.infer<typeof RecentlyPlayedSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toSlimTrack(value: unknown): SlimTrack | null {
  const track = asRecord(value);
  const id = asString(track.id);
  const name = asString(track.name);
  if (!id || !name) return null;

  const artists = Array.isArray(track.artists)
    ? track.artists
        .map((artist) => asString(asRecord(artist).name))
        .filter((artist): artist is string => Boolean(artist))
    : [];
  const album = asString(asRecord(track.album).name);

  return {
    type: 'track',
    id,
    name,
    artists,
    ...(asString(track.uri) ? { uri: asString(track.uri) } : {}),
    ...(album ? { album } : {}),
    ...(asNumber(track.duration_ms) !== undefined
      ? { duration_ms: asNumber(track.duration_ms) }
      : {}),
  };
}

function toSlimArtist(value: unknown): SlimArtist | null {
  const artist = asRecord(value);
  const id = asString(artist.id);
  const name = asString(artist.name);
  if (!id || !name) return null;

  const genres = Array.isArray(artist.genres)
    ? artist.genres.filter((genre): genre is string => typeof genre === 'string')
    : undefined;

  return {
    type: 'artist',
    id,
    name,
    ...(asString(artist.uri) ? { uri: asString(artist.uri) } : {}),
    ...(genres ? { genres } : {}),
  };
}

function safeError(error: unknown): string {
  const status = (error as { status?: number }).status;
  if (status === 401) return 'Spotify authorization expired. Please reconnect.';
  if (status === 403) return 'Spotify denied this request. Check the granted scopes.';
  if (status === 429) return 'Spotify rate limit reached. Please retry later.';
  return 'Spotify user data request failed.';
}

function success(
  structuredContent: z.infer<typeof SpotifyUserDataOutputSchema>,
): ToolResult {
  return {
    content: [{ type: 'text', text: structuredContent._msg }],
    structuredContent,
  };
}

export const spotifyUserDataTool = defineTool({
  name: 'spotify_user_data',
  title: 'Spotify Listening Data',
  description:
    'Read the signed-in user profile, recently played tracks, top tracks, or top artists. Use this before analyzing listening taste.',
  inputSchema: SpotifyUserDataInputSchema,
  outputSchema: SpotifyUserDataOutputSchema.shape,
  annotations: {
    title: 'Spotify Listening Data',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },

  handler: async (
    args: SpotifyUserDataInput,
    context: ToolContext,
  ): Promise<ToolResult> => {
    try {
      const client = await getSpotifyUserClient(context);
      if (!client) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Not authenticated with Spotify.' }],
        };
      }

      if (args.action === 'profile') {
        const response = asRecord(await client.makeRequest<unknown>('GET', 'me'));
        const id = asString(response.id);
        if (!id) throw new Error('invalid_profile');
        const images = Array.isArray(response.images)
          ? response.images
              .map((image) => asString(asRecord(image).url))
              .filter((url): url is string => Boolean(url))
          : [];
        return success({
          action: args.action,
          profile: {
            id,
            display_name:
              response.display_name === null
                ? null
                : asString(response.display_name),
            ...(asString(response.uri) ? { uri: asString(response.uri) } : {}),
            images,
          },
          _msg: `Loaded Spotify profile ${id}.`,
        });
      }

      const limit = args.limit ?? 20;
      if (args.action === 'recently_played') {
        const params = new URLSearchParams({ limit: String(limit) });
        if (args.after !== undefined) params.set('after', String(args.after));
        if (args.before !== undefined) params.set('before', String(args.before));
        const response = asRecord(
          await client.makeRequest<unknown>(
            'GET',
            `me/player/recently-played?${params.toString()}`,
          ),
        );
        const items: RecentlyPlayed[] = Array.isArray(response.items)
          ? response.items.flatMap((entry) => {
              const item = asRecord(entry);
              const track = toSlimTrack(item.track);
              const playedAt = asString(item.played_at);
              return track && playedAt
                ? [{ type: 'recently_played' as const, played_at: playedAt, track }]
                : [];
            })
          : [];
        const cursors = asRecord(response.cursors);
        return success({
          action: args.action,
          items,
          limit,
          next: asString(response.next) ?? null,
          cursors: {
            ...(asString(cursors.after) ? { after: asString(cursors.after) } : {}),
            ...(asString(cursors.before) ? { before: asString(cursors.before) } : {}),
          },
          _msg: `Loaded ${items.length} recently played track(s).`,
        });
      }

      const offset = args.offset ?? 0;
      const timeRange = args.time_range ?? 'medium_term';
      const itemType = args.action === 'top_tracks' ? 'tracks' : 'artists';
      const params = new URLSearchParams({
        time_range: timeRange,
        limit: String(limit),
        offset: String(offset),
      });
      const response = asRecord(
        await client.makeRequest<unknown>(
          'GET',
          `me/top/${itemType}?${params.toString()}`,
        ),
      );
      const items = Array.isArray(response.items)
        ? response.items.flatMap((item) => {
            const normalized =
              args.action === 'top_tracks'
                ? toSlimTrack(item)
                : toSlimArtist(item);
            return normalized ? [normalized] : [];
          })
        : [];

      return success({
        action: args.action,
        items,
        total: asNumber(response.total) ?? items.length,
        limit,
        offset,
        next: asString(response.next) ?? null,
        _msg: `Loaded ${items.length} ${args.action.replace('_', ' ')} item(s).`,
      });
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: safeError(error) }],
      };
    }
  },
});
