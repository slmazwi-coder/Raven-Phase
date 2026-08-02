import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'raven_auth_token';
const DEVICE_ID_KEY = 'raven_device_id';

export interface AuthMember {
  id: string;
  role: 'admin' | 'moderator' | 'member';
  fullName?: string;
  cellNumber?: string;
}

interface AuthContextValue {
  token: string | null;
  member: AuthMember | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  getDeviceId: () => Promise<string>;
}

function decodeJwt(token: string): { sub: string; role: string; fullName?: string; exp: number } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload + '==='.slice(0, (4 - (payload.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

// SecureStore is polyfilled for web by expo-secure-store
async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [member, setMember] = useState<AuthMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await secureGet(TOKEN_KEY);
        if (stored) {
          const decoded = decodeJwt(stored);
          // Check not expired
          if (decoded.exp * 1000 > Date.now()) {
            setToken(stored);
            setMember({ id: decoded.sub, role: decoded.role as AuthMember['role'], fullName: decoded.fullName });
          } else {
            await secureDelete(TOKEN_KEY);
          }
        }
      } catch {
        // Corrupted token — clear it
        await secureDelete(TOKEN_KEY).catch(() => {});
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (newToken: string) => {
    const decoded = decodeJwt(newToken);
    await secureSet(TOKEN_KEY, newToken);
    setToken(newToken);
    setMember({ id: decoded.sub, role: decoded.role as AuthMember['role'], fullName: decoded.fullName });
  }, []);

  const logout = useCallback(async () => {
    await secureDelete(TOKEN_KEY).catch(() => {});
    setToken(null);
    setMember(null);
  }, []);

  const getDeviceId = useCallback(async (): Promise<string> => {
    let id = await secureGet(DEVICE_ID_KEY);
    if (!id) {
      // Generate a stable device ID using timestamp + random
      id =
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).slice(2, 10) +
        '-' +
        Platform.OS;
      await secureSet(DEVICE_ID_KEY, id);
    }
    return id;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        member,
        isLoading,
        isAuthenticated: !!token && !!member,
        login,
        logout,
        getDeviceId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
