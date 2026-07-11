// OAuth flow types and DTOs

export type AuthorizeInput = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  resource?: string;
  requestedScope?: string;
  state?: string;
  sid?: string;
};

export type AuthorizeResult = {
  redirectTo: string;
  txnId: string;
};

export type CallbackInput = {
  providerCode: string;
  compositeState: string;
};

export type CallbackResult = {
  redirectTo: string;
  txnId: string;
  providerTokens: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    scopes?: string[];
    client_id?: string;
    resource?: string;
  };
};

export type TokenInput =
  | {
      grant: 'authorization_code';
      clientId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
      resource?: string;
    }
  | {
      grant: 'refresh_token';
      clientId: string;
      refreshToken: string;
      resource?: string;
    };

export type TokenResult = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  scope: string;
};

export type RegisterInput = {
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  client_name?: string;
};

export type RegisterResult = {
  client_id: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
  token_endpoint_auth_method: 'none';
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  client_name?: string;
};

export type ProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  accountsUrl: string;
  oauthScopes: string;
};

export type OAuthConfig = {
  redirectUri: string;
  redirectAllowlist: string[];
  redirectAllowAll: boolean;
};

export type OAuthFlowOptions = {
  baseUrl: string;
  isDev: boolean;
  callbackPath: string;
  tokenEndpointPath: string;
  clientSigningKey: string;
  resource: string;
};
