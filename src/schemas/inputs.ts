import { z } from 'zod';

const SpotifyUriSchema = z
  .string()
  .regex(/^spotify:(track|episode):[A-Za-z0-9]+$/, 'Use a Spotify track or episode URI.');

export const SpotifySearchInputSchema = z.object({
  queries: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(20)
    .describe('One or more catalog search strings. Each query runs separately.'),
  types: z
    .array(z.enum(['album', 'artist', 'playlist', 'track']))
    .min(1)
    .describe('Spotify item types to search.'),
  market: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 market code.'),
  limit: z.number().int().min(1).max(10).default(5).describe('Results per type, 1-10.'),
  offset: z.number().int().min(0).max(1000).default(0).describe('Search offset.'),
  include_external: z.literal('audio').optional(),
});
export type SpotifySearchInput = z.infer<typeof SpotifySearchInputSchema>;

export const SpotifyStatusInputSchema = z.object({
  include: z
    .array(z.enum(['player', 'devices', 'queue', 'current_track']))
    .default(['player', 'devices', 'current_track'])
    .describe('Player sections to return.'),
});
export type SpotifyStatusInput = z.infer<typeof SpotifyStatusInputSchema>;

const ControlOperationSchema = z
  .object({
    action: z.enum([
      'play',
      'pause',
      'next',
      'previous',
      'seek',
      'volume',
      'shuffle',
      'repeat',
      'transfer',
      'queue',
    ]),
    device_id: z
      .string()
      .optional()
      .describe('Exact device ID returned by player_status, never the display name.'),
    position_ms: z.number().int().nonnegative().optional(),
    volume_percent: z.number().min(0).max(100).optional(),
    shuffle: z.boolean().optional(),
    repeat: z.enum(['off', 'track', 'context']).optional(),
    context_uri: z.string().trim().min(1).optional(),
    uris: z.array(SpotifyUriSchema).min(1).max(100).optional(),
    offset: z
      .object({
        position: z.number().int().nonnegative().optional(),
        uri: SpotifyUriSchema.optional(),
      })
      .optional(),
    queue_uri: SpotifyUriSchema.optional(),
    transfer_play: z.boolean().optional(),
  })
  .superRefine((operation, ctx) => {
    if (operation.context_uri && operation.uris?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['context_uri'],
        message: 'Provide context_uri or uris, not both.',
      });
    }
    if (operation.offset?.uri && !operation.context_uri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offset', 'uri'],
        message: 'offset.uri requires context_uri.',
      });
    }
    if (operation.offset?.uri && operation.offset.position !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offset'],
        message: 'Use offset.position or offset.uri, not both.',
      });
    }
  });

export const SpotifyControlInputSchema = z.object({
  operations: z
    .array(ControlOperationSchema)
    .min(1)
    .max(25)
    .describe('Playback operations. Sequential execution is the safe default.'),
  parallel: z.boolean().optional().describe('Run operations concurrently when true.'),
});
export type SpotifyControlInput = z.infer<typeof SpotifyControlInputSchema>;

export const SpotifyPlaylistInputSchema = z.object({
  action: z
    .enum([
      'list_user',
      'get',
      'items',
      'create',
      'update_details',
      'add_items',
      'remove_items',
      'reorder_items',
    ])
    .describe('Playlist operation to perform.'),
  playlist_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Required for every action except list_user and create.'),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  market: z.string().length(2).optional(),
  fields: z.string().trim().min(1).optional(),
  additional_types: z
    .literal('track')
    .optional()
    .describe('Only tracks are supported by this MCP response schema.'),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(300).optional(),
  public: z.boolean().optional(),
  collaborative: z.boolean().optional(),
  uris: z
    .array(SpotifyUriSchema)
    .min(1)
    .max(100)
    .optional()
    .describe('Exact Spotify URIs for add_items.'),
  items: z
    .array(z.object({ uri: SpotifyUriSchema }))
    .min(1)
    .max(100)
    .optional()
    .describe('Items to remove by URI.'),
  tracks: z
    .array(z.object({ uri: SpotifyUriSchema }))
    .min(1)
    .max(100)
    .optional()
    .describe('Deprecated alias for items.'),
  range_start: z.number().int().nonnegative().optional(),
  insert_before: z.number().int().nonnegative().optional(),
  range_length: z.number().int().positive().optional(),
  snapshot_id: z.string().optional(),
});
export type SpotifyPlaylistInput = z.infer<typeof SpotifyPlaylistInputSchema>;

export const SpotifyLibraryInputSchema = z.object({
  action: z.enum(['tracks_get', 'tracks_add', 'tracks_remove', 'tracks_contains']),
  market: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  uris: z
    .array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/))
    .min(1)
    .max(40)
    .optional()
    .describe('Track URIs for add, remove, or contains.'),
  ids: z
    .array(z.string().regex(/^[A-Za-z0-9]+$/))
    .min(1)
    .max(40)
    .optional()
    .describe('Track IDs accepted as a compatibility alias for uris.'),
});
export type SpotifyLibraryInput = z.infer<typeof SpotifyLibraryInputSchema>;

export const SpotifyUserDataInputSchema = z.object({
  action: z.enum(['profile', 'recently_played', 'top_tracks', 'top_artists']),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  time_range: z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term').optional(),
  after: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Unix timestamp in milliseconds for recently_played pagination.'),
  before: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Unix timestamp in milliseconds for recently_played pagination.'),
});
export type SpotifyUserDataInput = z.infer<typeof SpotifyUserDataInputSchema>;
