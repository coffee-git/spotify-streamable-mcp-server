/**
 * Spotify SDK client factory.
 * Provides user-authenticated Spotify API clients using the template's auth context.
 */

import {
  type AccessToken,
  ClientCredentialsStrategy,
  type IAuthStrategy,
  type IValidateResponses,
  type SdkConfiguration,
  SpotifyApi,
} from '@spotify/web-api-ts-sdk';
import { config } from '../../config/env.js';
import { getTokenStore } from '../../shared/storage/singleton.js';
import type { ToolContext } from '../../shared/tools/types.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';
import { refreshSpotifyTokens } from './oauth.js';

// ---------------------------------------------------------------------------
// Response Validator
// ---------------------------------------------------------------------------

const responseValidator: IValidateResponses = {
  async validateResponse(response: Response): Promise<void> {
    if (response.status === 204) {
      return;
    }
    if (response.ok) {
      return;
    }
    const body = await response.text().catch(() => '');
    const error = new Error(
      `Spotify request failed: ${response.status} ${response.statusText}${
        body ? ` - ${body}` : ''
      }`,
    );
    (error as { status?: number }).status = response.status;
    throw error;
  },
};

/**
 * Custom deserializer that handles non-JSON responses gracefully.
 * The npm version of @spotify/web-api-ts-sdk doesn't catch JSON.parse errors,
 * but some Spotify endpoints (e.g., queue) return non-JSON responses.
 */
const responseDeserializer = {
  async deserialize<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (text.length > 0) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // Non-JSON response (e.g., queue endpoint) - treat as success
        return null as T;
      }
    }
    return null as T;
  },
};

const sdkOptions = { responseValidator, deserializer: responseDeserializer } as const;

// ---------------------------------------------------------------------------
// Spotify Development Mode 2026 compatibility
// ---------------------------------------------------------------------------

type SpotifyMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type SpotifyRequestRewrite = {
  path: string;
  body?: unknown;
  fanOutTrackIds?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinRelativePath(
  originalPath: string,
  pathname: string,
  params: URLSearchParams,
): string {
  const prefix = originalPath.startsWith('/') ? '/' : '';
  const query = params.toString();
  return `${prefix}${pathname}${query ? `?${query}` : ''}`;
}

/**
 * Translate endpoints removed or renamed for Spotify Development Mode apps in 2026.
 * The rest of the project can keep its original, well-tested tool handlers.
 */
export function rewriteSpotifyDevelopmentModeRequest(
  method: string,
  path: string,
  body?: unknown,
): SpotifyRequestRewrite {
  const normalizedMethod = method.toUpperCase() as SpotifyMethod;
  const separator = path.indexOf('?');
  const rawPathname = separator >= 0 ? path.slice(0, separator) : path;
  let pathname = rawPathname.replace(/^\/+/, '');
  const params = new URLSearchParams(separator >= 0 ? path.slice(separator + 1) : '');
  let rewrittenBody = body;

  if (pathname === 'search') {
    const requestedLimit = Number(params.get('limit') ?? 5);
    if (!Number.isFinite(requestedLimit) || requestedLimit > 10) {
      params.set('limit', '10');
    }
  }

  const playlistItemsMatch = pathname.match(/^playlists\/([^/]+)\/tracks$/);
  if (playlistItemsMatch) {
    pathname = `playlists/${playlistItemsMatch[1]}/items`;
    if (normalizedMethod === 'DELETE' && isRecord(body) && Array.isArray(body.tracks)) {
      const { tracks, ...rest } = body;
      rewrittenBody = { ...rest, items: tracks };
    }
  }

  if (normalizedMethod === 'POST' && /^users\/[^/]+\/playlists$/.test(pathname)) {
    pathname = 'me/playlists';
  }

  if (
    pathname === 'me/tracks' &&
    (normalizedMethod === 'PUT' || normalizedMethod === 'DELETE') &&
    isRecord(body)
  ) {
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const uris = Array.isArray(body.uris)
      ? body.uris.filter((uri): uri is string => typeof uri === 'string')
      : ids.map((id) => `spotify:track:${id}`);
    pathname = 'me/library';
    rewrittenBody = { uris };
  }

  if (normalizedMethod === 'GET' && pathname === 'me/tracks/contains') {
    const ids = (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    params.delete('ids');
    params.set(
      'uris',
      ids.map((id) => `spotify:track:${id}`).join(','),
    );
    pathname = 'me/library/contains';
  }

  if (normalizedMethod === 'GET' && pathname === 'tracks' && params.has('ids')) {
    const fanOutTrackIds = (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return {
      path: joinRelativePath(path, pathname, params),
      body: rewrittenBody,
      fanOutTrackIds,
    };
  }

  return {
    path: joinRelativePath(path, pathname, params),
    body: rewrittenBody,
  };
}

/**
 * Normalize renamed playlist response fields back to the shapes consumed by the
 * existing codecs (`items` -> `tracks`, playlist entry `item` -> `track`).
 */
export function normalizeSpotifyDevelopmentModeResponse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeSpotifyDevelopmentModeResponse);
  }
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    normalized[key] = normalizeSpotifyDevelopmentModeResponse(nested);
  }

  if ('item' in normalized && !('track' in normalized)) {
    normalized.track = normalized.item;
  }

  const isPlaylist =
    normalized.type === 'playlist' ||
    ('snapshot_id' in normalized &&
      ('owner' in normalized || 'collaborative' in normalized));
  if (isPlaylist && 'items' in normalized && !('tracks' in normalized)) {
    normalized.tracks = normalized.items;
  }

  return normalized;
}

