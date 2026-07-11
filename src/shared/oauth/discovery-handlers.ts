import type { UnifiedConfig } from '../config/env.js';
import { buildAuthorizationServerMetadata, buildProtectedResourceMetadata } from './discovery.js';

type DiscoveryStrategy = {
  resolveAuthBaseUrl(requestUrl: URL, config: UnifiedConfig): string;
  resolveAuthorizationServerUrl(requestUrl: URL, config: UnifiedConfig): string;
  resolveResourceBaseUrl(requestUrl: URL, config: UnifiedConfig): string;
};

export function createDiscoveryHandlers(config: UnifiedConfig, strategy: DiscoveryStrategy) {
  const scopes = config.OAUTH_SCOPES.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  return {
    authorizationMetadata: (requestUrl: URL) => {
      const base = strategy.resolveAuthBaseUrl(requestUrl, config);
      return buildAuthorizationServerMetadata(base, scopes, { authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token`, revocationEndpoint: `${base}/revoke` });
    },
    protectedResourceMetadata: (requestUrl: URL) => {
      const resource = config.AUTH_RESOURCE_URI || strategy.resolveResourceBaseUrl(requestUrl, config);
      const authServer = config.AUTH_DISCOVERY_URL || strategy.resolveAuthorizationServerUrl(requestUrl, config);
      return buildProtectedResourceMetadata(resource, authServer, scopes);
    },
  };
}

export const workerDiscoveryStrategy: DiscoveryStrategy = {
  resolveAuthBaseUrl: (url) => url.origin,
  resolveAuthorizationServerUrl: (url) => url.origin,
  resolveResourceBaseUrl: (url) => `${url.origin}/mcp`,
};
export const nodeDiscoveryStrategy: DiscoveryStrategy = {
  resolveAuthBaseUrl: (url, config) => `${url.protocol}//${url.hostname}:${Number(config.PORT) + 1}`,
  resolveAuthorizationServerUrl: (url, config) => `${url.protocol}//${url.hostname}:${Number(config.PORT) + 1}`,
  resolveResourceBaseUrl: (url) => `${url.protocol}//${url.host}/mcp`,
};
