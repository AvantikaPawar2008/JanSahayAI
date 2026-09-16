import { useState, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, Loader2 } from 'lucide-react'

/**
 * VoiceRecorderButton — uses MediaRecorder API to capture audio as WebM blob.
 * Props: onRecordingComplete(blob), disabled
 */
export default function VoiceRecorderButton({ onRecordingComplete, disabled = false }) {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })

      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        onRecordingComplete?.(blob)
        
        // Clean up stream
        streamRef.current?.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start(100)
      setRecording(true)
      setDuration(0)

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)
    } catch (err) {
      console.error('Microphone access denied:', err)
      alert('Please allow microphone access to record voice complaints.')
    }
  }, [onRecordingComplete])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
      clearInterval(timerRef.current)
    }
  }, [recording])

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={disabled}
        className={`
          relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300
          ${recording
            ? 'bg-red-500 recording-active shadow-lg shadow-red-500/40'
            : 'bg-civic-600 hover:bg-civic-500 shadow-lg shadow-civic-500/20 hover:shadow-civic-500/40'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {recording ? (
          <Square className="w-6 h-6 text-white fill-white" />
        ) : (
          <Mic className="w-6 h-6 text-white" />
        )}
      </button>

      <span className={`text-xs font-medium ${recording ? 'text-red-400' : 'text-white/50'}`}>
        {recording ? `Recording ${formatDuration(duration)}` : 'Tap to record'}
      </span>

      {recording && (
        <div className="flex gap-1 items-center">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-red-400 rounded-full animate-pulse"
              style={{
                height: `${8 + Math.random() * 16}px`,
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
