// Hono adapter for OAuth routes

import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import type { UnifiedConfig } from '../../shared/config/env.js';
import { handleRegister, handleRevoke } from '../../shared/oauth/endpoints.js';
import {
  handleAuthorize,
  handleProviderCallback,
  handleToken,
} from '../../shared/oauth/flow.js';
import {
  buildFlowOptions,
  buildOAuthConfig,
  buildProviderConfig,
  buildTokenInput,
  parseAuthorizeInput,
  parseCallbackInput,
  parseTokenInput,
} from '../../shared/oauth/input-parsers.js';
import type { TokenStore } from '../../shared/storage/interface.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

export function buildOAuthRoutes(
  store: TokenStore,
  config: UnifiedConfig,
): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const providerConfig = buildProviderConfig(config);
  const oauthConfig = buildOAuthConfig(config);

  app.get('/authorize', async (c) => {
    try {
      const url = new URL(c.req.url);
      const result = await handleAuthorize(
        parseAuthorizeInput(url, c.req.header('Mcp-Session-Id')),
        store,
        providerConfig,
        oauthConfig,
        buildFlowOptions(url, config),
      );
      return c.redirect(result.redirectTo, 302);
    } catch (error) {
      logger.error('oauth_hono', {
        message: 'Authorize failed',
        error: (error as Error).message,
      });
      return c.text((error as Error).message || 'Authorization failed', 400);
    }
  });

  app.get('/oauth/callback', async (c) => {
    try {
      const url = new URL(c.req.url);
      const { code, state } = parseCallbackInput(url);
      if (!code || !state) return c.text('invalid_callback: missing code or state', 400);
      const result = await handleProviderCallback(
        { providerCode: code, compositeState: state },
        store,
        providerConfig,
        oauthConfig,
        buildFlowOptions(url, config),
      );
      return c.redirect(result.redirectTo, 302);
    } catch (error) {
      logger.error('oauth_hono', {
        message: 'Callback failed',
        error: (error as Error).message,
      });
      return c.text((error as Error).message || 'Callback failed', 500);
    }
  });

  app.post('/token', async (c) => {
    try {
      const tokenInput = buildTokenInput(await parseTokenInput(c.req.raw));
      if ('error' in tokenInput) return c.json({ error: tokenInput.error }, 400);
      return c.json(await handleToken(tokenInput, store, providerConfig));
    } catch (error) {
      logger.error('oauth_hono', {
        message: 'Token exchange failed',
        error: (error as Error).message,
      });
      return c.json({ error: (error as Error).message || 'invalid_grant' }, 400);
    }
  });

  app.post('/revoke', async (c) => {
    const form = await parseTokenInput(c.req.raw);
    return c.json(await handleRevoke(form.get('token') ?? undefined, store));
  });

  app.post('/register', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const url = new URL(c.req.url);
      const result = await handleRegister(
        {
          redirect_uris: Array.isArray(body.redirect_uris)
            ? (body.redirect_uris as string[])
            : undefined,
          grant_types: Array.isArray(body.grant_types)
            ? (body.grant_types as string[])
            : undefined,
          response_types: Array.isArray(body.response_types)
            ? (body.response_types as string[])
            : undefined,
          token_endpoint_auth_method:
            typeof body.token_endpoint_auth_method === 'string'
              ? body.token_endpoint_auth_method
              : undefined,
          client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
        },
        url.origin,
        config.OAUTH_REDIRECT_URI,
        config.RS_TOKENS_ENC_KEY || `${url.origin}|development-only`,
      );
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  return app;
}