const spotify2026Compatibility = Symbol('spotify2026Compatibility');

type MutableSpotifyApi = {
  makeRequest: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  [spotify2026Compatibility]?: boolean;
};

function withSpotify2026Compatibility(client: SpotifyApi): SpotifyApi {
  const mutable = client as unknown as MutableSpotifyApi;
  if (mutable[spotify2026Compatibility]) {
    return client;
  }

  const originalMakeRequest = mutable.makeRequest.bind(client);
  mutable.makeRequest = async <T>(method: string, path: string, body?: unknown) => {
    const rewrite = rewriteSpotifyDevelopmentModeRequest(method, path, body);

    if (rewrite.fanOutTrackIds) {
      const tracks = await Promise.all(
        rewrite.fanOutTrackIds.map((id) =>
          originalMakeRequest<unknown>('GET', `tracks/${encodeURIComponent(id)}`),
        ),
      );
      return normalizeSpotifyDevelopmentModeResponse({ tracks }) as T;
    }

    const response = await originalMakeRequest<unknown>(
      method,
      rewrite.path,
      rewrite.body,
    );
    return normalizeSpotifyDevelopmentModeResponse(response) as T;
  };
  mutable[spotify2026Compatibility] = true;
  return client;
}

// ---------------------------------------------------------------------------
// App Client (Client Credentials - for non-user APIs like search)
// ---------------------------------------------------------------------------

let appClient: SpotifyApi | null = null;

export function getSpotifyAppClient(): SpotifyApi {
  const clientId = config.SPOTIFY_CLIENT_ID || config.OAUTH_CLIENT_ID;
  const clientSecret = config.SPOTIFY_CLIENT_SECRET || config.OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify client credentials are not configured');
  }

  if (!appClient) {
    const strategy = new ClientCredentialsStrategy(clientId, clientSecret);
    appClient = withSpotify2026Compatibility(new SpotifyApi(strategy, sdkOptions));
  }

  return appClient;
}

// ---------------------------------------------------------------------------
// User Client (OAuth - for user-specific APIs)
// ---------------------------------------------------------------------------

/**
 * Get a Spotify API client for the authenticated user.
 * Uses the provider token from the tool context.
 */
