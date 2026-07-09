import { App } from '@capacitor/app';
import { getCapabilities } from './RuntimeCapabilities';

export type LifecycleListener = (isActive: boolean) => void;

class PlatformService {
  private listeners: Set<LifecycleListener> = new Set();
  private capabilities = getCapabilities();

  constructor() {
    this.initLifecycle();
  }

  getCapabilities() {
    return this.capabilities;
  }

  subscribeToLifecycle(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private initLifecycle() {
    if (this.capabilities.isNative) {
      App.addListener('appStateChange', ({ isActive }) => {
        console.log(`[PlatformService] Native state change: isActive = ${isActive}`);
        this.notify(isActive);
      });
    } else {
      document.addEventListener('visibilitychange', () => {
        const isActive = document.visibilityState === 'visible';
        console.log(`[PlatformService] Web visibility change: isActive = ${isActive}`);
        this.notify(isActive);
      });
    }
  }

  private notify(isActive: boolean) {
    this.listeners.forEach((listener) => {
      try {
        listener(isActive);
      } catch (err) {
        console.error('[PlatformService] Error in lifecycle listener:', err);
      }
    });
  }

  openExternalUrl(url: string) {
    if (this.capabilities.isNative) {
      window.open(url, '_system');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  resolveUrl(url: string): string {
    // @ts-ignore
    const isTestHarness = typeof process !== 'undefined' && process.env && process.env.TEST_HARNESS === 'true';
    if (isTestHarness) {
      return url;
    }
    const isDev = import.meta.env.DEV;
    const caps = this.getCapabilities();
    if (isDev && caps.isNative && caps.platform === 'android' && url.includes('localhost')) {
      return url.replace('localhost', '10.0.2.2');
    }
    return url;
  }
}

export const platformService = new PlatformService();
export default platformService;
