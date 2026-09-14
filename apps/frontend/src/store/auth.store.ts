import { create } from 'zustand';
import { User } from '@/types';
import { setAuth, clearAuth, getToken, getUser } from '@/lib/auth';
import { authApi } from '@/lib/api';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
  /** Refresca el usuario en memoria y en localStorage — el sidebar lo lee de ahi,
   *  asi que sin esto un cambio de perfil no se ve hasta el proximo login. */
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: null,
  user: null,
  isLoading: false,

  hydrate: () => {
    set({ token: getToken(), user: getUser() });
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const data = await authApi.login(email, password);
      setAuth(data.access_token, data.user);
      set({ token: data.access_token, user: data.user });
    } finally {
      set({ isLoading: false });
    }
  },

  setUser: (user) => {
    const token = getToken();
    if (token) setAuth(token, user);
    set({ user });
  },

  logout: () => {
    clearAuth();
    set({ token: null, user: null });
  },
}));
