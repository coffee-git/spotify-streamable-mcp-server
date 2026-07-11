export type RegisteredClient = {
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  client_name?: string;
  issued_at: number;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  if (!secret.trim()) throw new Error('server_error: OAuth client signing key is required');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function issueClientId(client: RegisteredClient, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(client)));
  const key = await importSigningKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifyClientId(clientId: string, secret: string): Promise<RegisteredClient | null> {
  try {
    const [payload, signature] = clientId.split('.');
    if (!payload || !signature) return null;
    const key = await importSigningKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as RegisteredClient;
    if (!Array.isArray(decoded.redirect_uris) || decoded.redirect_uris.length === 0) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function validateRedirectUri(uri: string): void {
  const parsed = new URL(uri);
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('invalid_redirect_uri: HTTPS is required except for loopback clients');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('invalid_redirect_uri: credentials and fragments are not allowed');
  }
}
