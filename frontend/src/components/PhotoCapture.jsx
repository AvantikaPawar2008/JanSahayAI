import { useState, useRef } from 'react'
import { Camera, X, RotateCcw } from 'lucide-react'

/**
 * PhotoCapture — forces camera-only capture (blocks gallery upload).
 * Uses `capture="environment"` on the file input.
 * Props: onCapture(file), label, disabled
 */
export default function PhotoCapture({ onCapture, label = 'Take Photo', disabled = false }) {
  const [preview, setPreview] = useState(null)
  const [fileName, setFileName] = useState('')
  const inputRef = useRef(null)

  const handleCapture = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      setPreview(URL.createObjectURL(file))
      onCapture?.(file)
    }
  }

  const clearPhoto = () => {
    setPreview(null)
    setFileName('')
    if (inputRef.current) {
      inputRef.current.value = ''
    }
    onCapture?.(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {preview ? (
        <div className="relative group">
          <img
            src={preview}
            alt="Captured"
            className="w-full h-48 object-cover rounded-xl border border-white/10"
          />
          <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={clearPhoto}
              className="p-2 rounded-full bg-red-500/80 hover:bg-red-500 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
          <span className="absolute bottom-2 left-2 text-xs text-white/60 bg-black/50 px-2 py-1 rounded">
            {fileName}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full h-48 rounded-xl border-2 border-dashed border-white/15 hover:border-civic-500/50
                     bg-white/5 hover:bg-white/8 transition-all duration-300
                     flex flex-col items-center justify-center gap-3 cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <div className="w-12 h-12 rounded-full bg-civic-600/30 flex items-center justify-center
                          group-hover:bg-civic-600/50 transition-colors">
            <Camera className="w-6 h-6 text-civic-400" />
          </div>
          <span className="text-sm text-white/50 group-hover:text-white/70 transition-colors">
            {label}
          </span>
        </button>
      )}

      {/* Hidden file input — capture="environment" forces rear camera, accept restricts to images */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        className="hidden"
      />
    </div>
  )
}
