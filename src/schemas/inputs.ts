import { z } from 'zod';

export const SpotifySearchInputSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(20),
  types: z.array(z.enum(['album', 'artist', 'playlist', 'track'])).min(1),
  market: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(10).default(5),
  offset: z.number().int().min(0).max(1000).default(0),
  include_external: z.literal('audio').optional(),
});
export type SpotifySearchInput = z.infer<typeof SpotifySearchInputSchema>;

export const SpotifyStatusInputSchema = z.object({
  include: z.array(z.enum(['player', 'devices', 'queue', 'current_track'])).default(['player', 'devices', 'current_track']),
});
export type SpotifyStatusInput = z.infer<typeof SpotifyStatusInputSchema>;

export const SpotifyControlInputSchema = z.object({
  operations: z.array(z.object({
    action: z.enum(['play','pause','next','previous','seek','volume','shuffle','repeat','transfer','queue']),
    device_id: z.string().optional(),
    position_ms: z.number().nonnegative().optional(),
    volume_percent: z.number().min(0).max(100).optional(),
    shuffle: z.boolean().optional(),
    repeat: z.enum(['off','track','context']).optional(),
    context_uri: z.string().optional(),
    uris: z.array(z.string()).optional(),
    offset: z.object({ position: z.number().nonnegative().optional(), uri: z.string().optional() }).optional(),
    queue_uri: z.string().optional(),
    transfer_play: z.boolean().optional(),
  })).min(1).max(25),
  parallel: z.boolean().optional(),
});
export type SpotifyControlInput = z.infer<typeof SpotifyControlInputSchema>;

export const SpotifyPlaylistInputSchema = z.object({
  action: z.enum(['list_user','get','items','create','update_details','add_items','remove_items','reorder_items']),
  playlist_id: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  market: z.string().length(2).optional(),
  fields: z.string().optional(),
  additional_types: z.enum(['track','episode']).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  public: z.boolean().optional(),
  collaborative: z.boolean().optional(),
  uris: z.array(z.string()).max(100).optional(),
  items: z.array(z.object({ uri: z.string() })).max(100).optional(),
  tracks: z.array(z.object({ uri: z.string() })).max(100).optional(),
  range_start: z.number().int().nonnegative().optional(),
  insert_before: z.number().int().nonnegative().optional(),
  range_length: z.number().int().positive().optional(),
  snapshot_id: z.string().optional(),
});
export type SpotifyPlaylistInput = z.infer<typeof SpotifyPlaylistInputSchema>;

export const SpotifyLibraryInputSchema = z.object({
  action: z.enum(['tracks_get','tracks_add','tracks_remove','tracks_contains']),
  market: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  uris: z.array(z.string()).max(40).optional(),
  ids: z.array(z.string()).max(40).optional(),
});
export type SpotifyLibraryInput = z.infer<typeof SpotifyLibraryInputSchema>;

export const SpotifyUserDataInputSchema = z.object({
  action: z.enum(['profile','recently_played','top_tracks','top_artists']),
  limit: z.number().int().min(1).max(50).default(20).optional(),
  offset: z.number().int().min(0).max(100000).default(0).optional(),
  time_range: z.enum(['short_term','medium_term','long_term']).default('medium_term').optional(),
  after: z.number().int().nonnegative().optional(),
  before: z.number().int().nonnegative().optional(),
});
export type SpotifyUserDataInput = z.infer<typeof SpotifyUserDataInputSchema>;
