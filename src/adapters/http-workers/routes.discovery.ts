interface IttyRouter { get(path: string, handler: (request: Request) => Promise<Response>): void; post(path: string, handler: (request: Request) => Promise<Response>): void; }
import type { UnifiedConfig } from '../../shared/config/env.js';
import { jsonResponse } from '../../shared/http/response.js';
import { createDiscoveryHandlers, workerDiscoveryStrategy } from '../../shared/oauth/discovery-handlers.js';

export function attachDiscoveryRoutes(router: IttyRouter, config: UnifiedConfig): void {
  const { authorizationMetadata, protectedResourceMetadata } = createDiscoveryHandlers(config, workerDiscoveryStrategy);
  const resource = async (request: Request) => jsonResponse(protectedResourceMetadata(new URL(request.url)));
  router.get('/.well-known/oauth-protected-resource', resource);
  router.get('/.well-known/oauth-protected-resource/mcp', resource);
  router.get('/mcp/.well-known/oauth-protected-resource', resource);
  router.get('/.well-known/oauth-authorization-server', async (request) => jsonResponse(authorizationMetadata(new URL(request.url))));
  router.get('/mcp/.well-known/oauth-authorization-server', async (request) => jsonResponse(authorizationMetadata(new URL(request.url))));
}
