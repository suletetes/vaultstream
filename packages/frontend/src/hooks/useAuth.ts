/**
 * useAuth Hook — React hook for authentication state
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isAuthenticated,
  getAuthUser,
  initiateLogin,
  logout as doLogout,
  AuthUser,
} from '../stores/auth-store';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(getAuthUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getAuthUser());
    setLoading(false);
  }, []);

  const login = useCallback(() => {
    initiateLogin();
  }, []);

  const logout = useCallback(() => {
    doLogout();
    setUser(null);
  }, []);

  return {
    user,
    isAuthenticated: isAuthenticated(),
    loading,
    login,
    logout,
  };
}
