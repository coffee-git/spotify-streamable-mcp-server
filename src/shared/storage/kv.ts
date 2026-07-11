// Cloudflare KV storage with encryption support

import type {
  ProviderTokens,
  RsRecord,
  SessionRecord,
  SessionStore,
  TokenStore,
  Transaction,
} from './interface.js';
import { MemorySessionStore, MemoryTokenStore } from './memory.js';

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

type EncryptFn = (plaintext: string) => Promise<string> | string;
type DecryptFn = (ciphertext: string) => Promise<string> | string;

function expiration(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class KvTokenStore implements TokenStore {
  private kv: KVNamespace;
  private encrypt: EncryptFn;
  private decrypt: DecryptFn;
  private fallback: MemoryTokenStore;

  constructor(
    kv: KVNamespace,
    options?: {
      encrypt?: EncryptFn;
      decrypt?: DecryptFn;
      fallback?: MemoryTokenStore;
    },
  ) {
    this.kv = kv;
    this.encrypt = options?.encrypt ?? ((value) => value);
    this.decrypt = options?.decrypt ?? ((value) => value);
    this.fallback = options?.fallback ?? new MemoryTokenStore();
  }

  private async putJson(
    key: string,
    value: unknown,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void> {
    const raw = await this.encrypt(JSON.stringify(value));
    await this.kv.put(key, raw, options);
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    return parseJson<T>(await this.decrypt(raw));
  }

  async storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
  ): Promise<RsRecord> {
    const record: RsRecord = {
      rs_access_token: rsAccess,
      rs_refresh_token: rsRefresh ?? crypto.randomUUID(),
      provider: { ...provider },
      created_at: Date.now(),
    };
    await this.fallback.storeRsMapping(rsAccess, provider, record.rs_refresh_token);
    await Promise.all([
      this.putJson(`rs:access:${record.rs_access_token}`, record),
      this.putJson(`rs:refresh:${record.rs_refresh_token}`, record),
    ]);
    return record;
  }

  async getByRsAccess(rsAccess: string): Promise<RsRecord | null> {
    const cached = await this.fallback.getByRsAccess(rsAccess);
    if (cached) return cached;
    const record = await this.getJson<RsRecord>(`rs:access:${rsAccess}`);
    if (record) {
      await this.fallback.storeRsMapping(
        record.rs_access_token,
        record.provider,
        record.rs_refresh_token,
      );
    }
    return record;
  }

  async getByRsRefresh(rsRefresh: string): Promise<RsRecord | null> {
    const cached = await this.fallback.getByRsRefresh(rsRefresh);
    if (cached) return cached;
    const record = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`);
    if (record) {
      await this.fallback.storeRsMapping(
        record.rs_access_token,
        record.provider,
        record.rs_refresh_token,
      );
    }
    return record;
  }

  async updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ): Promise<RsRecord | null> {
    const existing = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`)
      ?? (await this.fallback.getByRsRefresh(rsRefresh));
    if (!existing) return null;

    const next: RsRecord = {
      rs_access_token: maybeNewRsAccess || existing.rs_access_token,
      rs_refresh_token: rsRefresh,
      provider: { ...provider },
      created_at: Date.now(),
    };
    await this.fallback.updateByRsRefresh(rsRefresh, provider, maybeNewRsAccess);

    const writes: Promise<void>[] = [
      this.putJson(`rs:access:${next.rs_access_token}`, next),
      this.putJson(`rs:refresh:${rsRefresh}`, next),
    ];
    if (next.rs_access_token !== existing.rs_access_token) {
      writes.push(this.kv.delete(`rs:access:${existing.rs_access_token}`));
    }
    await Promise.all(writes);
    return next;
  }

  async saveTransaction(
    txnId: string,
    txn: Transaction,
    ttlSeconds = 600,
  ): Promise<void> {
    await this.fallback.saveTransaction(txnId, txn, ttlSeconds);
    await this.putJson(`txn:${txnId}`, txn, { expiration: expiration(ttlSeconds) });
  }

  async getTransaction(txnId: string): Promise<Transaction | null> {
    const cached = await this.fallback.getTransaction(txnId);
    if (cached) return cached;
    const transaction = await this.getJson<Transaction>(`txn:${txnId}`);
    if (transaction) await this.fallback.saveTransaction(txnId, transaction);
    return transaction;
  }

  async deleteTransaction(txnId: string): Promise<void> {
    await Promise.all([
      this.kv.delete(`txn:${txnId}`),
      this.fallback.deleteTransaction(txnId),
    ]);
  }

  async saveCode(code: string, txnId: string, ttlSeconds = 600): Promise<void> {
    await this.fallback.saveCode(code, txnId, ttlSeconds);
    await this.putJson(`code:${code}`, { v: txnId }, { expiration: expiration(ttlSeconds) });
  }

  async getTxnIdByCode(code: string): Promise<string | null> {
    const cached = await this.fallback.getTxnIdByCode(code);
    if (cached) return cached;
    const record = await this.getJson<{ v: string }>(`code:${code}`);
    if (record?.v) await this.fallback.saveCode(code, record.v);
    return record?.v ?? null;
  }

  async deleteCode(code: string): Promise<void> {
    await Promise.all([
      this.kv.delete(`code:${code}`),
      this.fallback.deleteCode(code),
    ]);
  }
}

const SESSION_KEY_PREFIX = 'session:';
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export class KvSessionStore implements SessionStore {
  private kv: KVNamespace;
  private encrypt: EncryptFn;
  private decrypt: DecryptFn;
  private fallback: MemorySessionStore;

  constructor(
    kv: KVNamespace,
    options?: {
      encrypt?: EncryptFn;
      decrypt?: DecryptFn;
      fallback?: MemorySessionStore;
    },
  ) {
    this.kv = kv;
    this.encrypt = options?.encrypt ?? ((value) => value);
    this.decrypt = options?.decrypt ?? ((value) => value);
    this.fallback = options?.fallback ?? new MemorySessionStore();
  }

  private async putSession(key: string, value: SessionRecord): Promise<void> {
    const raw = await this.encrypt(JSON.stringify(value));
    await this.kv.put(`${SESSION_KEY_PREFIX}${key}`, raw, {
      expiration: expiration(SESSION_TTL_SECONDS),
    });
    await this.fallback.put(key, value);
  }

  private async getSession(key: string): Promise<SessionRecord | null> {
    const cached = await this.fallback.get(key);
    if (cached) return cached;
    const raw = await this.kv.get(`${SESSION_KEY_PREFIX}${key}`);
    if (!raw) return null;
    const session = parseJson<SessionRecord>(await this.decrypt(raw));
    if (session) await this.fallback.put(key, session);
    return session;
  }

  async ensure(sessionId: string): Promise<void> {
    const existing = await this.fallback.get(sessionId);
    if (!existing) await this.fallback.put(sessionId, { created_at: Date.now() });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.getSession(sessionId);
  }

  async put(sessionId: string, value: SessionRecord): Promise<void> {
    await this.putSession(sessionId, value);
  }

  async delete(sessionId: string): Promise<void> {
    await Promise.all([
      this.kv.delete(`${SESSION_KEY_PREFIX}${sessionId}`),
      this.fallback.delete(sessionId),
    ]);
  }
}
