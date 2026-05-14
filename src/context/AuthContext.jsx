import React, { createContext, useContext, useEffect, useState } from 'react'
import { getCurrentUser, login as apiLogin, register as apiRegister, logout as apiLogout } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [user, setUser] = useState(null)

  useEffect(() => {
    // Initial fetch to see if we have an active session
    getCurrentUser().then(u => {
      setUser(u)
      setSession(u ? { active: true } : null)
    }).catch(err => {
      console.error('Failed to get current user:', err)
      setUser(null)
      setSession(null)
    })
  }, [])

  const login = async (email, password) => {
    await apiLogin(email, password)
    const u = await getCurrentUser()
    setUser(u)
    setSession(u ? { active: true } : null)
  }

  const register = async (firstName, lastName, email, password) => {
    await apiRegister(firstName, lastName, email, password)
    const u = await getCurrentUser()
    setUser(u)
    setSession(u ? { active: true } : null)
  }

  const signOut = async () => {
    try {
      await apiLogout()
    } finally {
      setUser(null)
      setSession(null)
      // Hard refresh to clear all states and caches
      window.location.href = '/'
    }
  }

  return (
    <AuthContext.Provider value={{ session, user, login, register, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
