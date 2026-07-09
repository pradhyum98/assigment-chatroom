// client/src/config/transport/types.ts

export interface EffectiveTransportConfig {
  buildProfile: 'web' | 'emulator' | 'emulatorProductionTopology' | 'production';
  runtimePlatform: 'web' | 'android' | 'ios';
  apiOrigin: string;
  socketOrigin: string;
  mediaOrigin: string;
  webViewScheme: 'http' | 'https';
  allowEmulatorRouting: boolean;
  allowCleartext: boolean;
  allowMixedContent: boolean;
}
