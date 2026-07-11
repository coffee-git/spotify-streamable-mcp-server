// Unified storage interfaces for both Node.js and Cloudflare Workers

export type ProviderTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scopes?: string[];
  client_id?: string;
  resource?: string;
  rs_access_expires_at?: number;
  revoked_at?: number;
};

export type RsRecord = {
  rs_access_token: string;
  rs_refresh_token: string;
  provider: ProviderTokens;
  created_at: number;
};

export type Transaction = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  state?: string;
  scope?: string;
  createdAt: number;
  consumedAt?: number;
  sid?: string;
  provider?: ProviderTokens;
};

export type SessionRecord = {
  rs_access_token?: string;
  rs_refresh_token?: string;
  provider?: ProviderTokens | null;
  created_at: number;
};

export interface TokenStore {
  storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
  ): Promise<RsRecord>;

  getByRsAccess(rsAccess: string): Promise<RsRecord | null>;
  getByRsRefresh(rsRefresh: string): Promise<RsRecord | null>;

  updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ): Promise<RsRecord | null>;

  saveTransaction(txnId: string, txn: Transaction, ttlSeconds?: number): Promise<void>;
  getTransaction(txnId: string): Promise<Transaction | null>;
  deleteTransaction(txnId: string): Promise<void>;

  saveCode(code: string, txnId: string, ttlSeconds?: number): Promise<void>;
  getTxnIdByCode(code: string): Promise<string | null>;
  deleteCode(code: string): Promise<void>;
}

export interface SessionStore {
  ensure(sessionId: string): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  put(sessionId: string, value: SessionRecord): Promise<void>;
  delete(sessionId: string): Promise<void>;
}
