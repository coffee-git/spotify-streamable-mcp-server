# Spotify MCP Server for ChatGPT Web

Remote Streamable HTTP MCP server for Spotify, with OAuth, Cloudflare Workers support, structured user data, and exact playlist writes.

## Capabilities

- Search tracks, artists, albums, and playlists with exact IDs/URIs
- Read the current Spotify profile
- Read recently played tracks
- Read top tracks and top artists by time range
- Page through saved tracks and user playlists
- Read playlist items through Spotify's 2026 `/items` endpoints
- Create playlists and add/remove/reorder concrete Spotify URIs
- Control playback and inspect devices
- Connect to ChatGPT Web through Developer Mode and OAuth PKCE

## Spotify API 2026

This fork uses the February 2026 Development Mode API changes:

- `/playlists/{id}/items` instead of `/tracks`
- `/me/playlists` for playlist creation
- `/me/library` and `/me/library/contains` for save/remove/check operations
- search limits capped at 10
- no removed batch track lookup endpoints

## Cloudflare Workers deployment

```bash
bun install
wrangler kv namespace create TOKENS
cp wrangler.toml.example wrangler.toml
```

Put the returned KV namespace ID into `wrangler.toml`. Then configure secrets:

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
wrangler secret put RS_TOKENS_ENC_KEY
wrangler deploy
```

In Spotify Developer Dashboard, register:

```text
https://YOUR_WORKER.workers.dev/oauth/callback
```

Set `AUTH_RESOURCE_URI` to the exact deployed endpoint:

```text
https://YOUR_WORKER.workers.dev/mcp
```

Deploy again after setting the final URL.

## ChatGPT Web

1. Enable Developer Mode in ChatGPT settings.
2. Add a developer app using `https://YOUR_WORKER.workers.dev/mcp`.
3. Complete the Spotify OAuth flow.
4. Verify the tools are visible.

The server exposes OAuth discovery, Dynamic Client Registration, PKCE, `/mcp`, and a standards-based `resource_metadata` challenge.

## Required Spotify scopes

```text
user-read-private
user-read-playback-state
user-modify-playback-state
user-read-currently-playing
user-read-recently-played
user-top-read
playlist-read-private
playlist-read-collaborative
playlist-modify-public
playlist-modify-private
user-library-read
user-library-modify
```

## Reliable playlist workflow

1. Page through saved tracks and relevant playlists.
2. Read top tracks/artists across useful time ranges.
3. Search candidate tracks and keep exact URIs.
4. Exclude existing tracks and unwanted genres.
5. Present candidates for review.
6. Create the playlist and add approved URIs.
7. Read playlist items to verify the write.

## Development

```bash
bun install
bun run typecheck
bun test
bun run lint
bun run build
```

## Security

This is intended for a private deployment. Keep `AUTH_REQUIRE_RS=true`, `AUTH_ALLOW_DIRECT_BEARER=false`, encrypt KV tokens, restrict Spotify app users, and do not expose credentials. Add stricter client-registration persistence, redirect allowlisting, audit logs, and revocation before operating it as a public multi-user service.

## License

MIT
