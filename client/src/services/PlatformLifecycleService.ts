import { RecoveryCoordinator } from './RecoveryCoordinator';
import { platformService } from '../platform/PlatformService';
import { socketService } from './socket';

export class BrowserPlatformLifecycleService {
  private recoveryCoordinator: RecoveryCoordinator;
  private unsubscribeLifecycle: (() => void) | null = null;

  constructor(recoveryCoordinator: RecoveryCoordinator) {
    this.recoveryCoordinator = recoveryCoordinator;
    this.init();
  }

  private init() {
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('focus', this.handleFocus.bind(this));
    window.addEventListener('pageshow', this.handlePageShow.bind(this));

    // Subscribe to PlatformService lifecycle (appStateChange on native, visibilitychange on web)
    this.unsubscribeLifecycle = platformService.subscribeToLifecycle((isActive: boolean) => {
      if (isActive) {
        console.log('[PlatformLifecycle] Platform active/resume state detected');
        socketService.connect();
        this.triggerRecovery('platform_resume');
      } else {
        console.log('[PlatformLifecycle] Platform inactive/pause state detected');
        this.recoveryCoordinator.cancelRecovery();
        socketService.disconnect();
      }
    });
  }

  private handleOnline() {
    console.log('[PlatformLifecycle] Browser online event');
    this.triggerRecovery('network_online');
  }

  private handleFocus() {
    console.log('[PlatformLifecycle] Browser window focused');
    this.triggerRecovery('window_focus');
  }

  private handlePageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      console.log('[PlatformLifecycle] Page restored from bfcache');
      this.triggerRecovery('bfcache_restore');
    }
  }

  private triggerRecovery(reason: string) {
    this.recoveryCoordinator.triggerRecovery(reason).catch(err => {
      console.error(`[PlatformLifecycle] Recovery triggered by ${reason} failed:`, err);
    });
  }

  destroy() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('focus', this.handleFocus);
    window.removeEventListener('pageshow', this.handlePageShow);
    if (this.unsubscribeLifecycle) {
      this.unsubscribeLifecycle();
      this.unsubscribeLifecycle = null;
    }
  }
}

// In the future, CapacitorPlatformLifecycleService would implement App.addListener('appStateChange', ...) and Network.addListener('networkStatusChange', ...)
