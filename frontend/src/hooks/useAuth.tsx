import { useState, useEffect, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { fetchApi } from '../lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
  balance: number;
  refreshBalance: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!localStorage.getItem('token');
  });
  const [balance, setBalance] = useState<number>(0);

  const refreshBalance = async () => {
    if (!isAuthenticated) return;
    try {
      const data = await fetchApi('/wallet');
      setBalance(Number(data.balance));
    } catch (err) {
      console.error('Failed to fetch balance', err);
      if (err instanceof Error && (err as any).status === 401) {
        logout();
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refreshBalance();
    }
  }, [isAuthenticated]);

  const login = (token: string) => {
    localStorage.setItem('token', token);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setBalance(0);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, balance, refreshBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
