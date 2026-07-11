/**
 * Zustand auth store – persists user and token in localStorage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id:        string;
  email:     string;
  role:      'owner' | 'receptionist' | 'customer';
  firstName: string;
}

interface AuthState {
  user:        AuthUser | null;
  accessToken: string | null;
  setAuth:     (user: AuthUser, token: string) => void;
  clearAuth:   () => void;
  isOwner:       () => boolean;
  isReceptionist: () => boolean;
  isCustomer:    () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user:        null,
      accessToken: null,

      setAuth: (user, accessToken) => {
        localStorage.setItem('cf_access_token', accessToken);
        localStorage.setItem('cf_user', JSON.stringify(user));
        set({ user, accessToken });
      },

      clearAuth: () => {
        localStorage.removeItem('cf_access_token');
        localStorage.removeItem('cf_user');
        set({ user: null, accessToken: null });
      },

      isOwner:        () => get().user?.role === 'owner',
      isReceptionist: () => get().user?.role === 'receptionist',
      isCustomer:     () => get().user?.role === 'customer',
    }),
    {
      name:    'cf-auth',
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken }),
    }
  )
);
