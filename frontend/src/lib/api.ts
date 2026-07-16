/**
 * Axios API client with automatic token injection and refresh.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './stores/auth.store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,   // send HttpOnly cookies for refresh token
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach access token ─────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (typeof window !== 'undefined') {
    // The access token lives in memory only (see auth.store.ts). After a hard
    // refresh it is briefly null — the first call 401s and the response
    // interceptor below refreshes it from the HttpOnly cookie, then retries.
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Multipart uploads must let the browser set the boundary — strip the
    // JSON default so multer receives a parseable multipart body.
    if (config.data instanceof FormData) {
      config.headers.setContentType(null);
    }
  }
  return config;
});

// ── Response interceptor: handle 401 → refresh ───────────────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;

    // Only 401 is refreshable. A 401 means the access token is missing/expired/
    // invalid, which a refresh can fix. A 403 means the session is valid but the
    // role is not permitted for this route (e.g. a non-staff user hitting
    // /bookings/:id/verify) — refreshing the token cannot change the role, so
    // retrying would spin forever. Reject 403s immediately and let the caller
    // surface the permission error.
    if (status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          // Mark the queued request as retried too, otherwise a persistently
          // failing 401 would re-enter the refresh flow and loop indefinitely.
          originalRequest._retry = true;
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        // Token is memory-only — update the store, never localStorage.
        useAuthStore.setState({ accessToken: data.accessToken });
        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed → the session is truly dead. Clear all client auth state
        // and return to a clean login page.
        processQueue(refreshError, null);
        localStorage.removeItem('cf_access_token'); // purge any legacy token
        localStorage.removeItem('cf_user');
        useAuthStore.setState({ accessToken: null, user: null });
        // Guard against a redirect loop when the failing call originated on /login.
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
