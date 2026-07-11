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

The repository uses `wrangler.jsonc`. Before deploying:

```bash
bun install
wrangler kv namespace create TOKENS
```

Put the returned namespace ID into `wrangler.jsonc`. Replace the placeholder hostname in `AUTH_RESOURCE_URI` with the exact public MCP endpoint:

```text
https://YOUR_WORKER.workers.dev/mcp
```

Create a stable 32-byte secret. It encrypts token records and signs stateless Dynamic Client Registration IDs, so changing it disconnects registered clients.

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
wrangler secret put RS_TOKENS_ENC_KEY
wrangler deploy
```

Production startup rejects OAuth requests when `RS_TOKENS_ENC_KEY` is missing.

In Spotify Developer Dashboard, register the exact callback URL:

```text
https://YOUR_WORKER.workers.dev/oauth/callback
```

Deploy again after replacing all placeholder Worker hostnames.

## ChatGPT Web

1. Enable Developer Mode in ChatGPT settings.
2. Add a developer app using `https://YOUR_WORKER.workers.dev/mcp`.
3. Complete the Spotify OAuth flow.
4. Verify the tools are visible.

The server exposes OAuth discovery, signed stateless Dynamic Client Registration, PKCE S256, resource/audience binding, rotating one-hour MCP access tokens, refresh tokens, revocation, `/mcp`, and a standards-based `resource_metadata` challenge.

Redirect URIs are bound to the signed client ID. Keep `OAUTH_REDIRECT_ALLOW_ALL=false`; the legacy allowlist is only a development fallback and is not used to bypass DCR validation.

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

Remove scopes for capabilities you do not need. For a read-only deployment, omit playback modification, playlist modification, and library modification scopes.

## Reliable playlist workflow

1. Page through saved tracks and relevant playlists.
2. Read top tracks/artists across useful time ranges.
3. Search candidate tracks and keep exact URIs.
4. Exclude existing tracks and unwanted genres.
5. Present candidates for review.
6. Create the playlist and add approved URIs.
7. Read playlist items to verify the write.

The playlist reader currently returns track items only. Non-track playlist entries are counted as `skipped_non_track` instead of being mislabeled as tracks.

## Local development

The MCP server uses port `3000`; the Node OAuth server uses `PORT + 1`, so the default Spotify callback is:

```text
http://127.0.0.1:3001/oauth/callback
```

Run validation with:

```bash
bun install
bun run typecheck
bun test
bun run lint
bun run build
```

## Security

This project is intended for a private deployment or a small explicitly controlled user set.

- Keep `AUTH_REQUIRE_RS=true` and `AUTH_ALLOW_DIRECT_BEARER=false`.
- Keep `OAUTH_REDIRECT_ALLOW_ALL=false`.
- Use a stable, secret `RS_TOKENS_ENC_KEY`.
- Restrict users in Spotify Developer Dashboard.
- Rotate Spotify credentials and the encryption/signing key if they are exposed.
- Review logs and Cloudflare access controls before exposing the service broadly.
- Cloudflare KV is eventually consistent; the implementation deletes consumed codes and marks transactions consumed, but a high-assurance multi-region authorization server should use a strongly consistent store or Durable Object for atomic code consumption.

## License

MIT
