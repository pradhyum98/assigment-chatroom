import { Capacitor } from '@capacitor/core';
import { resolveTransportConfig } from './transport/resolveTransportConfig';
import type { EffectiveTransportConfig } from './transport/types';

// Injected via Vite build config define or fallback
// @ts-ignore
const buildProfileEnv = (typeof process !== 'undefined' && process.env && process.env.APP_BUILD_PROFILE) || 'emulator';

function getEffectiveConfig(): EffectiveTransportConfig {
  const profile = (buildProfileEnv === 'production') ? 'production' : 'emulator';
  const platform = Capacitor.getPlatform();
  const runtimePlatform = (platform === 'android' || platform === 'ios') ? platform : 'web';

  const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
  const rawSocketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

  return resolveTransportConfig(profile, runtimePlatform, rawApiUrl, rawSocketUrl);
}

export const TransportConfig = getEffectiveConfig();
export default TransportConfig;
