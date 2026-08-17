import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { identify } from '../lib/socket';

const STORAGE_KEY = 'drops.user';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [signingIn, setSigningIn] = useState(false);

  // Keep the socket's room membership in step with who is signed in.
  useEffect(() => {
    identify(user?.id ?? null);
  }, [user]);

  const signIn = useCallback(async (username) => {
    setSigningIn(true);
    try {
      const { user: signedIn } = await api.login(username);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(signedIn));
      setUser(signedIn);
      return signedIn;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut, signingIn }), [user, signIn, signOut, signingIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
