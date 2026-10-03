import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // Prevent maplibre-gl worker from being bundled inline (it's huge)
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // deck.gl core into its own lazy chunk
          if (id.includes('@deck.gl') || id.includes('luma.gl') || id.includes('@loaders.gl')) {
            return 'deck-gl'
          }
          // MapLibre + react-map-gl into its own lazy chunk
          if (id.includes('maplibre-gl') || id.includes('react-map-gl')) {
            return 'maplibre'
          }
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
})
