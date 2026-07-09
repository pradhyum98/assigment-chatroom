import type { CapacitorConfig } from '@capacitor/cli';

const buildProfile = process.env.APP_BUILD_PROFILE || 'emulator';
const scheme = (buildProfile === 'production') ? 'https' : 'http';

const config: CapacitorConfig = {
  appId: 'com.securechat.pwa',
  appName: 'SecureChat',
  webDir: 'dist',
  server: {
    // Custom schemes to avoid origin-bound and HttpOnly cookie issues in WebViews
    androidScheme: scheme,
    iosScheme: 'https',
    hostname: 'localhost'
  },
  plugins: {
    CapacitorCookies: {
      enabled: true
    },
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