export async function getSpotifyUserClient(
  context: ToolContext,
): Promise<SpotifyApi | null> {
  const clientId = config.SPOTIFY_CLIENT_ID || config.OAUTH_CLIENT_ID;

  if (!clientId) {
    throw new Error('Spotify client id is not configured');
  }

  // Get provider token from context (set by auth middleware)
  const providerToken = context.providerToken || context.provider?.accessToken;

  if (!providerToken) {
    logger.info('spotify_sdk', {
      message: 'No provider token in context',
      sessionId: context.sessionId,
      hasProviderToken: !!context.providerToken,
      hasProvider: !!context.provider,
    });
    return null;
  }

  // Build access token from context
  const accessToken: AccessToken = {
    access_token: providerToken,
    refresh_token: context.provider?.refreshToken || '',
    token_type: 'Bearer',
    expires_in: context.provider?.expiresAt
      ? Math.max(1, Math.round((context.provider.expiresAt - Date.now()) / 1000))
      : 3600,
    expires: context.provider?.expiresAt || Date.now() + 3600 * 1000,
  };

  const strategy = new ContextAuthStrategy(accessToken, context);
  return withSpotify2026Compatibility(new SpotifyApi(strategy, sdkOptions));
}

// ---------------------------------------------------------------------------
// Context-based Auth Strategy
// ---------------------------------------------------------------------------

/**
 * Auth strategy that uses tokens from the request context.
 * Handles token refresh automatically.
 */
class ContextAuthStrategy implements IAuthStrategy {
  private current: AccessToken;
  private context: ToolContext;

  constructor(initialToken: AccessToken, context: ToolContext) {
    this.current = initialToken;
    this.context = context;
  }

  public setConfiguration(_configuration: SdkConfiguration): void {
    // No-op: not needed for our context-based approach
  }

  public async getOrCreateAccessToken(): Promise<AccessToken> {
    const now = Date.now();

    // Check if token is expired or about to expire
    if (this.current.expires && this.current.expires <= now) {
      return this.refreshToken();
    }

    // Proactive refresh if within 30 seconds of expiry
    if (this.current.expires && this.current.expires - now < 30_000) {
      try {
        return await this.refreshToken();
      } catch (error) {
        logger.warning('spotify_sdk', {
          message: 'Silent refresh failed, continuing with existing token',
          error: (error as Error).message,
        });
      }
    }

    return this.current;
  }

  public async getAccessToken(): Promise<AccessToken | null> {
    return this.current;
  }

  public removeAccessToken(): void {
    // No-op: we don't persist tokens in this strategy
  }

  private async refreshToken(): Promise<AccessToken> {
    const refreshToken =
      this.current.refresh_token || this.context.provider?.refreshToken;

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const refreshed = await refreshSpotifyTokens({ refreshToken });
    const accessToken = refreshed.access_token?.trim();

    if (!accessToken) {
      throw new Error('Spotify refresh payload missing access_token');
    }

    const newRefreshToken = refreshed.refresh_token?.trim() || refreshToken;
    const expiresInSeconds = Number(refreshed.expires_in ?? 3600);
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    // Update the token store if we have an RS token reference
    const rsToken = this.context.authHeaders?.authorization?.replace('Bearer ', '');
    if (rsToken) {
      try {
        const store = getTokenStore();
        const record = await store.getByRsAccess(rsToken);
        if (record) {
          // Update the token store with refreshed provider tokens
          await store.storeRsMapping(
            rsToken,
            {
              access_token: accessToken,
              refresh_token: newRefreshToken,
              expires_at: expiresAt,
            },
            record.rs_refresh_token,
          );
        }
      } catch (error) {
        logger.warning('spotify_sdk', {
          message: 'Failed to update token store after refresh',
          error: (error as Error).message,
        });
      }
    }

    this.current = {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      token_type: refreshed.token_type ?? 'Bearer',
      expires_in: expiresInSeconds,
      expires: expiresAt,
    };

    return this.current;
  }
}
