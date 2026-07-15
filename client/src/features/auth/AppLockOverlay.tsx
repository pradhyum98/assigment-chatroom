import React, { useState, useEffect } from 'react';
import { AppLockService } from '../../services/AppLockService';
import { AppLockScreen } from './AppLockScreen';

export const AppLockOverlay: React.FC = () => {
  const [isLocked, setIsLocked] = useState<boolean>(() => AppLockService.isAppCurrentlyLocked());

  // Sync state with AppLockService on mount and change
  useEffect(() => {
    if (AppLockService.isEnabled()) {
      AppLockService.setSessionLocked(true);
      setIsLocked(true);
    }
  }, []);

  // Set up listeners for background/foreground transitions
  useEffect(() => {
    let active = true;
    let capListener: any = null;

    // 1. Native Capacitor listener
    import('@capacitor/app').then(({ App: CapApp }) => {
      if (!active) return;
      CapApp.addListener('appStateChange', (state) => {
        console.log('[AppLockOverlay] App state changed:', state.isActive ? 'active' : 'inactive');
        if (state.isActive) {
          const locked = AppLockService.checkAndLockOnResume();
          setIsLocked(locked);
        } else {
          AppLockService.updateActivity();
        }
      }).then((l) => {
        capListener = l;
      });
    });

    // 2. Web visibility listener (as fallback and for browser testing)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const locked = AppLockService.checkAndLockOnResume();
        setIsLocked(locked);
      } else {
        AppLockService.updateActivity();
      }
    };

    const handleFocus = () => {
      const locked = AppLockService.checkAndLockOnResume();
      setIsLocked(locked);
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

  const handleUnlock = () => {
    setIsLocked(false);
  };

  // If locked, render the lock screen over the rest of the application
  if (isLocked && AppLockService.isEnabled()) {
    return <AppLockScreen onUnlock={handleUnlock} />;
  }

  return null;
};
