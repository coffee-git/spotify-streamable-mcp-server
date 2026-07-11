export function validateOrigin(headers: Headers, isDev: boolean): void {
  const origin = headers.get('Origin') || headers.get('origin');
  if (!origin) return;
  if (isDev && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) throw new Error(`Invalid development origin: ${origin}`);
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
export function validateProtocolVersion(headers: Headers, _expected: string): void {
  const value = headers.get('Mcp-Protocol-Version') || headers.get('MCP-Protocol-Version');
  if (!value) return;
  const accepted = value.split(',').map((x) => x.trim()).some((x) => SUPPORTED_PROTOCOL_VERSIONS.includes(x));
  if (!accepted) throw new Error(`Unsupported MCP protocol version: ${value}`);
}

export type UnauthorizedChallenge = { status: 401; headers: Record<string,string>; body: { jsonrpc: '2.0'; error: { code: -32000; message: string }; id: null } };
export function buildUnauthorizedChallenge(args: { origin: string; sid: string; resourcePath?: string; message?: string; scope?: string }): UnauthorizedChallenge {
  const metadata = `${args.origin}${args.resourcePath || '/.well-known/oauth-protected-resource'}`;
  const fields = [`Bearer realm="MCP"`, `resource_metadata="${metadata}"`];
  if (args.scope) fields.push(`scope="${args.scope}"`);
  return {
    status: 401,
    headers: { 'WWW-Authenticate': fields.join(', '), 'Mcp-Session-Id': args.sid },
    body: { jsonrpc: '2.0', error: { code: -32000, message: args.message || 'Unauthorized' }, id: null },
  };
}
