import type { ProviderTokens, TokenStore } from '../storage/interface.js';
import { sharedLogger as logger } from '../utils/logger.js';

export interface ProviderRefreshConfig {
  clientId: string;
  clientSecret: string;
  accountsUrl: string;
  tokenEndpointPath?: string;
}

export function buildProviderRefreshConfig(config: {
  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_ACCOUNTS_URL?: string;
  OAUTH_TOKEN_URL?: string;
}): ProviderRefreshConfig | undefined {
  if (!config.PROVIDER_CLIENT_ID || !config.PROVIDER_CLIENT_SECRET || !config.PROVIDER_ACCOUNTS_URL) {
    return undefined;
  }
  return {
    clientId: config.PROVIDER_CLIENT_ID,
    clientSecret: config.PROVIDER_CLIENT_SECRET,
    accountsUrl: config.PROVIDER_ACCOUNTS_URL,
    tokenEndpointPath: config.OAUTH_TOKEN_URL,
  };
}

export interface RefreshResult {
  success: boolean;
  tokens?: Pick<ProviderTokens, 'access_token' | 'refresh_token' | 'expires_at' | 'scopes'>;
  error?: string;
}

function base64Encode(input: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'utf8').toString('base64');
  return btoa(input);
}

export async function refreshProviderToken(
  refreshToken: string,
  config: ProviderRefreshConfig,
): Promise<RefreshResult> {
  const tokenUrl = new URL(config.tokenEndpointPath || '/api/token', config.accountsUrl).toString();
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${base64Encode(`${config.clientId}:${config.clientSecret}`)}`,
      },
      body: form.toString(),
    });
    if (!response.ok) {
      logger.error('oauth_refresh', {
        message: 'Provider refresh failed',
        status: response.status,
      });
      return { success: false, error: `Provider returned ${response.status}` };
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number | string;
      scope?: string;
    };
    if (!data.access_token) return { success: false, error: 'No access_token in provider response' };

    return {
      success: true,
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? refreshToken,
        expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
        scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : undefined,
      },
    };
  } catch (error) {
    return { success: false, error: `Network error: ${(error as Error).message}` };
  }
}

const EXPIRY_BUFFER_MS = 60_000;
const REFRESH_COOLDOWN_MS = 30_000;
const recentlyRefreshed = new Map<string, number>();

export function isTokenExpiredOrExpiring(
  expiresAt: number | undefined,
  bufferMs = EXPIRY_BUFFER_MS,
): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - bufferMs;
}

function shouldSkipRefresh(rsToken: string): boolean {
  const timestamp = recentlyRefreshed.get(rsToken);
  return Boolean(timestamp && Date.now() - timestamp < REFRESH_COOLDOWN_MS);
}

export async function ensureFreshToken(
  rsAccessToken: string,
  tokenStore: TokenStore,
  providerConfig: ProviderRefreshConfig | undefined,
): Promise<{ accessToken: string; wasRefreshed: boolean }> {
  const record = await tokenStore.getByRsAccess(rsAccessToken);
  if (!record?.provider?.access_token || record.provider.revoked_at) {
    return { accessToken: '', wasRefreshed: false };
  }
  if (!isTokenExpiredOrExpiring(record.provider.expires_at)) {
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }
  if (shouldSkipRefresh(rsAccessToken)) {
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }
  if (!record.provider.refresh_token || !providerConfig) {
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  const result = await refreshProviderToken(record.provider.refresh_token, providerConfig);
  if (!result.success || !result.tokens) {
    logger.error('oauth_refresh', { message: 'Token refresh failed', error: result.error });
    return { accessToken: record.provider.access_token, wasRefreshed: false };
  }

  const merged: ProviderTokens = {
    ...record.provider,
    ...result.tokens,
    scopes: result.tokens.scopes ?? record.provider.scopes,
  };
  await tokenStore.updateByRsRefresh(record.rs_refresh_token, merged);
  recentlyRefreshed.set(rsAccessToken, Date.now());
  return { accessToken: merged.access_token, wasRefreshed: true };
}
