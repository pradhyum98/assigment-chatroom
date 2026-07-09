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

  // Basic origin cleanup (remove trailing slashes)
  const apiOrigin = rawApiUrl.replace(/\/$/, '');
  const socketOrigin = rawSocketUrl.replace(/\/$/, '');
  const mediaOrigin = apiOrigin.replace(/\/api$/, '');

  const policy = TRANSPORT_POLICIES[buildProfile];

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
