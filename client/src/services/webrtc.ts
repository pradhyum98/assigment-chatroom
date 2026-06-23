import api from './api';

let ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

export class WebRtcManager {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  public screenStream: MediaStream | null = null;

  private onRemoteStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onConnectionStateCallback: ((state: RTCIceConnectionState) => void) | null = null;
  private onSignalCallback: ((signal: any) => void) | null = null;

  constructor() {
    console.log('[WebRTC Manager] Initializing...');
  }

  async fetchIceServers() {
    try {
      const response = await api.get('/calls/ice-servers');
      if (response.data.success && response.data.data.iceServers) {
        ICE_SERVERS = { iceServers: response.data.data.iceServers };
      }
    } catch (err) {
      console.warn('Failed to fetch ICE servers from backend, using defaults:', err);
    }
  }

  // ── Stream Capture ─────────────────────────────────────────────────────────

  async startLocalStream(audio: boolean, video: boolean): Promise<MediaStream> {
    this.stopLocalStream();
    
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      return this.localStream;
    } catch (err) {
      console.error('Failed to get local stream:', err);
      throw err;
    }
  }

  stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }

  // ── Connection Lifecycle ───────────────────────────────────────────────────

  initializePeerConnection(
    onRemoteStream: (stream: MediaStream) => void,
    onConnectionState: (state: RTCIceConnectionState) => void,
    onSignal: (signal: any) => void
  ): RTCPeerConnection {
    this.cleanup();
    
    this.onRemoteStreamCallback = onRemoteStream;
    this.onConnectionStateCallback = onConnectionState;
    this.onSignalCallback = onSignal;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnection = pc;

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        if (this.localStream) {
          pc.addTrack(track, this.localStream);
        }
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this.remoteStream = stream;
        this.onRemoteStreamCallback?.(stream);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignalCallback?.({ candidate: event.candidate });
      }
    };

    // Handle connection state
    pc.oniceconnectionstatechange = () => {
      this.onConnectionStateCallback?.(pc.iceConnectionState);
    };

    return pc;
  }

  async createOffer(): Promise<void> {
    if (!this.peerConnection) return;
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.onSignalCallback?.({ sdp: offer });
    } catch (err) {
      console.error('Error creating RTC offer:', err);
    }
  }

  async handleIncomingSignal(signal: any): Promise<void> {
    if (!this.peerConnection) return;

    try {
      if (signal.sdp) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === 'offer') {
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.onSignalCallback?.({ sdp: answer });
        }
      } else if (signal.candidate) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error('Error handling WebRTC signal:', err);
    }
  }

  // ── Screen Sharing ─────────────────────────────────────────────────────────

  async startScreenShare(): Promise<MediaStream> {
    if (!this.peerConnection || !this.localStream) {
      throw new Error('Call is not active or local media stream is missing.');
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');

      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
      }

      // Listen for browser native stop screen sharing button click
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      return this.screenStream;
    } catch (err) {
      console.error('Failed to get screen share stream:', err);
      throw err;
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }

    // Restore local camera track
    if (this.peerConnection && this.localStream) {
      const cameraTrack = this.localStream.getVideoTracks()[0];
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');

      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }
    }
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  cleanup() {
    console.log('[WebRTC Manager] Cleaning up call state and tracks.');
    
    this.stopScreenShare();
    this.stopLocalStream();

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.onRemoteStreamCallback = null;
    this.onConnectionStateCallback = null;
    this.onSignalCallback = null;
  }
}

export const webrtcManager = new WebRtcManager();
