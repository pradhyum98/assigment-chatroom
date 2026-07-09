// client/src/config/transport/transportPolicy.ts
import type { EffectiveTransportConfig } from './types';

export const TRANSPORT_POLICIES = {
  web: {
    webViewScheme: 'http' as const,
    allowEmulatorRouting: true,
    allowCleartext: true,
    allowMixedContent: true,
  },
  emulator: {
    webViewScheme: 'http' as const,
    allowEmulatorRouting: true,
    allowCleartext: true,
    allowMixedContent: true,
  },
  emulatorProductionTopology: {
    webViewScheme: 'https' as const,
    allowEmulatorRouting: true,
    allowCleartext: false,
    allowMixedContent: false,
  },
  production: {
    webViewScheme: 'https' as const,
    allowEmulatorRouting: false,
    allowCleartext: false,
    allowMixedContent: false,
  }
};

export function validateProductionInvariants(config: EffectiveTransportConfig): void {
  const { apiOrigin, socketOrigin, mediaOrigin, buildProfile } = config;

  if (buildProfile !== 'production') return;

  // 1. Must use HTTPS
  if (!apiOrigin.startsWith('https://')) {
    throw new Error(`CRITICAL: Production API must be HTTPS. Resolved: ${apiOrigin}`);
  }
  if (!socketOrigin.startsWith('https://') && !socketOrigin.startsWith('wss://')) {
    throw new Error(`CRITICAL: Production Socket must be HTTPS/WSS. Resolved: ${socketOrigin}`);
  }
  if (!mediaOrigin.startsWith('https://')) {
    throw new Error(`CRITICAL: Production Media must be HTTPS. Resolved: ${mediaOrigin}`);
  }

  // 2. Loopback strings must not appear in any URL
  const loopbacks = ['localhost', '127.0.0.1', '::1', '10.0.2.2', '0.0.0.0'];
  for (const loopback of loopbacks) {
    if (apiOrigin.includes(loopback) || socketOrigin.includes(loopback) || mediaOrigin.includes(loopback)) {
      throw new Error(`CRITICAL: Production URLs must not contain loopback identifier: "${loopback}"`);
    }
  }

  // 3. Embedded credentials check
  const credRegex = /^[a-zA-Z]+:\/\/[^/]+:[^/]+@/;
  if (credRegex.test(apiOrigin) || credRegex.test(socketOrigin)) {
    throw new Error('CRITICAL: Production URLs must not contain embedded basic auth credentials');
  }

  // 4. Secure flags checks
  if (config.allowCleartext || config.allowMixedContent || config.allowEmulatorRouting || config.webViewScheme !== 'https') {
    throw new Error('CRITICAL: Production configurations must not permit unsecure/debug parameters');
  }
}
