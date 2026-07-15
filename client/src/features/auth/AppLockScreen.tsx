import React, { useState, useEffect, useRef } from 'react';
import { AppLockService } from '../../services/AppLockService';
import { Shield, Delete, Fingerprint } from 'lucide-react';
import './AppLock.css'; // We will create this CSS file for rich aesthetics

interface AppLockScreenProps {
  onUnlock: () => void;
}

export const AppLockScreen: React.FC<AppLockScreenProps> = ({ onUnlock }) => {
  const lockType = AppLockService.getLockType();
  const biometricsEnabled = AppLockService.isBiometricsEnabled();

  const [pin, setPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isBiometricPromptActive, setIsBiometricPromptActive] = useState<boolean>(false);

  // Pattern canvas state & references
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [patternPath, setPatternPath] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentTouch, setCurrentTouch] = useState<{ x: number; y: number } | null>(null);

  const expectedLength = parseInt(localStorage.getItem('app_lock_length') || '4', 10);

  // Trigger biometric unlock automatically if enabled
  useEffect(() => {
    if (biometricsEnabled) {
      // Small delay to ensure Capacitor native plugin is fully registered on cold start
      const timer = setTimeout(() => {
        handleBiometricUnlock();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [biometricsEnabled]);

  const handleBiometricUnlock = async () => {
    if (isBiometricPromptActive) return;
    
    const { available } = await AppLockService.checkNativeBiometricsAvailable();
    if (!available) return;

    setIsBiometricPromptActive(true);
    const success = await AppLockService.triggerNativeBiometricAuth();
    setIsBiometricPromptActive(false);

    if (success) {
      AppLockService.setSessionLocked(false);
      onUnlock();
    }
  };

  // --- PIN Handlers ---

  const handlePinInput = (num: string) => {
    setErrorMsg('');
    const newPin = pin + num;
    if (newPin.length <= expectedLength) {
      setPin(newPin);
      
      // Auto-validate when PIN reaches configured length
      if (newPin.length === expectedLength) {
        verifyPin(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setErrorMsg('');
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
    }
  };

  const verifyPin = async (inputPin: string) => {
    const success = await AppLockService.verifyCredential(inputPin);
    if (success) {
      AppLockService.setSessionLocked(false);
      onUnlock();
    } else {
      setPin('');
      setErrorMsg('Incorrect PIN. Try again.');
      // Subtle device vibration if supported
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
    }
  };

  // --- Pattern Handlers (Canvas-based) ---

  const nodePositions = useRef<{ x: number; y: number; id: number }[]>([]);

  // Track canvas size and position nodes
  useEffect(() => {
    if (lockType !== 'pattern' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    // Position 9 nodes in 3x3 layout
    const padding = 40;
    const size = rect.width;
    const step = (size - padding * 2) / 2;

    const positions = [];
    let id = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        positions.push({
          x: padding + c * step,
          y: padding + r * step,
          id: id++
        });
      }
    }
    nodePositions.current = positions;

    drawPatternCanvas();
  }, [lockType, patternPath, currentTouch, errorMsg]);

  const drawPatternCanvas = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Color definitions
    const primaryColor = errorMsg ? '#ef4444' : '#6366f1';
    const activeBg = errorMsg ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)';
    const nodeColor = '#94a3b8';

    // Draw connection lines
    if (patternPath.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const firstPos = nodePositions.current.find(n => n.id === patternPath[0]);
      if (firstPos) {
        ctx.moveTo(firstPos.x, firstPos.y);
      }

      for (let i = 1; i < patternPath.length; i++) {
        const pos = nodePositions.current.find(n => n.id === patternPath[i]);
        if (pos) {
          ctx.lineTo(pos.x, pos.y);
        }
      }

      // Draw line to current touch point
      if (isDrawing && currentTouch) {
        ctx.lineTo(currentTouch.x, currentTouch.y);
      }
      ctx.stroke();
    }

    // Draw nodes
    nodePositions.current.forEach((node) => {
      const isActive = patternPath.includes(node.id);
      
      // Outer glow/ring for active nodes
      if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 24, 0, Math.PI * 2);
        ctx.fillStyle = activeBg;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
      } else {
        // Inactive node
        ctx.beginPath();
        ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = nodeColor;
        ctx.fill();
      }
    });
  };

  const getTouchPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setErrorMsg('');
    setIsDrawing(true);
    const pos = getTouchPos(e);
    if (!pos) return;

    setCurrentTouch(pos);
    checkCollision(pos);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getTouchPos(e);
    if (!pos) return;

    setCurrentTouch(pos);
    checkCollision(pos);
  };

  const handlePointerUp = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setCurrentTouch(null);

    if (patternPath.length >= 4) {
      const patternString = patternPath.join('');
      const success = await AppLockService.verifyCredential(patternString);
      if (success) {
        AppLockService.setSessionLocked(false);
        onUnlock();
      } else {
        setErrorMsg('Incorrect pattern. Try again.');
        if (navigator.vibrate) {
          navigator.vibrate(100);
        }
        setTimeout(() => {
          setPatternPath([]);
          setErrorMsg('');
        }, 1000);
      }
    } else if (patternPath.length > 0) {
      setErrorMsg('Connect at least 4 dots.');
      setTimeout(() => {
        setPatternPath([]);
        setErrorMsg('');
      }, 1000);
    }
  };

  const checkCollision = (pos: { x: number; y: number }) => {
    nodePositions.current.forEach((node) => {
      const dist = Math.hypot(node.x - pos.x, node.y - pos.y);
      if (dist < 20 && !patternPath.includes(node.id)) {
        setPatternPath(prev => [...prev, node.id]);
        if (navigator.vibrate) {
          navigator.vibrate(20);
        }
      }
    });
  };

  return (
    <div className="app-lock-screen">
      <div className="app-lock-container">
        <div className="app-lock-header">
          <div className="lock-icon-glow">
            <Shield size={36} color="var(--primary)" />
          </div>
          <h2>App Locked</h2>
          <p className={errorMsg ? 'error-text' : 'hint-text'}>
            {errorMsg || (lockType === 'pin' ? `Enter your ${expectedLength}-digit PIN` : 'Draw your pattern')}
          </p>
        </div>

        {lockType === 'pin' ? (
          <div className="pin-lock-layout">
            <div className="pin-dots">
              {Array.from({ length: expectedLength }).map((_, idx) => (
                <div
                  key={idx}
                  className={`pin-dot ${idx < pin.length ? 'filled' : ''} ${errorMsg ? 'error' : ''}`}
                />
              ))}
            </div>

            <div className="numpad-grid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button key={num} className="numpad-btn" onClick={() => handlePinInput(num)}>
                  {num}
                </button>
              ))}
              
              {biometricsEnabled ? (
                <button className="numpad-btn control" onClick={handleBiometricUnlock} title="Use Biometrics">
                  <Fingerprint size={24} color="var(--primary)" />
                </button>
              ) : (
                <div className="numpad-placeholder" />
              )}
              
              <button className="numpad-btn" onClick={() => handlePinInput('0')}>
                0
              </button>
              
              <button className="numpad-btn control" onClick={handleBackspace} title="Delete">
                <Delete size={20} />
              </button>
            </div>
          </div>
        ) : (
          <div className="pattern-lock-layout">
            <canvas
              ref={canvasRef}
              className="pattern-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{ touchAction: 'none' }}
            />
            {biometricsEnabled && (
              <button className="biometrics-fab" onClick={handleBiometricUnlock}>
                <Fingerprint size={22} style={{ marginRight: 8 }} /> Use Fingerprint
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
