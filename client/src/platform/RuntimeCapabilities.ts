import { Capacitor } from '@capacitor/core';

export interface Capabilities {
  platform: 'web' | 'android' | 'ios';
  isNative: boolean;
  hasServiceWorker: boolean;
  version: string;
}

export const getCapabilities = (): Capabilities => {
  const platform = Capacitor.getPlatform() as 'web' | 'android' | 'ios';
  const isNative = Capacitor.isNativePlatform();
  return {
    platform,
    isNative,
    hasServiceWorker: !isNative && 'serviceWorker' in navigator,
    version: '1.0.0',
  };
};
