import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAppSelector } from '../../store/hooks';
import { socketService } from '../../services/socket';
import { webrtcManager } from '../../services/webrtc';
import CallOverlay from './CallOverlay';

interface CallState {
  roomId: string;
  peerId: string;
  peerName: string;
  type: 'audio' | 'video';
  role: 'caller' | 'callee';
  status: 'idle' | 'calling' | 'incoming' | 'connected' | 'reconnecting' | 'ended';
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  connectionState: RTCIceConnectionState | null;
}

interface CallContextType {
  callState: CallState;
  startCall: (roomId: string, peerId: string, peerName: string, type: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  isMicMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [callState, setCallState] = useState<CallState>({
    roomId: '',
    peerId: '',
    peerName: '',
    type: 'audio',
    role: 'caller',
    status: 'idle',
    remoteStream: null,
    localStream: null,
    connectionState: null,
  });

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const { user } = useAppSelector((state) => state.auth);

  const callStateRef = useRef(callState);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    if (!user) return;

    const handleIncoming = (data: { roomId: string; callerId: string; callerName: string; callType: 'audio' | 'video' }) => {
      if (callStateRef.current.status !== 'idle') {
        // We are busy in another call
        socketService.rejectCall({ roomId: data.roomId });
        return;
      }
      setCallState({
        roomId: data.roomId,
        peerId: data.callerId,
        peerName: data.callerName,
        type: data.callType,
        role: 'callee',
        status: 'incoming',
        remoteStream: null,
        localStream: null,
        connectionState: null,
      });
    };

    const handleAccepted = async (data: { roomId: string }) => {
      if (callStateRef.current.status !== 'calling') return;
      
      setCallState(prev => ({ ...prev, status: 'connected' }));

      try {
        await webrtcManager.fetchIceServers();
        webrtcManager.initializePeerConnection(
          (stream) => {
            setCallState(prev => ({ ...prev, remoteStream: stream }));
          },
          (connState) => {
            setCallState(prev => ({ ...prev, connectionState: connState }));
          },
          (signal: any) => {
            socketService.sendIceCandidate({
              roomId: data.roomId,
              targetUserId: callStateRef.current.peerId,
              signal,
            });
          }
        );

        await webrtcManager.createOffer();
      } catch (err) {
        console.error('Failed to initialize WebRTC connection:', err);
        handleEndCall();
      }
    };

    const handleRejected = (_data: { roomId: string }) => {
      alert('Call rejected or user is busy.');
      handleEndCall();
    };

    const handleEnded = (_data: { roomId: string }) => {
      handleEndCall();
    };

    const handleBusy = (_data: { roomId: string }) => {
      alert('User is busy.');
      handleEndCall();
    };

    const handleOffline = (_data: { roomId: string }) => {
      alert('User is offline.');
      handleEndCall();
    };

    const handleSignal = async (data: { roomId: string; senderId: string; signal: any }) => {
      if (callStateRef.current.status === 'idle') return;
      await webrtcManager.handleIncomingSignal(data.signal);
    };

    socketService.onCallIncoming(handleIncoming);
    socketService.onCallAccepted(handleAccepted);
    socketService.onCallRejected(handleRejected);
    socketService.onCallEnded(handleEnded);
    socketService.onCallBusy(handleBusy);
    socketService.onCallOffline(handleOffline);
    socketService.onCallSignal(handleSignal);

    return () => {
      socketService.offCallEvents();
    };
  }, [user]);

  const handleEndCall = () => {
    webrtcManager.cleanup();
    setCallState({
      roomId: '',
      peerId: '',
      peerName: '',
      type: 'audio',
      role: 'caller',
      status: 'idle',
      remoteStream: null,
      localStream: null,
      connectionState: null,
    });
    setIsMicMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
  };

  const startCall = async (roomId: string, peerId: string, peerName: string, type: 'audio' | 'video') => {
    try {
      setCallState({
        roomId,
        peerId,
        peerName,
        type,
        role: 'caller',
        status: 'calling',
        remoteStream: null,
        localStream: null,
        connectionState: null,
      });

      const localStream = await webrtcManager.startLocalStream(true, type === 'video');
      setCallState(prev => ({ ...prev, localStream }));

      socketService.initiateCall({ roomId, callType: type });
    } catch (err: any) {
      alert(`Could not start media device: ${err.message}`);
      handleEndCall();
    }
  };

  const acceptCall = async () => {
    if (callState.status !== 'incoming') return;
    try {
      setCallState(prev => ({ ...prev, status: 'connected' }));

      const localStream = await webrtcManager.startLocalStream(true, callState.type === 'video');
      setCallState(prev => ({ ...prev, localStream }));

      await webrtcManager.fetchIceServers();

      webrtcManager.initializePeerConnection(
        (stream) => {
          setCallState(prev => ({ ...prev, remoteStream: stream }));
        },
        (connState) => {
          setCallState(prev => ({ ...prev, connectionState: connState }));
        },
        (signal: any) => {
          socketService.sendIceCandidate({
            roomId: callState.roomId,
            targetUserId: callState.peerId,
            signal,
          });
        }
      );

      socketService.acceptCall({ roomId: callState.roomId });
    } catch (err: any) {
      alert(`Could not start media device: ${err.message}`);
      socketService.rejectCall({ roomId: callState.roomId });
      handleEndCall();
    }
  };

  const rejectCall = () => {
    socketService.rejectCall({ roomId: callState.roomId });
    handleEndCall();
  };

  const endCall = () => {
    socketService.endCall({ roomId: callState.roomId });
    handleEndCall();
  };

  const toggleMic = () => {
    if (webrtcManager.localStream) {
      const audioTrack = webrtcManager.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (webrtcManager.localStream) {
      const videoTrack = webrtcManager.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        await webrtcManager.stopScreenShare();
        setIsScreenSharing(false);
      } else {
        await webrtcManager.startScreenShare();
        setIsScreenSharing(true);
      }
    } catch (err) {
      console.error('Failed to toggle screen share:', err);
    }
  };

  return (
    <CallContext.Provider value={{
      callState,
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      isMicMuted,
      isCameraOff,
      isScreenSharing,
    }}>
      {children}
      {callState.status !== 'idle' && <CallOverlay />}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
