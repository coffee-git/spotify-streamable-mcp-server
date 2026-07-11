// Workers adapter for MCP security

import type { UnifiedConfig } from '../../shared/config/env.js';
import { withCors } from '../../shared/http/cors.js';
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from '../../shared/mcp/security.js';
import type { TokenStore } from '../../shared/storage/interface.js';

function unauthorized(request: Request, sid: string, message = 'Unauthorized'): Response {
  const challenge = buildUnauthorizedChallenge({
    origin: new URL(request.url).origin,
    sid,
    message,
  });
  return withCors(
    new Response(JSON.stringify(challenge.body), {
      status: challenge.status,
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sid,
        'WWW-Authenticate': challenge.headers['WWW-Authenticate'],
      },
    }),
  );
}

function normalizeResource(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

export async function checkAuthAndChallenge(
  request: Request,
  store: TokenStore,
  config: UnifiedConfig,
  sid: string,
): Promise<Response | null> {
  try {
    validateOrigin(request.headers, config.NODE_ENV === 'development');
    validateProtocolVersion(request.headers, config.MCP_PROTOCOL_VERSION);
  } catch (error) {
    return unauthorized(request, sid, (error as Error).message);
  }

  if (!config.AUTH_ENABLED) return null;

  const authHeader = request.headers.get('Authorization');
  const apiKeyHeader = request.headers.get('x-api-key') || request.headers.get('x-auth-token');
  if (!authHeader && !apiKeyHeader) return unauthorized(request, sid);

  if (!config.AUTH_REQUIRE_RS || !authHeader) return null;

  const bearer = authHeader.match(/^\s*Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return unauthorized(request, sid);

  const record = await store.getByRsAccess(bearer);
  if (!record?.provider?.access_token) {
    return config.AUTH_ALLOW_DIRECT_BEARER ? null : unauthorized(request, sid);
  }

  const provider = record.provider;
  const expectedResource = config.AUTH_RESOURCE_URI || `${new URL(request.url).origin}/mcp`;
  const expired = !provider.rs_access_expires_at || Date.now() >= provider.rs_access_expires_at;
  const revoked = Boolean(provider.revoked_at);
  const wrongAudience = !provider.resource
    || normalizeResource(provider.resource) !== normalizeResource(expectedResource);

  if (expired || revoked || wrongAudience) {
    return unauthorized(request, sid, 'Invalid or expired access token');
  }

  return null;
}
