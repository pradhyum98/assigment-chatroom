import React, { useState, useRef, useEffect } from 'react';
import { Send, Trash2 } from 'lucide-react';
import './VoiceRecorder.css';

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob) => void;
  onCancel: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSend, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecording(false);
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

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone.');
      onCancel();
    }
  };

  const stopRecording = (send: boolean) => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const tracks = mediaRecorderRef.current?.stream.getTracks() || [];
        tracks.forEach(track => track.stop());

        if (send) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          onSend(audioBlob);
        } else {
          onCancel();
        }
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="voice-recorder-container fade-in">
      <div className="recording-indicator">
        <div className="recording-pulse"></div>
        <span className="recording-time">{formatTime(recordingTime)}</span>
      </div>
      <div className="recording-actions">
        <button type="button" className="action-btn cancel-record-btn" onClick={() => stopRecording(false)} title="Cancel">
          <Trash2 size={18} />
        </button>
        <button type="button" className="send-btn record-send-btn" onClick={() => stopRecording(true)} title="Send Voice Message">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
};

export default VoiceRecorder;
