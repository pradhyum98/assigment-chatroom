// client/src/config/transport/resolveTransportConfig.ts
import type { EffectiveTransportConfig } from './types';
import { TRANSPORT_POLICIES, validateProductionInvariants } from './transportPolicy';

export function resolveTransportConfig(
  profileInput: string | undefined,
  platformInput: 'web' | 'android' | 'ios',
  rawApiUrl: string,
  rawSocketUrl: string
): EffectiveTransportConfig {
  // Validate profile is known
  const validProfiles = ['web', 'emulator', 'emulatorProductionTopology', 'production'];
  if (!profileInput || !validProfiles.includes(profileInput)) {
    throw new Error(`CRITICAL: Unknown or missing buildProfile: "${profileInput}"`);
  }

  const buildProfile = profileInput as 'web' | 'emulator' | 'emulatorProductionTopology' | 'production';

  // On Android emulator, `localhost` resolves to the emulator device itself.
  // Rewrite localhost/127.0.0.1 → 10.0.2.2 (host machine alias) so the app
  // can reach the dev server running on the Mac.
  const rewriteForEmulator = (url: string): string => {
    return url
      .replace('localhost', '10.0.2.2')
      .replace('127.0.0.1', '10.0.2.2');
  };

  const policy = TRANSPORT_POLICIES[buildProfile];

  const shouldRewrite = platformInput === 'android' && policy.allowEmulatorRouting;

  // Basic origin cleanup (remove trailing slashes)
  const apiOrigin = (shouldRewrite ? rewriteForEmulator(rawApiUrl) : rawApiUrl).replace(/\/$/, '');
  const socketOrigin = (shouldRewrite ? rewriteForEmulator(rawSocketUrl) : rawSocketUrl).replace(/\/$/, '');
  const mediaOrigin = apiOrigin.replace(/\/api$/, '');

  const config: EffectiveTransportConfig = {
    buildProfile,
    runtimePlatform: platformInput,
    apiOrigin,
    socketOrigin,
    mediaOrigin,
    webViewScheme: policy.webViewScheme,
    allowEmulatorRouting: policy.allowEmulatorRouting,
    allowCleartext: policy.allowCleartext,
    allowMixedContent: policy.allowMixedContent
  };

  validateProductionInvariants(config);

  return config;
}
