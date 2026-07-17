/**
 * Zustand auth store – persists user and token in localStorage.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id:        string;
  email:     string;
  role:      'owner' | 'receptionist' | 'coach' | 'customer';
  firstName: string;
  /** Multi-tenant scope: the immutable club workspace this session belongs to */
  clubId?:   string;
  clubSlug?: string;
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
        // The access token is kept IN MEMORY ONLY (never localStorage) so an XSS
        // payload cannot read it. Session survival across reloads is handled by
        // the HttpOnly refresh cookie: on load the first API call 401s and the
        // axios interceptor silently refreshes. Only the non-sensitive user
        // profile is persisted (also mirrored to cf_user for the landing page).
        localStorage.setItem('cf_user', JSON.stringify(user));
        set({ user, accessToken });
      },

      clearAuth: () => {
        // removeItem('cf_access_token') purges any token left by an older build.
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
      // Persist ONLY the user profile. The access token stays in memory (see
      // setAuth) so it is never written to disk-backed storage.
      partialize: (s) => ({ user: s.user }),
    }
  )
);
