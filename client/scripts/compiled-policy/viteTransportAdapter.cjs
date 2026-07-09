// client/scripts/compiled-policy/viteTransportAdapter.cjs
const TRANSPORT_POLICIES = {
  web: {
    webViewScheme: 'http',
    allowEmulatorRouting: true,
    allowCleartext: true,
    allowMixedContent: true,
  },
  emulator: {
    webViewScheme: 'http',
    allowEmulatorRouting: true,
    allowCleartext: true,
    allowMixedContent: true,
  },
  emulatorProductionTopology: {
    webViewScheme: 'https',
    allowEmulatorRouting: true,
    allowCleartext: false,
    allowMixedContent: false,
  },
  production: {
    webViewScheme: 'https',
    allowEmulatorRouting: false,
    allowCleartext: false,
    allowMixedContent: false,
  }
};

function validateProductionInvariants(config) {
  const { apiOrigin, socketOrigin, mediaOrigin, buildProfile } = config;

  if (buildProfile !== 'production') return;

  if (!apiOrigin.startsWith('https://')) {
    throw new Error(`CRITICAL: Production API must be HTTPS. Resolved: ${apiOrigin}`);
  }
  if (!socketOrigin.startsWith('https://') && !socketOrigin.startsWith('wss://')) {
    throw new Error(`CRITICAL: Production Socket must be HTTPS/WSS. Resolved: ${socketOrigin}`);
  }
  if (!mediaOrigin.startsWith('https://')) {
    throw new Error(`CRITICAL: Production Media must be HTTPS. Resolved: ${mediaOrigin}`);
  }

  const loopbacks = ['localhost', '127.0.0.1', '::1', '10.0.2.2', '0.0.0.0'];
  for (const loopback of loopbacks) {
    if (apiOrigin.includes(loopback) || socketOrigin.includes(loopback) || mediaOrigin.includes(loopback)) {
      throw new Error(`CRITICAL: Production URLs must not contain loopback identifier: "${loopback}"`);
    }
  }

  const credRegex = /^[a-zA-Z]+:\/\/[^/]+:[^/]+@/;
  if (credRegex.test(apiOrigin) || credRegex.test(socketOrigin)) {
    throw new Error('CRITICAL: Production URLs must not contain embedded basic auth credentials');
  }

  if (config.allowCleartext || config.allowMixedContent || config.allowEmulatorRouting || config.webViewScheme !== 'https') {
    throw new Error('CRITICAL: Production configurations must not permit unsecure/debug parameters');
  }
}

function resolveTransportConfig(profileInput, platformInput, rawApiUrl, rawSocketUrl) {
  const validProfiles = ['web', 'emulator', 'emulatorProductionTopology', 'production'];
  if (!profileInput || !validProfiles.includes(profileInput)) {
    throw new Error(`CRITICAL: Unknown or missing buildProfile: "${profileInput}"`);
  }

  const buildProfile = profileInput;
  const apiOrigin = rawApiUrl.replace(/\/$/, '');
  const socketOrigin = rawSocketUrl.replace(/\/$/, '');
  const mediaOrigin = apiOrigin.replace(/\/api$/, '');

  const policy = TRANSPORT_POLICIES[buildProfile];

  const config = {
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

module.exports = {
  TRANSPORT_POLICIES,
  validateProductionInvariants,
  resolveTransportConfig
};
