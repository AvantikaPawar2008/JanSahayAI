import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const setRoleCache = (r) => {
    try {
      localStorage.setItem('jansahayai_role', r)
      localStorage.setItem('civicpulse_role', r)
    } catch (_) {}
  }

  const clearRoleCache = () => {
    try {
      localStorage.removeItem('jansahayai_role')
      localStorage.removeItem('civicpulse_role')
    } catch (_) {}
  }

  const [cachedRole, setCachedRole] = useState(() => {
    return localStorage.getItem('jansahayai_role') || localStorage.getItem('civicpulse_role') || null
  })
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (currentUser) => {
    const userId = currentUser?.id || currentUser
    if (!userId) {
      setProfile(null)
      setCachedRole(null)
      clearRoleCache()
      return null
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.warn('Profile fetch notice:', error.message)
      }

      if (data) {
        setProfile(data)
        if (data.role) {
          setCachedRole(data.role)
          setRoleCache(data.role)
        }
        return data
      }

      // If no profile found in DB, fallback to citizen so user is never stuck
      const fallback = {
        id: userId,
        role: 'citizen',
        full_name: currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User',
      }
      setProfile(fallback)
      setCachedRole('citizen')
      setRoleCache('citizen')

      try {
        await supabase.from('profiles').upsert(fallback)
      } catch (_) {}

      return fallback
    } catch (err) {
      console.error('Error fetching profile:', err)
      return null
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const safetyTimer = setTimeout(() => {
      if (isMounted && loading) {
        setLoading(false)
      }
    }, 2500)

    // 1. Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await fetchProfile(session.user)
      } else {
        setProfile(null)
        setCachedRole(null)
        clearRoleCache()
      }
      if (isMounted) setLoading(false)
    }).catch(() => {
      if (isMounted) setLoading(false)
    })

    // 2. Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        if (!isMounted) return
        setSession(currentSession)
        setUser(currentSession?.user ?? null)

        if (currentSession?.user) {
          await fetchProfile(currentSession.user)
        } else {
          setProfile(null)
          setCachedRole(null)
          clearRoleCache()
        }
        if (isMounted) setLoading(false)
      }
    )

    return () => {
      isMounted = false
      clearTimeout(safetyTimer)
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  const login = async (email, password) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) throw error

      let userProfile = null
      if (data?.user) {
        setUser(data.user)
        setSession(data.session)
        userProfile = await fetchProfile(data.user)
        if (userProfile) {
          setProfile(userProfile)
          if (userProfile.role) {
            setCachedRole(userProfile.role)
            setRoleCache(userProfile.role)
          }
        }
      }
      return { user: data.user, session: data.session, profile: userProfile }
    } finally {
      setLoading(false)
    }
  }

  const signup = async (email, password, fullName, phoneNumber) => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone_number: phoneNumber,
          },
        },
      })
      if (error) throw error

      if (data?.user) {
        setUser(data.user)
        setSession(data.session)
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            role: 'citizen',
            full_name: fullName,
            phone_number: phoneNumber,
          })
        } catch (_) {}
        const userProfile = await fetchProfile(data.user)
        setProfile(userProfile)
        setCachedRole('citizen')
        setRoleCache('citizen')
        return { user: data.user, session: data.session, profile: userProfile }
      }

      return data
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await supabase.auth.signOut()
    } catch (_) {}
    setUser(null)
    setSession(null)
    setProfile(null)
    setCachedRole(null)
    clearRoleCache()
    setLoading(false)
  }

  const role = profile?.role || cachedRole || (user && !loading ? 'citizen' : null)

  const value = {
    user,
    session,
    profile,
    role,
    loading: loading || (Boolean(user) && !role),
    login,
    signup,
    logout,
    refreshProfile: () => user && fetchProfile(user),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
