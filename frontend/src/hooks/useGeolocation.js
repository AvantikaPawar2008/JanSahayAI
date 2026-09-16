import { useState, useEffect, useCallback } from 'react'

/**
 * Custom hook for browser geolocation — wraps navigator.geolocation.watchPosition
 * Returns { lat, lng, accuracy, error, loading, refresh }
 */
export default function useGeolocation(options = {}) {
  const [position, setPosition] = useState({
    lat: null,
    lng: null,
    accuracy: null,
  })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
        ...options,
      }
    )
  }, [])

  useEffect(() => {
    refresh()

    // Watch for position changes
    let watchId
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
          setLoading(false)
        },
        (err) => {
          setError(err.message)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
          ...options,
        }
      )
    }

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [])

  return { ...position, error, loading, refresh }
}
