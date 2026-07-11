# ChatGPT Web deployment on Cloudflare Workers

This repository includes a remote Streamable HTTP MCP endpoint at `/mcp` and a small OAuth proxy for personal deployments.

> The existing OAuth wrapper is intended for a private or trusted-user deployment. It is not a hardened public multi-tenant authorization service.

## 1. Create the Spotify app

Create an app in the Spotify Developer Dashboard and enable Web API access. The app owner must meet Spotify's current Development Mode requirements.

Add this redirect URI, using the final Worker hostname:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/oauth/callback
```

## 2. Create Cloudflare KV and configure Wrangler

```bash
bun install
bunx wrangler kv namespace create TOKENS
```

In `wrangler.jsonc`:

- replace the placeholder KV namespace ID;
- replace `AUTH_RESOURCE_URI` with the exact public MCP URL;
- keep `AUTH_RESOURCE_URI` stable after connecting ChatGPT.

Example:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/mcp
```

Set secrets:

```bash
bunx wrangler secret put SPOTIFY_CLIENT_ID
bunx wrangler secret put SPOTIFY_CLIENT_SECRET
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
bunx wrangler secret put RS_TOKENS_ENC_KEY
```

Deploy once:

```bash
bunx wrangler deploy
```

## 3. Create the ChatGPT developer app

In ChatGPT Developer Mode, add the MCP server URL:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/mcp
```

ChatGPT shows a production OAuth callback URL similar to:

```text
https://chatgpt.com/connector/oauth/CALLBACK_ID
```

Copy that exact URL into both values in `wrangler.jsonc`:

```jsonc
"OAUTH_REDIRECT_ALLOWLIST": "https://chatgpt.com/connector/oauth/CALLBACK_ID",
"OAUTH_REDIRECT_URI": "https://chatgpt.com/connector/oauth/CALLBACK_ID"
```

Deploy again and complete the Spotify authorization flow.

## Spotify Development Mode 2026 compatibility

The SDK compatibility adapter translates the project's existing calls without replacing its playlist and library handlers:

- playlist `/tracks` operations to `/items`;
- playlist response fields `items`/`item` back to the existing internal `tracks`/`track` shapes;
- playlist creation from `/users/{id}/playlists` to `/me/playlists`;
- save/remove/check operations to `/me/library` using Spotify URIs;
- removed batch track lookup into individual track requests;
- search limits above 10 down to Spotify's current Development Mode maximum.

The `spotify_user_data` tool adds read-only access to the current profile, recently played tracks, top tracks, and top artists.

## Validation

```bash
bun run typecheck
bun test
bun run lint
bun run format:check
bunx wrangler deploy --dry-run --outdir dist-worker
```
