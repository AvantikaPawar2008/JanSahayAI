import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Custom hook for Supabase Realtime subscriptions on a table.
 * Returns live-updating data array.
 * 
 * Usage: const tickets = useSupabaseRealtime('master_tickets', '*', { status: 'OPEN' })
 */
export default function useSupabaseRealtime(table, event = '*', filters = {}) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Initial fetch
    const fetchData = async () => {
      let query = supabase.from(table).select('*')
      
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value)
      })

      const { data: result, error } = await query.order('created_at', { ascending: false })
      if (!error && result) {
        setData(result)
      }
      setLoading(false)
    }

    fetchData()

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        'postgres_changes',
        {
          event: event,
          schema: 'public',
          table: table,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setData((prev) => [payload.new, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setData((prev) =>
              prev.map((item) =>
                item.id === payload.new.id ? payload.new : item
              )
            )
          } else if (payload.eventType === 'DELETE') {
            setData((prev) =>
              prev.filter((item) => item.id !== payload.old.id)
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, event])

  return { data, loading }
}
