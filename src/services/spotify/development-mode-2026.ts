import type { SpotifyApi } from '@spotify/web-api-ts-sdk';

type SpotifyMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type LibraryRewrite = {
  method: 'GET' | 'PUT' | 'DELETE';
  uriBatches: string[][];
};

export type SpotifyRequestRewrite = {
  path: string;
  body?: unknown;
  fanOutTrackIds?: string[];
  library?: LibraryRewrite;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

function libraryPath(method: 'GET' | 'PUT' | 'DELETE', uris: string[]): string {
  const params = new URLSearchParams({ uris: uris.join(',') });
  const pathname = method === 'GET' ? 'me/library/contains' : 'me/library';
  return `${pathname}?${params.toString()}`;
}

/**
 * Translate endpoints removed or renamed for Spotify Development Mode apps in 2026.
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
    const uriBatches = chunk(uris, 40);
    return {
      path: libraryPath(normalizedMethod, uriBatches[0] ?? []),
      library: { method: normalizedMethod, uriBatches },
    };
  }

  if (normalizedMethod === 'GET' && pathname === 'me/tracks/contains') {
    const ids = (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const uriBatches = chunk(
      ids.map((id) => `spotify:track:${id}`),
      40,
    );
    return {
      path: libraryPath('GET', uriBatches[0] ?? []),
      library: { method: 'GET', uriBatches },
    };
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
 * Normalize renamed playlist fields back to the shapes used by existing codecs.
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

const compatibilityMarker = Symbol('spotifyDevelopmentMode2026');

type MutableSpotifyApi = {
  makeRequest: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  [compatibilityMarker]?: boolean;
};

export function withSpotify2026Compatibility(client: SpotifyApi): SpotifyApi {
  const mutable = client as unknown as MutableSpotifyApi;
  if (mutable[compatibilityMarker]) {
    return client;
  }

  const originalMakeRequest = mutable.makeRequest.bind(client);
  mutable.makeRequest = async <T>(method: string, path: string, body?: unknown) => {
    const rewrite = rewriteSpotifyDevelopmentModeRequest(method, path, body);

    if (rewrite.library) {
      const responses: boolean[] = [];
      for (const uris of rewrite.library.uriBatches) {
        const response = await originalMakeRequest<unknown>(
          rewrite.library.method,
          libraryPath(rewrite.library.method, uris),
        );
        if (rewrite.library.method === 'GET' && Array.isArray(response)) {
          responses.push(...response.filter((item): item is boolean => typeof item === 'boolean'));
        }
      }
      return (rewrite.library.method === 'GET' ? responses : null) as T;
    }

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
  mutable[compatibilityMarker] = true;
  return client;
}
