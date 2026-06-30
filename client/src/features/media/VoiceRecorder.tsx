import React, { useState, useRef, useEffect } from 'react';
import { Send, Trash2, Play, Pause, Lock, Unlock } from 'lucide-react';
import './VoiceRecorder.css';

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob) => void;
  onCancel: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSend, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [waveforms, setWaveforms] = useState<number[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording(false);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Audio waveform analysis using Web Audio API
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateWaveform = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Take a slice/avg of frequencies to generate bars
        const average = Array.from(dataArray).slice(0, 15).map(val => Math.max(5, val / 4));
        setWaveforms(average);
        
        animationFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      animationFrameRef.current = requestAnimationFrame(updateWaveform);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone.');
      onCancel();
    }
  };

  const stopRecording = (shouldPreview: boolean) => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const tracks = mediaRecorderRef.current?.stream.getTracks() || [];
        tracks.forEach(track => track.stop());

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        if (!shouldPreview) {
          onCancel();
        }
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob);
    }
  };

  const togglePlayback = () => {
    if (!audioPreviewRef.current) return;
    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      audioPreviewRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="voice-recorder-container fade-in">
      {audioUrl ? (
        // Playback Preview mode
        <div className="audio-preview-mode">
          <audio 
            ref={audioPreviewRef} 
            src={audioUrl} 
            onEnded={() => setIsPlayingPreview(false)}
            style={{ display: 'none' }}
          />
          <button type="button" className="action-btn preview-play-btn" onClick={togglePlayback}>
            {isPlayingPreview ? <Pause size={18} /> : <Play size={18} />}
          </button>
          
          <span className="preview-label">Review Voice Note</span>

          <div className="recording-actions">
            <button type="button" className="action-btn cancel-record-btn" onClick={onCancel} title="Delete">
              <Trash2 size={18} />
            </button>
            <button type="button" className="send-btn record-send-btn" onClick={handleSend} title="Send Voice Message">
              <Send size={18} />
            </button>
          </div>
        </div>
      ) : (
        // Recording mode
        <div className="recording-active-mode">
          <div className="recording-indicator">
            <div className="recording-pulse"></div>
            <span className="recording-time">{formatTime(recordingTime)}</span>
          </div>

          {/* Waveform Visualizer */}
          <div className="visualizer-bars">
            {waveforms.map((h, idx) => (
              <div 
                key={idx} 
                className="waveform-bar" 
                style={{ height: `${h}px` }}
              ></div>
            ))}
          </div>

          <div className="recording-actions">
            <button 
              type="button" 
              className={`action-btn lock-btn ${isLocked ? 'locked' : ''}`} 
              onClick={() => setIsLocked(!isLocked)}
              title={isLocked ? "Recording locked" : "Lock recording"}
            >
              {isLocked ? <Lock size={18} /> : <Unlock size={18} />}
            </button>
            <button type="button" className="action-btn cancel-record-btn" onClick={() => stopRecording(false)} title="Cancel">
              <Trash2 size={18} />
            </button>
            <button type="button" className="send-btn record-send-btn" onClick={() => stopRecording(true)} title="Stop & Review">
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceRecorder;
