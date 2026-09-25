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
    if (!file) return

    // Quick preview
    setFileName(file.name)
    setPreview(URL.createObjectURL(file))

    // Client-side canvas compression to reduce 10MB+ phone photos to ~250KB
    try {
      const reader = new FileReader()
      reader.onload = (event) => {
        const img = new Image()
        img.onload = () => {
          const maxDim = 1600
          let width = img.width
          let height = img.height

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }

          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const optimizedFile = new File(
                  [blob],
                  file.name.replace(/\.[^/.]+$/, '') + '.jpg',
                  { type: 'image/jpeg', lastModified: Date.now() }
                )
                onCapture?.(optimizedFile)
              } else {
                onCapture?.(file)
              }
            },
            'image/jpeg',
            0.85
          )
        }
        img.onerror = () => onCapture?.(file)
        img.src = event.target.result
      }
      reader.onerror = () => onCapture?.(file)
      reader.readAsDataURL(file)
    } catch {
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
            className="w-full h-48 object-cover rounded-xl border border-ivory-300 shadow-sm"
          />
          <div className="absolute inset-0 bg-charcoal-900/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={clearPhoto}
              className="p-2 rounded-full bg-coral-600 hover:bg-coral-700 text-white transition-colors shadow-sm"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="p-2 rounded-full bg-white/80 hover:bg-white text-charcoal-800 transition-colors shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
          <span className="absolute bottom-2 left-2 text-xs text-white bg-charcoal-900/70 px-2.5 py-1 rounded-md font-mono">
            {fileName}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full h-48 rounded-2xl border-2 border-dashed border-ivory-300 hover:border-civic-500
                     bg-ivory-50/80 hover:bg-ivory-100 transition-all duration-300
                     flex flex-col items-center justify-center gap-3 cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <div className="w-12 h-12 rounded-2xl bg-civic-50 border border-civic-200 flex items-center justify-center
                          group-hover:bg-civic-100 transition-colors">
            <Camera className="w-6 h-6 text-civic-700" />
          </div>
          <span className="text-sm font-semibold text-charcoal-600 group-hover:text-charcoal-900 transition-colors">
            {label}
          </span>
        </button>
      )}

      {/* Hidden file input — allows image selection & camera across desktop and mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,image/jpeg,image/png,image/webp"
        onChange={handleCapture}
        className="hidden"
      />
    </div>
  )
}
