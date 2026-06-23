import React, { useEffect, useRef, useState } from 'react';
import { useCall } from './CallContext';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Monitor, 
  Maximize2, 
  Minimize2,
  Loader2
} from 'lucide-react';
import './Calls.css';

const CallOverlay: React.FC = () => {
  const {
    callState,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    isMicMuted,
    isCameraOff,
    isScreenSharing,
  } = useCall();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Bind local camera stream to local video tag
  useEffect(() => {
    if (localVideoRef.current && callState.localStream) {
      localVideoRef.current.srcObject = callState.localStream;
    }
  }, [callState.localStream]);

  // Bind remote stream to remote video tag
  useEffect(() => {
    if (remoteVideoRef.current && callState.remoteStream) {
      remoteVideoRef.current.srcObject = callState.remoteStream;
    }
  }, [callState.remoteStream]);

  const getStatusLabel = () => {
    switch (callState.status) {
      case 'calling':
        return 'Calling...';
      case 'incoming':
        return `Incoming ${callState.type} Call...`;
      case 'connected':
        if (callState.connectionState === 'checking') return 'Connecting...';
        if (callState.connectionState === 'disconnected') return 'Reconnecting...';
        return 'Connected';
      default:
        return 'Active Call';
    }
  };

  const getAvatarChar = () => {
    return callState.peerName ? callState.peerName.charAt(0).toUpperCase() : '?';
  };

  return (
    <div className={`call-overlay-container ${isFullscreen ? 'fullscreen-mode' : ''} fade-in`}>
      <div className="call-overlay-glass">
        
        {/* Call Info Header */}
        <header className="call-info-header">
          <div className="peer-details">
            <h2 className="peer-name">{callState.peerName}</h2>
            <p className="call-status-label">
              {callState.connectionState === 'checking' || callState.connectionState === 'disconnected' ? (
                <Loader2 className="animate-spin inline-block mr-1" size={14} />
              ) : null}
              {getStatusLabel()}
            </p>
          </div>
        </header>

        {/* Video Screens Area */}
        <div className="call-screens-area">
          {callState.status === 'connected' ? (
            <div className="active-streams-grid">
              
              {/* Remote Stream Screen */}
              <div className="remote-stream-container">
                {callState.type === 'video' ? (
                  callState.remoteStream ? (
                    <video 
                      ref={remoteVideoRef} 
                      autoPlay 
                      playsInline 
                      className="remote-video-el" 
                    />
                  ) : (
                    <div className="remote-placeholder">
                      <div className="call-large-avatar">{getAvatarChar()}</div>
                      <p>Waiting for remote stream...</p>
                    </div>
                  )
                ) : (
                  <div className="remote-placeholder">
                    <div className="call-large-avatar">{getAvatarChar()}</div>
                    <p>Voice Call Connected</p>
                  </div>
                )}

                {/* Local Camera Floating Screen (Picture-in-Picture) */}
                {callState.type === 'video' && callState.localStream && (
                  <div className="local-stream-pip">
                    {isCameraOff ? (
                      <div className="local-pip-placeholder">
                        <VideoOff size={16} />
                      </div>
                    ) : (
                      <video 
                        ref={localVideoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        className="local-video-pip-el" 
                      />
                    )}
                  </div>
                )}
              </div>

            </div>
          ) : (
            /* Calling/Incoming Placeholder Avatar Screen */
            <div className="calling-placeholder-screen">
              <div className="pulse-avatar-container">
                <div className={`call-large-avatar ${callState.status === 'calling' || callState.status === 'incoming' ? 'pulse-effect' : ''}`}>
                  {getAvatarChar()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Call Actions Control Dock */}
        <footer className="call-controls-dock">
          
          {/* Incoming Call Accept/Reject Toggles */}
          {callState.status === 'incoming' ? (
            <div className="incoming-actions-container">
              <button 
                onClick={rejectCall} 
                className="control-btn reject-btn" 
                title="Decline Call"
              >
                <PhoneOff size={22} />
              </button>
              <button 
                onClick={acceptCall} 
                className="control-btn accept-btn" 
                title="Accept Call"
              >
                <Phone size={22} />
              </button>
            </div>
          ) : (
            /* Connected/Calling Toggles */
            <div className="connected-actions-container">
              
              {/* Mic Toggle */}
              <button 
                onClick={toggleMic} 
                className={`control-btn ${isMicMuted ? 'muted-btn' : 'secondary-btn'}`}
                title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>

              {/* Camera Toggle (Video calls only) */}
              {callState.type === 'video' && (
                <button 
                  onClick={toggleCamera} 
                  className={`control-btn ${isCameraOff ? 'camera-off-btn' : 'secondary-btn'}`}
                  title={isCameraOff ? 'Enable camera' : 'Disable camera'}
                >
                  {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              )}

              {/* Screen Share Toggle (Video calls only) */}
              {callState.type === 'video' && callState.status === 'connected' && (
                <button 
                  onClick={toggleScreenShare} 
                  className={`control-btn ${isScreenSharing ? 'active-share-btn' : 'secondary-btn'}`}
                  title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
                >
                  <Monitor size={20} />
                </button>
              )}

              {/* Fullscreen Toggle (Video calls only) */}
              {callState.type === 'video' && callState.status === 'connected' && (
                <button 
                  onClick={() => setIsFullscreen(!isFullscreen)} 
                  className="control-btn secondary-btn"
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                >
                  {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
              )}

              {/* End Call Button */}
              <button 
                onClick={endCall} 
                className="control-btn end-call-btn" 
                title="End Call"
              >
                <PhoneOff size={22} />
              </button>
            </div>
          )}

        </footer>

      </div>
    </div>
  );
};

export default CallOverlay;
