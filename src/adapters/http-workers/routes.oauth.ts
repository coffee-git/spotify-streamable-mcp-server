// Workers adapter for OAuth routes using itty-router

interface IttyRouter {
  get(path: string, handler: (request: Request) => Promise<Response>): void;
  post(path: string, handler: (request: Request) => Promise<Response>): void;
}

import type { UnifiedConfig } from '../../shared/config/env.js';
import {
  jsonResponse,
  oauthError,
  redirectResponse,
  textError,
} from '../../shared/http/response.js';
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

export function attachOAuthRoutes(
  router: IttyRouter,
  store: TokenStore,
  config: UnifiedConfig,
): void {
  const providerConfig = buildProviderConfig(config);
  const oauthConfig = buildOAuthConfig(config);

  router.get('/authorize', async (request: Request) => {
    try {
      const url = new URL(request.url);
      const sessionId = request.headers.get('Mcp-Session-Id') ?? undefined;
      const result = await handleAuthorize(
        parseAuthorizeInput(url, sessionId),
        store,
        providerConfig,
        oauthConfig,
        buildFlowOptions(url, config),
      );
      return redirectResponse(result.redirectTo);
    } catch (error) {
      logger.error('oauth_workers', {
        message: 'Authorize failed',
        error: (error as Error).message,
      });
      return textError((error as Error).message || 'Authorization failed', { status: 400 });
    }
  });

  router.get('/oauth/callback', async (request: Request) => {
    try {
      const url = new URL(request.url);
      const { code, state } = parseCallbackInput(url);
      if (!code || !state) return textError('invalid_callback: missing code or state');
      const result = await handleProviderCallback(
        { providerCode: code, compositeState: state },
        store,
        providerConfig,
        oauthConfig,
        buildFlowOptions(url, config),
      );
      return redirectResponse(result.redirectTo);
    } catch (error) {
      logger.error('oauth_workers', {
        message: 'Callback failed',
        error: (error as Error).message,
      });
      return textError((error as Error).message || 'Callback failed', { status: 500 });
    }
  });

  router.post('/token', async (request: Request) => {
    try {
      const tokenInput = buildTokenInput(await parseTokenInput(request));
      if ('error' in tokenInput) return oauthError(tokenInput.error);
      return jsonResponse(await handleToken(tokenInput, store, providerConfig));
    } catch (error) {
      logger.error('oauth_workers', {
        message: 'Token exchange failed',
        error: (error as Error).message,
      });
      return oauthError((error as Error).message || 'invalid_grant');
    }
  });

  router.post('/revoke', async (request: Request) => {
    const form = await parseTokenInput(request);
    return jsonResponse(await handleRevoke(form.get('token') ?? undefined, store));
  });

  router.post('/register', async (request: Request) => {
    try {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const url = new URL(request.url);
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
      return jsonResponse(result, { status: 201 });
    } catch (error) {
      return oauthError((error as Error).message);
    }
  });
}
