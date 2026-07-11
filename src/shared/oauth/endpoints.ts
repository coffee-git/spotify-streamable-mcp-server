// Framework-agnostic OAuth endpoint handlers

import type { TokenStore } from '../storage/interface.js';
import { issueClientId, validateRedirectUri } from './client-registration.js';
import type { RegisterInput, RegisterResult } from './types.js';

export async function handleRegister(
  input: RegisterInput,
  _baseUrl: string,
  defaultRedirectUri: string,
  signingKey = defaultRedirectUri,
): Promise<RegisterResult> {
  const now = Math.floor(Date.now() / 1000);
  const redirectUris = Array.isArray(input.redirect_uris) && input.redirect_uris.length > 0
    ? [...new Set(input.redirect_uris)]
    : [defaultRedirectUri];

  for (const uri of redirectUris) validateRedirectUri(uri);

  const grantTypes = input.grant_types?.length
    ? [...new Set(input.grant_types)]
    : ['authorization_code', 'refresh_token'];
  const responseTypes = input.response_types?.length
    ? [...new Set(input.response_types)]
    : ['code'];

  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') {
    throw new Error('invalid_client_metadata: only public PKCE clients are supported');
  }
  if (!grantTypes.includes('authorization_code') || !responseTypes.includes('code')) {
    throw new Error('invalid_client_metadata: authorization_code and code are required');
  }

  const client = {
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    client_name: input.client_name,
    issued_at: now,
  };

  return {
    client_id: await issueClientId(client, signingKey),
    client_id_issued_at: now,
    client_secret_expires_at: 0,
    token_endpoint_auth_method: 'none',
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    ...(input.client_name ? { client_name: input.client_name } : {}),
  };
}

export async function handleRevoke(
  token?: string,
  store?: TokenStore,
): Promise<{ status: string }> {
  if (!token || !store) return { status: 'ok' };

  const byRefresh = await store.getByRsRefresh(token);
  const record = byRefresh ?? (await store.getByRsAccess(token));
  if (!record) return { status: 'ok' };

  await store.updateByRsRefresh(record.rs_refresh_token, {
    ...record.provider,
    revoked_at: Date.now(),
    rs_access_expires_at: Date.now(),
  });
  return { status: 'ok' };
}
