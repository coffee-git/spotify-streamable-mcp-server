import type { AuthStrategyType } from '../auth/strategy.js';

export type UnifiedConfig = {
  HOST: string; PORT: number; NODE_ENV: 'development'|'production'|'test';
  MCP_TITLE: string; MCP_INSTRUCTIONS: string; MCP_VERSION: string; MCP_PROTOCOL_VERSION: string; MCP_ACCEPT_HEADERS: string[];
  AUTH_STRATEGY: AuthStrategyType; AUTH_ENABLED: boolean; AUTH_REQUIRE_RS: boolean; AUTH_ALLOW_DIRECT_BEARER: boolean; AUTH_RESOURCE_URI?: string; AUTH_DISCOVERY_URL?: string;
  API_KEY?: string; API_KEY_HEADER: string; BEARER_TOKEN?: string; CUSTOM_HEADERS?: string;
  OAUTH_CLIENT_ID?: string; OAUTH_CLIENT_SECRET?: string; OAUTH_SCOPES: string; OAUTH_AUTHORIZATION_URL?: string; OAUTH_TOKEN_URL?: string; OAUTH_REVOCATION_URL?: string; OAUTH_REDIRECT_URI: string; OAUTH_REDIRECT_ALLOWLIST: string[]; OAUTH_REDIRECT_ALLOW_ALL: boolean; OAUTH_EXTRA_AUTH_PARAMS?: string;
  PROVIDER_CLIENT_ID?: string; PROVIDER_CLIENT_SECRET?: string; PROVIDER_API_URL?: string; PROVIDER_ACCOUNTS_URL?: string;
  SPOTIFY_CLIENT_ID?: string; SPOTIFY_CLIENT_SECRET?: string; SPOTIFY_API_URL: string; SPOTIFY_ACCOUNTS_URL: string; SPOTIFY_SCOPES: string; SPOTIFY_INCLUDE_JSON_IN_CONTENT: boolean;
  RS_TOKENS_FILE?: string; RS_TOKENS_ENC_KEY?: string; RPS_LIMIT: number; CONCURRENCY_LIMIT: number; LOG_LEVEL: 'debug'|'info'|'warning'|'error';
};
const bool = (v: unknown) => String(v ?? 'false').toLowerCase() === 'true';
const num = (v: unknown, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const list = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const scopes = ['user-read-private','user-read-playback-state','user-modify-playback-state','user-read-currently-playing','user-read-recently-played','user-top-read','playlist-read-private','playlist-read-collaborative','playlist-modify-public','playlist-modify-private','user-library-read','user-library-modify'].join(' ');
function strategy(env: Record<string, unknown>): AuthStrategyType {
  const value = String(env.AUTH_STRATEGY ?? '').toLowerCase();
  if (['oauth','bearer','api_key','custom','none'].includes(value)) return value as AuthStrategyType;
  if (bool(env.AUTH_ENABLED) || (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET)) return 'oauth';
  if (env.API_KEY) return 'api_key'; if (env.BEARER_TOKEN) return 'bearer'; return 'none';
}
export function parseConfig(env: Record<string, unknown>): UnifiedConfig {
  const auth = strategy(env); const spotifyScopes = String(env.SPOTIFY_SCOPES || env.OAUTH_SCOPES || scopes);
  const clientId = String(env.OAUTH_CLIENT_ID || env.SPOTIFY_CLIENT_ID || '').trim() || undefined;
  const clientSecret = String(env.OAUTH_CLIENT_SECRET || env.SPOTIFY_CLIENT_SECRET || '').trim() || undefined;
  return {
    HOST: String(env.HOST || '127.0.0.1'), PORT: num(env.PORT, 3000), NODE_ENV: (env.NODE_ENV as UnifiedConfig['NODE_ENV']) || 'development',
    MCP_TITLE: String(env.MCP_TITLE || 'Spotify MCP'), MCP_INSTRUCTIONS: String(env.MCP_INSTRUCTIONS || 'Inspect Spotify data and manage exact playlist items.'), MCP_VERSION: String(env.MCP_VERSION || '1.1.0'), MCP_PROTOCOL_VERSION: String(env.MCP_PROTOCOL_VERSION || '2025-11-25'), MCP_ACCEPT_HEADERS: list(env.MCP_ACCEPT_HEADERS),
    AUTH_STRATEGY: auth, AUTH_ENABLED: auth === 'oauth' || bool(env.AUTH_ENABLED), AUTH_REQUIRE_RS: env.AUTH_REQUIRE_RS === undefined ? auth === 'oauth' : bool(env.AUTH_REQUIRE_RS), AUTH_ALLOW_DIRECT_BEARER: bool(env.AUTH_ALLOW_DIRECT_BEARER), AUTH_RESOURCE_URI: env.AUTH_RESOURCE_URI as string|undefined, AUTH_DISCOVERY_URL: env.AUTH_DISCOVERY_URL as string|undefined,
    API_KEY: env.API_KEY as string|undefined, API_KEY_HEADER: String(env.API_KEY_HEADER || 'x-api-key'), BEARER_TOKEN: env.BEARER_TOKEN as string|undefined, CUSTOM_HEADERS: env.CUSTOM_HEADERS as string|undefined,
    OAUTH_CLIENT_ID: clientId, OAUTH_CLIENT_SECRET: clientSecret, OAUTH_SCOPES: spotifyScopes, OAUTH_AUTHORIZATION_URL: String(env.OAUTH_AUTHORIZATION_URL || 'https://accounts.spotify.com/authorize'), OAUTH_TOKEN_URL: String(env.OAUTH_TOKEN_URL || 'https://accounts.spotify.com/api/token'), OAUTH_REVOCATION_URL: env.OAUTH_REVOCATION_URL as string|undefined, OAUTH_REDIRECT_URI: String(env.OAUTH_REDIRECT_URI || 'http://127.0.0.1:3000/callback'), OAUTH_REDIRECT_ALLOWLIST: list(env.OAUTH_REDIRECT_ALLOWLIST), OAUTH_REDIRECT_ALLOW_ALL: bool(env.OAUTH_REDIRECT_ALLOW_ALL), OAUTH_EXTRA_AUTH_PARAMS: env.OAUTH_EXTRA_AUTH_PARAMS as string|undefined,
    PROVIDER_CLIENT_ID: String(env.SPOTIFY_CLIENT_ID || '').trim() || undefined, PROVIDER_CLIENT_SECRET: String(env.SPOTIFY_CLIENT_SECRET || '').trim() || undefined, PROVIDER_API_URL: String(env.SPOTIFY_API_URL || 'https://api.spotify.com/v1'), PROVIDER_ACCOUNTS_URL: String(env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com'),
    SPOTIFY_CLIENT_ID: String(env.SPOTIFY_CLIENT_ID || '').trim() || undefined, SPOTIFY_CLIENT_SECRET: String(env.SPOTIFY_CLIENT_SECRET || '').trim() || undefined, SPOTIFY_API_URL: String(env.SPOTIFY_API_URL || 'https://api.spotify.com/v1'), SPOTIFY_ACCOUNTS_URL: String(env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com'), SPOTIFY_SCOPES: spotifyScopes, SPOTIFY_INCLUDE_JSON_IN_CONTENT: bool(env.SPOTIFY_INCLUDE_JSON_IN_CONTENT),
    RS_TOKENS_FILE: env.RS_TOKENS_FILE as string|undefined, RS_TOKENS_ENC_KEY: env.RS_TOKENS_ENC_KEY as string|undefined, RPS_LIMIT: num(env.RPS_LIMIT, 10), CONCURRENCY_LIMIT: num(env.CONCURRENCY_LIMIT, 5), LOG_LEVEL: (env.LOG_LEVEL as UnifiedConfig['LOG_LEVEL']) || 'info',
  };
}
export function resolveConfig() { return parseConfig(process.env as Record<string, unknown>); }
