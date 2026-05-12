import React, { createContext, useContext, useEffect, useState } from 'react'
import { getCurrentUser } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined = loading, null = signed out, object = signed in
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    getCurrentUser()
      .then(user => setSession(user ?? null))
      .catch(() => setSession(null))
  }, [])

  const signInWithGoogle = () => {
    window.location.href = '/api/login'
  }

  const signOut = () => {
    window.location.href = '/api/logout'
  }

  return (
    <AuthContext.Provider value={{ session, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
