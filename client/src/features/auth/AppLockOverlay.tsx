import React, { useState, useEffect, useCallback } from 'react';
import { AppLockService } from '../../services/AppLockService';
import { AppLockScreen } from './AppLockScreen';

export const AppLockOverlay: React.FC = () => {
  // On cold start, isSessionLocked (static) resets to false.
  // We must check localStorage directly for the initial value.
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    if (AppLockService.isEnabled()) {
      // On mount (cold start), ALWAYS lock if App Lock is enabled.
      // The user must authenticate to unlock.
      AppLockService.setSessionLocked(true);
      return true;
    }
    return false;
  });

  // Set up listeners for background/foreground transitions
  useEffect(() => {
    let active = true;
    let capListener: any = null;

    // 1. Native Capacitor listener for app backgrounding/foregrounding
    import('@capacitor/app').then(({ App: CapApp }) => {
      if (!active) return;
      CapApp.addListener('appStateChange', (state) => {
        console.log('[AppLockOverlay] App state changed:', state.isActive ? 'FOREGROUND' : 'BACKGROUND');
        if (state.isActive) {
          // App came to foreground — check if lock should engage
          if (AppLockService.isEnabled()) {
            const shouldLock = AppLockService.checkAndLockOnResume();
            setIsLocked(shouldLock);
          }
        } else {
          // App went to background — record the timestamp
          AppLockService.updateActivity();
        }
      }).then((l) => {
        capListener = l;
      });
    });

    // 2. Web visibility listener (fallback for browser testing)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (AppLockService.isEnabled()) {
          const shouldLock = AppLockService.checkAndLockOnResume();
          setIsLocked(shouldLock);
        }
      } else {
        AppLockService.updateActivity();
      }
    };

    const handleFocus = () => {
      if (AppLockService.isEnabled()) {
        const shouldLock = AppLockService.checkAndLockOnResume();
        setIsLocked(shouldLock);
      }
    };

    const handleBlur = () => {
      AppLockService.updateActivity();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      active = false;
      if (capListener) {
        capListener.remove();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleUnlock = useCallback(() => {
    AppLockService.setSessionLocked(false);
    AppLockService.updateActivity();
    setIsLocked(false);
  }, []);

  // Render the lock screen overlay if locked AND enabled
  if (isLocked && AppLockService.isEnabled()) {
    return <AppLockScreen onUnlock={handleUnlock} />;
  }

  return null;
};
