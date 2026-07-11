// Shared OAuth input parsing for both Node.js and Cloudflare Workers

import type { UnifiedConfig } from '../config/env.js';
import type {
  AuthorizeInput,
  OAuthConfig,
  OAuthFlowOptions,
  ProviderConfig,
  TokenInput,
} from './types.js';

export function parseAuthorizeInput(url: URL, sessionId?: string): AuthorizeInput {
  return {
    clientId: url.searchParams.get('client_id') || '',
    codeChallenge: url.searchParams.get('code_challenge') || '',
    codeChallengeMethod: url.searchParams.get('code_challenge_method') || '',
    redirectUri: url.searchParams.get('redirect_uri') || '',
    resource: url.searchParams.get('resource') ?? undefined,
    requestedScope: url.searchParams.get('scope') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    sid: url.searchParams.get('sid') || sessionId || undefined,
  };
}

export function parseCallbackInput(url: URL): {
  code: string | null;
  state: string | null;
} {
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
  };
}

export async function parseTokenInput(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await request.text());
  }
  const json = (await request.json().catch(() => ({}))) as Record<string, string>;
  return new URLSearchParams(json);
}

export function buildTokenInput(form: URLSearchParams): TokenInput | { error: string } {
  const grant = form.get('grant_type');
  const clientId = form.get('client_id') || '';
  const resource = form.get('resource') ?? undefined;

  if (!clientId) return { error: 'missing_client_id' };

  if (grant === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (!refreshToken) return { error: 'missing_refresh_token' };
    return { grant: 'refresh_token', clientId, refreshToken, resource };
  }

  if (grant === 'authorization_code') {
    const code = form.get('code');
    const codeVerifier = form.get('code_verifier');
    const redirectUri = form.get('redirect_uri') || '';
    if (!code || !codeVerifier || !redirectUri) {
      return { error: 'missing_code_verifier_or_redirect_uri' };
    }
    return {
      grant: 'authorization_code',
      clientId,
      code,
      codeVerifier,
      redirectUri,
      resource,
    };
  }

  return { error: 'unsupported_grant_type' };
}

export function buildProviderConfig(config: UnifiedConfig): ProviderConfig {
  return {
    clientId: config.PROVIDER_CLIENT_ID,
    clientSecret: config.PROVIDER_CLIENT_SECRET,
    accountsUrl: config.PROVIDER_ACCOUNTS_URL || 'https://provider.example.com',
    oauthScopes: config.OAUTH_SCOPES,
  };
}

export function buildOAuthConfig(config: UnifiedConfig): OAuthConfig {
  return {
    redirectUri: config.OAUTH_REDIRECT_URI,
    redirectAllowlist: config.OAUTH_REDIRECT_ALLOWLIST,
    redirectAllowAll: config.OAUTH_REDIRECT_ALLOW_ALL,
  };
}

export function buildFlowOptions(
  url: URL,
  config: UnifiedConfig,
  overrides: { callbackPath?: string; tokenEndpointPath?: string } = {},
): OAuthFlowOptions {
  const resource = config.AUTH_RESOURCE_URI || `${url.origin}/mcp`;
  const signingKey = config.RS_TOKENS_ENC_KEY || `${url.origin}|development-only`;
  return {
    baseUrl: url.origin,
    isDev: config.NODE_ENV === 'development',
    callbackPath: overrides.callbackPath ?? '/oauth/callback',
    tokenEndpointPath: overrides.tokenEndpointPath ?? '/api/token',
    clientSigningKey: signingKey,
    resource,
  };
}
