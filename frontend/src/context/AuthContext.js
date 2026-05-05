import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

/**
 * Returns the storage area used by the current tab.
 * - Impersonated tabs (opened from SuperAdmin "Gestão") have their JWT in
 *   sessionStorage and a flag `impersonating=1`. They MUST keep using
 *   sessionStorage to avoid clobbering the SuperAdmin's localStorage token
 *   in the original tab.
 * - Normal tabs use localStorage as before.
 */
const getAuthStorage = () => {
  if (typeof window === 'undefined') return null;
  if (sessionStorage.getItem('token')) return sessionStorage;
  return localStorage;
};

const readToken = () => {
  return sessionStorage.getItem('token') || localStorage.getItem('token');
};

const readUser = () => {
  try {
    const raw = sessionStorage.getItem('user') || localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => readUser());
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(readToken());

  useEffect(() => {
    if (token) {
      loadUser();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadUser = async () => {
    try {
      const response = await authAPI.getCurrentUser();
      setUser(response.data);
      // Cache the user in the same storage that holds the token so that
      // page reloads inside an impersonated tab don't fall back to the
      // SuperAdmin's localStorage user.
      const storage = getAuthStorage();
      if (storage) {
        storage.setItem('user', JSON.stringify(response.data));
      }
    } catch (error) {
      console.error('Failed to load user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const persistSession = (accessToken, userData) => {
    // Brand new logins always go to localStorage. Impersonated tabs never
    // call login()/register(); they receive the token through
    // ImpersonateHandler which writes directly into sessionStorage.
    localStorage.setItem('token', accessToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
  };

  const login = async (credentials, isSuperAdmin = false) => {
    try {
      const response = isSuperAdmin
        ? await authAPI.superAdminLogin(credentials)
        : await authAPI.login(credentials);

      const { access_token, user: userData } = response.data;
      persistSession(access_token, userData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Login failed'
      };
    }
  };

  const register = async (data) => {
    try {
      const response = await authAPI.register(data);
      const { access_token, user: userData } = response.data;
      persistSession(access_token, userData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.detail || 'Registration failed'
      };
    }
  };

  const logout = () => {
    // Only clear the storage that owns this tab's session. Logging out of an
    // impersonated tab MUST NOT remove the SuperAdmin's token from
    // localStorage.
    if (sessionStorage.getItem('token')) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('impersonating');
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    setToken(null);
    setUser(null);
  };

  const refreshUser = () => {
    setToken(readToken());
  };

  const isImpersonating = !!sessionStorage.getItem('impersonating');

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    refreshUser,
    isImpersonating,
    isAuthenticated: !!user,
    isSuperAdmin: user?.role === 'super_admin',
    isCompanyAdmin: user?.role === 'company_admin',
    hasCRM: user?.company?.plan_type === 'crm' || user?.company?.plan_type === 'both',
    hasScheduling: user?.company?.plan_type === 'scheduling' || user?.company?.plan_type === 'both'
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
