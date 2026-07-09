// client/src/config/transport/viteTransportAdapter.ts
import { resolveTransportConfig } from './resolveTransportConfig';

export function getViteConfig(
  profileInput: string | undefined,
  platformInput: 'web' | 'android' | 'ios',
  rawApiUrl: string,
  rawSocketUrl: string
) {
  return resolveTransportConfig(profileInput, platformInput, rawApiUrl, rawSocketUrl);
}
