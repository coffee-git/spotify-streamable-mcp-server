import { z } from 'zod';

const ImageCodec = z.object({
  url: z.string().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

const ExternalUrlsCodec = z.object({ spotify: z.string().optional() }).optional();

export const TrackCodec = z.object({
  id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  artists: z.array(z.object({ name: z.string().nullable().optional() })).optional(),
  album: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  external_urls: ExternalUrlsCodec,
});
export type TrackCodecType = z.infer<typeof TrackCodec>;

export const ArtistCodec = z.object({
  id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  genres: z.array(z.string()).optional(),
  external_urls: ExternalUrlsCodec,
});
export type ArtistCodecType = z.infer<typeof ArtistCodec>;

export const MinimalEntityCodec = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  uri: z.string().optional(),
  external_urls: ExternalUrlsCodec,
});
export type MinimalEntityCodecType = z.infer<typeof MinimalEntityCodec>;

export const DeviceCodec = z.object({
  id: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  is_active: z.boolean(),
  volume_percent: z.number().nullable().optional(),
});
export const DevicesResponseCodec = z.object({ devices: z.array(DeviceCodec) });
export type DevicesResponseCodecType = z.infer<typeof DevicesResponseCodec>;

export const PlayerStateCodec = z.object({
  is_playing: z.boolean().optional(),
  shuffle_state: z.boolean().optional(),
  repeat_state: z.enum(['off', 'track', 'context']).optional(),
  progress_ms: z.number().optional(),
  timestamp: z.number().optional(),
  device: z.object({ id: z.string().optional() }).nullable().optional(),
  context: z.object({ uri: z.string().nullable().optional() }).nullable().optional(),
});
export type PlayerStateCodecType = z.infer<typeof PlayerStateCodec>;

export const CurrentlyPlayingCodec = z.object({
  item: TrackCodec.nullable().optional(),
  is_playing: z.boolean().optional(),
});
export type CurrentlyPlayingCodecType = z.infer<typeof CurrentlyPlayingCodec>;

export const QueueResponseCodec = z.object({
  currently_playing: TrackCodec.nullable().optional(),
  queue: z.array(TrackCodec).optional(),
});
export type QueueResponseCodecType = z.infer<typeof QueueResponseCodec>;

export const MeResponseCodec = z.object({
  id: z.string().optional(),
  display_name: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  external_urls: ExternalUrlsCodec,
  images: z.array(ImageCodec).nullable().optional(),
});
export type MeResponseCodecType = z.infer<typeof MeResponseCodec>;

export const PlaylistOwnerCodec = z
  .object({ display_name: z.string().nullable().optional() })
  .optional();
const PlaylistItemsSummaryCodec = z.object({
  total: z.number().nullable().optional(),
}).optional();
export const PlaylistSimplifiedCodec = z.object({
  id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  external_urls: ExternalUrlsCodec,
  public: z.boolean().nullable().optional(),
  owner: PlaylistOwnerCodec,
  images: z.array(ImageCodec).nullable().optional(),
  items: PlaylistItemsSummaryCodec,
  tracks: PlaylistItemsSummaryCodec,
});
export type PlaylistSimplifiedCodecType = z.infer<typeof PlaylistSimplifiedCodec>;

export const PlaylistListResponseCodec = z.object({
  items: z.array(PlaylistSimplifiedCodec).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
});
export type PlaylistListResponseCodecType = z.infer<typeof PlaylistListResponseCodec>;

export const PlaylistDetailsResponseCodec = PlaylistSimplifiedCodec.extend({
  description: z.string().nullable().optional(),
});
export type PlaylistDetailsResponseCodecType = z.infer<typeof PlaylistDetailsResponseCodec>;

export const PlaylistItemCodec = z.object({
  item: TrackCodec.nullable().optional(),
  track: TrackCodec.nullable().optional(),
  is_local: z.boolean().optional(),
});
export const PlaylistItemsResponseCodec = z.object({
  items: z.array(PlaylistItemCodec).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
});
export type PlaylistItemsResponseCodecType = z.infer<typeof PlaylistItemsResponseCodec>;
export const PlaylistTracksItemCodec = PlaylistItemCodec;
export const PlaylistTracksResponseCodec = PlaylistItemsResponseCodec;
export type PlaylistTracksResponseCodecType = PlaylistItemsResponseCodecType;

export const SavedTracksItemCodec = z.object({
  track: TrackCodec.nullable().optional(),
  added_at: z.string().optional(),
});
export const SavedTracksResponseCodec = z.object({
  items: z.array(SavedTracksItemCodec).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
});
export type SavedTracksResponseCodecType = z.infer<typeof SavedTracksResponseCodec>;

export const RecentlyPlayedResponseCodec = z.object({
  items: z.array(z.object({
    track: TrackCodec.nullable().optional(),
    played_at: z.string().optional(),
    context: z.object({
      type: z.string().nullable().optional(),
      uri: z.string().nullable().optional(),
      external_urls: ExternalUrlsCodec,
    }).nullable().optional(),
  })).optional(),
  limit: z.number().optional(),
  next: z.string().nullable().optional(),
  cursors: z.object({
    after: z.string().nullable().optional(),
    before: z.string().nullable().optional(),
  }).optional(),
});
export type RecentlyPlayedResponseCodecType = z.infer<typeof RecentlyPlayedResponseCodec>;

export const TopTracksResponseCodec = z.object({
  items: z.array(TrackCodec).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
  next: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
});
export type TopTracksResponseCodecType = z.infer<typeof TopTracksResponseCodec>;

export const TopArtistsResponseCodec = z.object({
  items: z.array(ArtistCodec).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.number().optional(),
  next: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
});
export type TopArtistsResponseCodecType = z.infer<typeof TopArtistsResponseCodec>;

export const SnapshotResponseCodec = z.object({ snapshot_id: z.string().optional() });
export type SnapshotResponseCodecType = z.infer<typeof SnapshotResponseCodec>;

const SearchBlockCodec = z.object({
  items: z.array(z.unknown()).optional(),
  total: z.number().optional(),
});
export const SearchResponseCodec = z.object({
  tracks: SearchBlockCodec.optional(),
  artists: SearchBlockCodec.optional(),
  albums: SearchBlockCodec.optional(),
  playlists: SearchBlockCodec.optional(),
  shows: SearchBlockCodec.optional(),
  episodes: SearchBlockCodec.optional(),
  audiobooks: SearchBlockCodec.optional(),
});
export type SearchResponseCodecType = z.infer<typeof SearchResponseCodec>;

export const SpotifyTokenResponseCodec = z.object({
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});
export type SpotifyTokenResponseCodecType = z.infer<typeof SpotifyTokenResponseCodec>;
