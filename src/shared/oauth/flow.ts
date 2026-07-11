// Core OAuth flow logic: PKCE, provider exchange, audience binding, and RS tokens

import { createHash, randomBytes } from 'node:crypto';
import type { ProviderTokens, TokenStore } from '../storage/interface.js';
import { sharedLogger as logger } from '../utils/logger.js';
import { verifyClientId } from './client-registration.js';
import type {
  AuthorizeInput,
  AuthorizeResult,
  CallbackInput,
  CallbackResult,
  OAuthConfig,
  OAuthFlowOptions,
  ProviderConfig,
  TokenInput,
  TokenResult,
} from './types.js';

const RS_ACCESS_TTL_SECONDS = 3600;

function base64Encode(input: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'utf8').toString('base64');
  return btoa(input);
}

function b64url(input: Buffer | Uint8Array): string {
  let base64: string;
  if (typeof Buffer !== 'undefined' && input instanceof Buffer) {
    base64 = input.toString('base64');
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256B64UrlAsync(input: string): Promise<string> {
  if (typeof Buffer !== 'undefined') return b64url(createHash('sha256').update(input).digest());
  const data = new TextEncoder().encode(input);
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export function generateOpaqueToken(bytes = 32): string {
  if (typeof Buffer !== 'undefined') return b64url(randomBytes(bytes));
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return b64url(array);
}

function normalizeResource(resource: string): string {
  const parsed = new URL(resource);
  parsed.hash = '';
  return parsed.toString();
}

function assertResource(received: string | undefined, expected: string): string {
  const canonical = normalizeResource(expected);
  const supplied = normalizeResource(received || expected);
  if (supplied !== canonical) throw new Error('invalid_target: resource does not match this MCP server');
  return canonical;
}

async function validatePublicClient(
  clientId: string,
  redirectUri: string,
  options: OAuthFlowOptions,
): Promise<void> {
  if (!clientId) throw new Error('invalid_request: client_id is required');
  const client = await verifyClientId(clientId, options.clientSigningKey);
  if (!client) throw new Error('invalid_client');
  if (!client.redirect_uris.includes(redirectUri)) throw new Error('invalid_redirect_uri');
}

function ensureAllowedFallbackRedirect(uri: string, config: OAuthConfig, isDev: boolean): boolean {
  try {
    const parsed = new URL(uri);
    if (isDev && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return true;
    if (config.redirectAllowAll) return true;
    const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    return config.redirectAllowlist.includes(uri) || config.redirectAllowlist.includes(normalized) || config.redirectUri === uri;
  } catch {
    return false;
  }
}

export async function handleAuthorize(
  input: AuthorizeInput,
  store: TokenStore,
  providerConfig: ProviderConfig,
  oauthConfig: OAuthConfig,
  options: OAuthFlowOptions,
): Promise<AuthorizeResult> {
  if (!input.redirectUri) throw new Error('invalid_request: redirect_uri is required');
  if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
    throw new Error('invalid_request: PKCE code_challenge with S256 is required');
  }

  await validatePublicClient(input.clientId, input.redirectUri, options);
  const resource = assertResource(input.resource, options.resource);

  const txnId = generateOpaqueToken(24);
  await store.saveTransaction(txnId, {
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource,
    state: input.state,
    createdAt: Date.now(),
    scope: input.requestedScope,
    sid: input.sid,
  });

  if (providerConfig.clientId && providerConfig.clientSecret) {
    const authUrl = new URL('/authorize', providerConfig.accountsUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', providerConfig.clientId);
    authUrl.searchParams.set('redirect_uri', new URL(options.callbackPath, options.baseUrl).toString());
    const scopeToUse = providerConfig.oauthScopes || input.requestedScope || '';
    if (scopeToUse) authUrl.searchParams.set('scope', scopeToUse);
    authUrl.searchParams.set('state', txnId);
    return { redirectTo: authUrl.toString(), txnId };
  }

  if (!options.isDev) throw new Error('server_error: Spotify OAuth credentials are missing');

  const code = generateOpaqueToken(24);
  await store.saveCode(code, txnId);
  const safeRedirect = ensureAllowedFallbackRedirect(input.redirectUri, oauthConfig, true)
    ? input.redirectUri
    : oauthConfig.redirectUri;
  const redirect = new URL(safeRedirect);
  redirect.searchParams.set('code', code);
  if (input.state) redirect.searchParams.set('state', input.state);
  return { redirectTo: redirect.toString(), txnId };
}

export async function handleProviderCallback(
  input: CallbackInput,
  store: TokenStore,
  providerConfig: ProviderConfig,
  _oauthConfig: OAuthConfig,
  options: OAuthFlowOptions,
): Promise<CallbackResult> {
  const txnId = input.compositeState;
  const txn = await store.getTransaction(txnId);
  if (!txn || txn.consumedAt) throw new Error('unknown_txn');
  if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error('server_error: provider credentials missing');

  const tokenUrl = new URL(options.tokenEndpointPath, providerConfig.accountsUrl).toString();
  const callback = new URL(options.callbackPath, options.baseUrl).toString();
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.providerCode,
    redirect_uri: callback,
  });
  const basic = base64Encode(`${providerConfig.clientId}:${providerConfig.clientSecret}`);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: form.toString(),
  });

  if (!response.ok) {
    logger.error('oauth_callback', { message: 'Spotify token exchange failed', status: response.status });
    throw new Error(`provider_token_error: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    scope?: string;
  };
  if (!data.access_token) throw new Error('provider_no_token');

  const providerTokens: ProviderTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    scopes: String(data.scope || '').split(/\s+/).filter(Boolean),
    client_id: txn.clientId,
    resource: txn.resource,
  };

  txn.provider = providerTokens;
  await store.saveTransaction(txnId, txn);
  const code = generateOpaqueToken(24);
  await store.saveCode(code, txnId);

  const redirect = new URL(txn.redirectUri);
  redirect.searchParams.set('code', code);
  if (txn.state) redirect.searchParams.set('state', txn.state);
  return { redirectTo: redirect.toString(), txnId, providerTokens };
}

async function refreshProviderToken(
  providerRefreshToken: string,
  providerConfig: ProviderConfig,
  previous: ProviderTokens,
): Promise<ProviderTokens> {
  if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error('provider_refresh_unavailable');
  const tokenUrl = new URL('/api/token', providerConfig.accountsUrl).toString();
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: providerRefreshToken,
  });
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${base64Encode(`${providerConfig.clientId}:${providerConfig.clientSecret}`)}`,
    },
    body: form.toString(),
  });
  if (!response.ok) throw new Error('provider_refresh_failed');

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    scope?: string;
  };
  if (!data.access_token) throw new Error('provider_no_token');
  return {
    ...previous,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? providerRefreshToken,
    expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : previous.scopes,
    revoked_at: undefined,
  };
}

