import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import type { UnifiedConfig } from '../../shared/config/env.js';
import { createDiscoveryHandlers, nodeDiscoveryStrategy } from '../../shared/oauth/discovery-handlers.js';

export function buildDiscoveryRoutes(config: UnifiedConfig): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const { authorizationMetadata, protectedResourceMetadata } = createDiscoveryHandlers(config, nodeDiscoveryStrategy);
  if (config.AUTH_ENABLED) {
    const resource = (c: any) => c.json(protectedResourceMetadata(new URL(c.req.url)));
    app.get('/.well-known/oauth-protected-resource', resource);
    app.get('/.well-known/oauth-protected-resource/mcp', resource);
    app.get('/mcp/.well-known/oauth-protected-resource', resource);
  }
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authorizationMetadata(new URL(c.req.url))));
  app.get('/mcp/.well-known/oauth-authorization-server', (c) => c.json(authorizationMetadata(new URL(c.req.url))));
  return app;
}
