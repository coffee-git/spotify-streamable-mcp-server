export const serverMetadata = {
  title: 'Spotify Music',
  instructions: `Use these tools to inspect the signed-in user's Spotify data, find exact tracks, control playback, and manage playlists. Read saved tracks, playlists, top items, and recent history before claiming to analyze taste. Build playlists from concrete Spotify URIs and verify the result after writing.`,
} as const;

export const toolsMetadata = {
  search_catalog: { name: 'search_catalog', title: 'Find Music', description: 'Search tracks, artists, albums, and playlists. Spotify Development Mode supports 1-10 results per type.' },
  player_status: { name: 'player_status', title: 'Player Status', description: 'Read current playback, devices, queue, and the current track.' },
  spotify_control: { name: 'spotify_control', title: 'Control Spotify', description: 'Control playback and queue. Use an exact device_id from player_status.' },
  spotify_playlist: { name: 'spotify_playlist', title: 'Spotify Playlists', description: 'List playlists, read metadata and /items, create playlists, and add, remove, or reorder exact Spotify URIs.' },
  spotify_library: { name: 'spotify_library', title: 'Saved Songs', description: 'List saved tracks and add, remove, or check exact spotify:track: URIs using /me/library.' },
  spotify_user_data: { name: 'spotify_user_data', title: 'Taste and Listening Data', description: 'Read profile, recently played tracks, top tracks, and top artists.' },
} as const;