function validateTokenBinding(
  clientId: string,
  resource: string | undefined,
  bound: ProviderTokens,
): void {
  if (!bound.client_id || bound.client_id !== clientId) throw new Error('invalid_client');
  if (!bound.resource) throw new Error('invalid_target');
  if (normalizeResource(resource || bound.resource) !== normalizeResource(bound.resource)) {
    throw new Error('invalid_target');
  }
  if (bound.revoked_at) throw new Error('invalid_grant');
}

export async function handleToken(
  input: TokenInput,
  store: TokenStore,
  providerConfig?: ProviderConfig,
): Promise<TokenResult> {
  if (input.grant === 'refresh_token') {
    const record = await store.getByRsRefresh(input.refreshToken);
    if (!record) throw new Error('invalid_grant');
    validateTokenBinding(input.clientId, input.resource, record.provider);

    const now = Date.now();
    let provider = record.provider;
    if (now >= (provider.expires_at ?? 0) - 60_000) {
      if (!provider.refresh_token || !providerConfig) throw new Error('provider_token_expired');
      provider = await refreshProviderToken(provider.refresh_token, providerConfig, provider);
    }

    const newAccess = generateOpaqueToken(24);
    provider = {
      ...provider,
      rs_access_expires_at: now + RS_ACCESS_TTL_SECONDS * 1000,
      revoked_at: undefined,
    };
    const updated = await store.updateByRsRefresh(input.refreshToken, provider, newAccess);
    if (!updated) throw new Error('invalid_grant');
    return {
      access_token: newAccess,
      refresh_token: input.refreshToken,
      token_type: 'bearer',
      expires_in: RS_ACCESS_TTL_SECONDS,
      scope: (updated.provider.scopes || []).join(' '),
    };
  }

  const txnId = await store.getTxnIdByCode(input.code);
  if (!txnId) throw new Error('invalid_grant');
  const txn = await store.getTransaction(txnId);
  if (!txn || txn.consumedAt) throw new Error('invalid_grant');
  if (txn.clientId !== input.clientId) throw new Error('invalid_client');
  if (txn.redirectUri !== input.redirectUri) throw new Error('invalid_grant');
  if (normalizeResource(input.resource || txn.resource) !== normalizeResource(txn.resource)) {
    throw new Error('invalid_target');
  }
  if ((await sha256B64UrlAsync(input.codeVerifier)) !== txn.codeChallenge) {
    throw new Error('invalid_grant');
  }
  if (!txn.provider?.access_token) throw new Error('invalid_grant');

  txn.consumedAt = Date.now();
  await store.saveTransaction(txnId, txn, 60);
  await store.deleteCode(input.code);

  const rsAccess = generateOpaqueToken(24);
  const rsRefresh = generateOpaqueToken(24);
  const provider: ProviderTokens = {
    ...txn.provider,
    client_id: txn.clientId,
    resource: txn.resource,
    rs_access_expires_at: Date.now() + RS_ACCESS_TTL_SECONDS * 1000,
    revoked_at: undefined,
  };
  await store.storeRsMapping(rsAccess, provider, rsRefresh);
  await store.deleteTransaction(txnId);

  return {
    access_token: rsAccess,
    refresh_token: rsRefresh,
    token_type: 'bearer',
    expires_in: RS_ACCESS_TTL_SECONDS,
    scope: (provider.scopes || []).join(' ') || txn.scope || '',
  };
}
