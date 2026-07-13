import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/socket', () => ({
  socketService: { connect: vi.fn(), disconnect: vi.fn() }
}));

vi.mock('@capacitor/core', () => {
  let platform = 'web';
  let isNative = false;
  return {
    registerPlugin: vi.fn(() => ({})),
    Capacitor: {
      getPlatform: () => platform,
      isNativePlatform: () => isNative,
      __setPlatform: (p: string, n: boolean) => {
        platform = p;
        isNative = n;
      }
    }
  };
});

const mockAppListeners = new Map<string, Function>();
vi.mock('@capacitor/app', () => {
  return {
    App: {
      addListener: (event: string, callback: Function) => {
        mockAppListeners.set(event, callback);
        return { remove: () => mockAppListeners.delete(event) };
      }
    }
  };
});

describe('Milestone 4 — Client Platform Lifecycle & Gating', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAppListeners.clear();
    vi.restoreAllMocks();
  });

  it('detects web environment correct parameters', async () => {
    const { Capacitor } = await import('@capacitor/core');
    (Capacitor as any).__setPlatform('web', false);

    const { getCapabilities } = await import('../platform/RuntimeCapabilities');
    const caps = getCapabilities();
    expect(caps.platform).toBe('web');
    expect(caps.isNative).toBe(false);
  });

  it('detects native iOS environment correct parameters', async () => {
    const { Capacitor } = await import('@capacitor/core');
    (Capacitor as any).__setPlatform('ios', true);

    const { getCapabilities } = await import('../platform/RuntimeCapabilities');
    const caps = getCapabilities();
    expect(caps.platform).toBe('ios');
    expect(caps.isNative).toBe(true);
    expect(caps.hasServiceWorker).toBe(false);
  });

  it('triggers RecoveryCoordinator on platform resume/foreground', async () => {
    const { Capacitor } = await import('@capacitor/core');
    (Capacitor as any).__setPlatform('ios', true);

    const mockCoordinator = {
      triggerRecovery: vi.fn().mockResolvedValue(undefined),
      cancelRecovery: vi.fn()
    };

    const { BrowserPlatformLifecycleService } = await import('../services/PlatformLifecycleService');
    const service = new BrowserPlatformLifecycleService(mockCoordinator as any);

    const listener = mockAppListeners.get('appStateChange');
    expect(listener).toBeDefined();

    await listener!({ isActive: true });
    expect(mockCoordinator.triggerRecovery).toHaveBeenCalledWith('platform_resume');

    service.destroy();
  });

  it('does not trigger RecoveryCoordinator on background/pause', async () => {
    const { Capacitor } = await import('@capacitor/core');
    (Capacitor as any).__setPlatform('ios', true);

    const mockCoordinator = {
      triggerRecovery: vi.fn().mockResolvedValue(undefined),
      cancelRecovery: vi.fn()
    };

    const { BrowserPlatformLifecycleService } = await import('../services/PlatformLifecycleService');
    const service = new BrowserPlatformLifecycleService(mockCoordinator as any);

    const listener = mockAppListeners.get('appStateChange');
    await listener!({ isActive: false });

    expect(mockCoordinator.triggerRecovery).not.toHaveBeenCalled();
    expect(mockCoordinator.cancelRecovery).toHaveBeenCalledOnce();

    service.destroy();
  });

  describe('PlatformService URL Resolution Invariants', () => {
    it('does not translate localhost on web platform', async () => {
      const { Capacitor } = await import('@capacitor/core');
      (Capacitor as any).__setPlatform('web', false);
      const { platformService } = await import('../platform/PlatformService');
      const resolved = platformService.resolveUrl('http://localhost:5001');
      expect(resolved).toBe('http://localhost:5001');
    });

    it('does not translate localhost on iOS platform', async () => {
      const { Capacitor } = await import('@capacitor/core');
      (Capacitor as any).__setPlatform('ios', true);
      const { platformService } = await import('../platform/PlatformService');
      const resolved = platformService.resolveUrl('http://localhost:5001');
      expect(resolved).toBe('http://localhost:5001');
    });

    it('translates localhost to 10.0.2.2 on Android platform in development', async () => {
      const { Capacitor } = await import('@capacitor/core');
      (Capacitor as any).__setPlatform('android', true);
      const { platformService } = await import('../platform/PlatformService');
      
      // Since we run tests in DEV, import.meta.env.DEV will be true
      const resolved = platformService.resolveUrl('http://localhost:5001');
      expect(resolved).toBe('http://10.0.2.2:5001');
    });
  });
});
