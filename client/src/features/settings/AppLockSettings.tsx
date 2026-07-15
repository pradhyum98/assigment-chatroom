import React, { useState, useEffect, useRef } from 'react';
import { AppLockService } from '../../services/AppLockService';
import type { LockType } from '../../services/AppLockService';
import { ArrowLeft, Shield, Fingerprint, RefreshCw } from 'lucide-react';
import './AppLockSettings.css';

interface AppLockSettingsProps {
  onBack: () => void;
}

type SetupStep = 'menu' | 'choose_type' | 'enter_credential' | 'confirm_credential';

export const AppLockSettings: React.FC<AppLockSettingsProps> = ({ onBack }) => {
  const [isEnabled, setIsEnabled] = useState<boolean>(() => AppLockService.isEnabled());
  const [, setLockType] = useState<LockType>(() => AppLockService.getLockType());
  const [timeout, setTimeoutVal] = useState<number>(() => AppLockService.getAutoLockTimeout());
  const [biometricsEnabled, setBiometricsEnabled] = useState<boolean>(() => AppLockService.isBiometricsEnabled());
  const [isBiometricAvailable, setIsBiometricAvailable] = useState<boolean>(false);
  const [biometricCode, setBiometricCode] = useState<string>('UNKNOWN');

  // Setup state machine
  const [step, setStep] = useState<SetupStep>('menu');
  const [setupType, setSetupType] = useState<LockType>('pin');
  const [firstCredential, setFirstCredential] = useState<string>('');
  const [currentInput, setCurrentInput] = useState<string>('');
  const [setupError, setSetupError] = useState<string>('');

  // Pattern canvas setup (Setup Flow)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [patternPath, setPatternPath] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentTouch, setCurrentTouch] = useState<{ x: number; y: number } | null>(null);
  const nodePositions = useRef<{ x: number; y: number; id: number }[]>([]);

  // Configured pin length
  const [pinLength, setPinLength] = useState<number>(4);

  // Check biometric availability
  useEffect(() => {
    AppLockService.checkNativeBiometricsAvailable().then((res) => {
      setIsBiometricAvailable(res.available);
      setBiometricCode(res.code);
    });
  }, []);

  // Update canvas in setup steps if pattern type is selected
  useEffect(() => {
    if (setupType !== 'pattern' || (step !== 'enter_credential' && step !== 'confirm_credential') || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    const padding = 30;
    const size = rect.width;
    const stepSize = (size - padding * 2) / 2;

    const positions = [];
    let id = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        positions.push({
          x: padding + c * stepSize,
          y: padding + r * stepSize,
          id: id++
        });
      }
    }
    nodePositions.current = positions;
    drawPatternCanvas();
  }, [step, setupType, patternPath, currentTouch, setupError]);

  const drawPatternCanvas = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    const primaryColor = setupError ? '#ef4444' : '#6366f1';
    const activeBg = setupError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)';
    const nodeColor = '#94a3b8';

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

      if (isDrawing && currentTouch) {
        ctx.lineTo(currentTouch.x, currentTouch.y);
      }
      ctx.stroke();
    }

    nodePositions.current.forEach((node) => {
      const isActive = patternPath.includes(node.id);
      if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = activeBg;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = primaryColor;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
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
    setSetupError('');
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

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setCurrentTouch(null);

    const patternString = patternPath.join('');

    if (patternPath.length < 4) {
      setSetupError('Connect at least 4 dots.');
      setPatternPath([]);
      return;
    }

    if (step === 'enter_credential') {
      setFirstCredential(patternString);
      setPatternPath([]);
      setStep('confirm_credential');
    } else if (step === 'confirm_credential') {
      if (patternString === firstCredential) {
        completeLockSetup(patternString);
      } else {
        setSetupError('Patterns did not match. Start over.');
        setPatternPath([]);
        setTimeout(() => {
          setStep('enter_credential');
          setFirstCredential('');
          setSetupError('');
        }, 1200);
      }
    }
  };

  const checkCollision = (pos: { x: number; y: number }) => {
    nodePositions.current.forEach((node) => {
      const dist = Math.hypot(node.x - pos.x, node.y - pos.y);
      if (dist < 18 && !patternPath.includes(node.id)) {
        setPatternPath(prev => [...prev, node.id]);
        if (navigator.vibrate) {
          navigator.vibrate(15);
        }
      }
    });
  };

  // --- Common Setup Logic ---

  const handlePinDigit = (digit: string) => {
    setSetupError('');
    const nextInput = currentInput + digit;
    if (nextInput.length <= pinLength) {
      setCurrentInput(nextInput);
      if (nextInput.length === pinLength) {
        if (step === 'enter_credential') {
          setFirstCredential(nextInput);
          setCurrentInput('');
          setStep('confirm_credential');
        } else if (step === 'confirm_credential') {
          if (nextInput === firstCredential) {
            completeLockSetup(nextInput);
          } else {
            setSetupError('PINs did not match. Start over.');
            setCurrentInput('');
            setTimeout(() => {
              setStep('enter_credential');
              setFirstCredential('');
              setSetupError('');
            }, 1200);
          }
        }
      }
    }
  };

  const handleBackspace = () => {
    if (currentInput.length > 0) {
      setCurrentInput(currentInput.slice(0, -1));
    }
  };

  const completeLockSetup = async (secret: string) => {
    localStorage.setItem('app_lock_length', secret.length.toString());
    await AppLockService.setLock(setupType, secret, biometricsEnabled);
    setIsEnabled(true);
    setLockType(setupType);
    setStep('menu');
    setFirstCredential('');
    setCurrentInput('');
  };

  const handleToggleLock = async () => {
    if (isEnabled) {
      const confirmDisable = window.confirm('Are you sure you want to disable App Lock?');
      if (confirmDisable) {
        await AppLockService.disableLock();
        setIsEnabled(false);
      }
    } else {
      setStep('choose_type');
    }
  };

  const handleTimeoutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value, 10);
    AppLockService.setAutoLockTimeout(val);
    setTimeoutVal(val);
  };

  const handleBiometricsToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    localStorage.setItem('app_lock_biometrics_enabled', val ? 'true' : 'false');
    setBiometricsEnabled(val);
  };

  return (
    <div className="app-lock-settings-container">
      {step === 'menu' && (
        <>
          <div className="settings-subpanel-header">
            <button className="settings-back-btn" onClick={onBack}>
              <ArrowLeft size={20} />
            </button>
            <span className="settings-subpanel-title">Privacy &amp; Security</span>
          </div>

          <div className="room-list-scroll-wrapper" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div className="settings-section-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Shield size={20} color="var(--primary)" />
                  <span style={{ fontWeight: 600, fontSize: 15 }}>App Lock</span>
                </div>
                <label className="switch-toggle">
                  <input type="checkbox" checked={isEnabled} onChange={handleToggleLock} />
                  <span className="slider-round"></span>
                </label>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                Secure your chats with a PIN, Pattern, or Fingerprint lock when you are away from the application.
              </p>
            </div>

            {isEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                {/* Auto Lock Timeout */}
                <div className="settings-section-card">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 14, fontWeight: 600 }}>Auto-lock timeout</label>
                    <select
                      className="settings-select"
                      value={timeout}
                      onChange={handleTimeoutChange}
                    >
                      <option value={0}>Immediately</option>
                      <option value={30000}>After 30 seconds</option>
                      <option value={60000}>After 1 minute</option>
                      <option value={300000}>After 5 minutes</option>
                      <option value={900000}>After 15 minutes</option>
                    </select>
                  </div>
                </div>

                {/* Biometrics Switch */}
                {isBiometricAvailable ? (
                  <div className="settings-section-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Fingerprint size={20} color="var(--primary)" />
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Use Biometric Unlock</span>
                      </div>
                      <label className="switch-toggle">
                        <input
                          type="checkbox"
                          checked={biometricsEnabled}
                          onChange={handleBiometricsToggle}
                        />
                        <span className="slider-round"></span>
                      </label>
                    </div>
                  </div>
                ) : biometricCode === 'NONE_ENROLLED' ? (
                  <div className="settings-section-card" style={{ borderColor: '#eab308' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Fingerprint size={20} color="#eab308" />
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#eab308' }}>Biometric Unlock</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: '1.4', margin: 0 }}>
                        Please configure fingerprint/biometrics in your Android Settings to enable biometric unlock.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="settings-section-card" style={{ opacity: 0.7 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Fingerprint size={20} color="var(--text-secondary)" />
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>Biometric Unlock Unavailable</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: '1.4', margin: 0 }}>
                        Biometric authentication is not supported by your device hardware.
                      </p>
                    </div>
                  </div>
                )}

                {/* Change Credentials */}
                <div className="settings-section-card" style={{ padding: 0 }}>
                  <button
                    className="settings-menu-option"
                    onClick={() => setStep('choose_type')}
                    style={{ padding: '16px 20px', border: 'none', width: '100%', borderRadius: 8 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <RefreshCw size={18} color="var(--primary)" />
                      <span className="settings-option-label" style={{ fontSize: 14, fontWeight: 600 }}>Change Lock PIN / Pattern</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {step === 'choose_type' && (
        <>
          <div className="settings-subpanel-header">
            <button className="settings-back-btn" onClick={() => setStep('menu')}>
              <ArrowLeft size={20} />
            </button>
            <span className="settings-subpanel-title">Choose Lock Type</span>
          </div>

          <div className="room-list-scroll-wrapper" style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* PIN Setup Options */}
            <div className="settings-section-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3>PIN Code</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                Lock using a 4-digit or 6-digit numeric password.
              </p>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  className="setup-choice-btn"
                  onClick={() => {
                    setSetupType('pin');
                    setPinLength(4);
                    setStep('enter_credential');
                    setCurrentInput('');
                  }}
                >
                  4-Digit PIN
                </button>
                <button
                  className="setup-choice-btn"
                  onClick={() => {
                    setSetupType('pin');
                    setPinLength(6);
                    setStep('enter_credential');
                    setCurrentInput('');
                  }}
                >
                  6-Digit PIN
                </button>
              </div>
            </div>

            {/* Pattern Setup Option */}
            <div className="settings-section-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3>Pattern Lock</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                Lock using an interactive drawing path.
              </p>
              <button
                className="setup-choice-btn"
                style={{ width: 'fit-content', marginTop: 8 }}
                onClick={() => {
                  setSetupType('pattern');
                  setStep('enter_credential');
                  setPatternPath([]);
                }}
              >
                Set Pattern Lock
              </button>
            </div>
          </div>
        </>
      )}

      {(step === 'enter_credential' || step === 'confirm_credential') && (
        <>
          <div className="settings-subpanel-header">
            <button
              className="settings-back-btn"
              onClick={() => {
                setStep('choose_type');
                setPatternPath([]);
                setCurrentInput('');
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <span className="settings-subpanel-title">
              {step === 'enter_credential' ? `Set ${setupType.toUpperCase()}` : `Confirm ${setupType.toUpperCase()}`}
            </span>
          </div>

          <div className="room-list-scroll-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <h2 style={{ fontSize: 18, marginBottom: 8, fontWeight: 600, textAlign: 'center' }}>
              {setupError || (step === 'enter_credential'
                ? `Draw or enter your new ${setupType}`
                : `Confirm your new ${setupType}`)}
            </h2>

            {setupType === 'pin' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', gap: 12, margin: '20px 0 40px', justifyContent: 'center' }}>
                  {Array.from({ length: pinLength }).map((_, idx) => (
                    <div
                      key={idx}
                      className={`pin-dot ${idx < currentInput.length ? 'filled' : ''} ${setupError ? 'error' : ''}`}
                      style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--text-muted)' }}
                    />
                  ))}
                </div>

                <div className="numpad-grid">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                    <button key={num} className="numpad-btn" onClick={() => handlePinDigit(num)}>
                      {num}
                    </button>
                  ))}
                  <div className="numpad-placeholder" />
                  <button className="numpad-btn" onClick={() => handlePinDigit('0')}>
                    0
                  </button>
                  <button className="numpad-btn control" onClick={handleBackspace}>
                    Del
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                <canvas
                  ref={canvasRef}
                  style={{
                    width: 260,
                    height: 260,
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    background: 'var(--bg-app-dark, #0d121f)',
                    touchAction: 'none',
                    marginTop: 16
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
