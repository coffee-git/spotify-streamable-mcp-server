// Hono adapter for MCP security middleware

import { randomUUID } from 'node:crypto';
import type { HttpBindings } from '@hono/node-server';
import type { MiddlewareHandler } from 'hono';
import type { UnifiedConfig } from '../../shared/config/env.js';
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from '../../shared/mcp/security.js';
import {
  buildProviderRefreshConfig,
  ensureFreshToken,
} from '../../shared/oauth/refresh.js';
import { getTokenStore } from '../../shared/storage/singleton.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

function normalizeResource(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

export function createMcpSecurityMiddleware(config: UnifiedConfig): MiddlewareHandler<{
  Bindings: HttpBindings;
}> {
  return async (c, next) => {
    const challenge = (message = 'Unauthorized') => {
      const sid = c.req.header('Mcp-Session-Id') ?? randomUUID();
      const origin = new URL(c.req.url).origin;
      const response = buildUnauthorizedChallenge({ origin, sid, message });
      c.header('Mcp-Session-Id', sid);
      c.header('WWW-Authenticate', response.headers['WWW-Authenticate']);
      return c.json(response.body, response.status);
    };

    try {
      validateOrigin(c.req.raw.headers, config.NODE_ENV === 'development');
      validateProtocolVersion(c.req.raw.headers, config.MCP_PROTOCOL_VERSION);
      if (!config.AUTH_ENABLED) return next();

      const auth = c.req.header('Authorization') ?? undefined;
      if (!auth) return challenge();

      const [scheme, tokenPart] = auth.split(' ', 2);
      const bearer = scheme?.toLowerCase() === 'bearer' ? (tokenPart || '').trim() : '';
      if (!bearer) return challenge();

      const store = getTokenStore();
      const initial = await store.getByRsAccess(bearer);
      if (!initial?.provider?.access_token) {
        return config.AUTH_ALLOW_DIRECT_BEARER ? next() : challenge();
      }

      const expectedResource = config.AUTH_RESOURCE_URI || `${new URL(c.req.url).origin}/mcp`;
      const invalid = Boolean(initial.provider.revoked_at)
        || !initial.provider.rs_access_expires_at
        || Date.now() >= initial.provider.rs_access_expires_at
        || !initial.provider.resource
        || normalizeResource(initial.provider.resource) !== normalizeResource(expectedResource);
      if (invalid) return challenge('Invalid or expired access token');

      const providerConfig = buildProviderRefreshConfig(config);
      const { accessToken, wasRefreshed } = await ensureFreshToken(
        bearer,
        store,
        providerConfig,
      );
      const record = await store.getByRsAccess(bearer);
      const provider = record?.provider;
      if (!provider || !accessToken) return challenge();

      if (wasRefreshed) {
        logger.info('mcp_security', { message: 'Provider token refreshed proactively' });
      }

      const authContext = {
        strategy: config.AUTH_STRATEGY as
          | 'oauth'
          | 'bearer'
          | 'api_key'
          | 'custom'
          | 'none',
        authHeaders: { authorization: auth },
        resolvedHeaders: { authorization: `Bearer ${accessToken}` },
        providerToken: accessToken,
        provider: {
          access_token: provider.access_token,
          refresh_token: provider.refresh_token,
          expires_at: provider.expires_at,
          scopes: provider.scopes,
        },
        rsToken: bearer,
      };
      (c as unknown as { authContext: typeof authContext }).authContext = authContext;
      return next();
    } catch (error) {
      logger.error('mcp_security', {
        message: 'Security check failed',
        error: (error as Error).message,
      });
      return challenge('Security validation failed');
    }
  };
}
