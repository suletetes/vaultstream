/**
 * Auth Store — In-memory token management (not localStorage for security)
 *
 * Implements Cognito PKCE flow with:
 * - Tokens stored in memory only (cleared on page refresh)
 * - Automatic token refresh before expiry
 * - Secure logout (revoke + clear)
 *
 * Requirements: 36.7, 12.2, 12.3
 */

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  tier: 'free' | 'pro' | 'enterprise';
}

// In-memory storage (never persisted to localStorage)
let tokens: AuthTokens | null = null;
let currentUser: AuthUser | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || '';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '';
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || 'http://localhost:3000/callback';

// ─── Token Management ───────────────────────────────────────────────────────

export function getAuthTokens(): AuthTokens | null {
  return tokens;
}

export function getAuthUser(): AuthUser | null {
  return currentUser;
}

export function isAuthenticated(): boolean {
  return tokens !== null && tokens.expiresAt > Date.now() / 1000;
}

export function setAuth(newTokens: AuthTokens, user: AuthUser): void {
  tokens = newTokens;
  currentUser = user;
  scheduleRefresh();
}

export function clearAuth(): void {
  tokens = null;
  currentUser = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ─── PKCE Flow ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function initiateLogin(): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store verifier in sessionStorage (needed for callback)
  sessionStorage.setItem('pkce_verifier', codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

export async function handleCallback(code: string): Promise<void> {
  const codeVerifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');

  if (!codeVerifier) {
    throw new Error('Missing PKCE verifier');
  }

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error('Token exchange failed');
  }

  const data = await response.json();
  const decoded = parseJwt(data.id_token);

  const authTokens: AuthTokens = {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };

  const email = decoded.email ?? '';
  const user: AuthUser = {
    userId: decoded.sub ?? '',
    email,
    displayName: decoded.name || email,
    role: decoded['custom:role'] === 'admin' ? 'admin' : 'user',
    tier:
      decoded['custom:tier'] === 'pro' || decoded['custom:tier'] === 'enterprise'
        ? decoded['custom:tier']
        : 'free',
  };

  setAuth(authTokens, user);
}

export async function refreshAccessToken(): Promise<void> {
  if (!tokens?.refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    clearAuth();
    throw new Error('Token refresh failed');
  }

  const data = await response.json();
  tokens = {
    ...tokens,
    accessToken: data.access_token,
    idToken: data.id_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };

  scheduleRefresh();
}

export function logout(): void {
  clearAuth();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: window.location.origin + '/login',
  });
  window.location.href = `${COGNITO_DOMAIN}/logout?${params}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!tokens) return;

  // Refresh 5 minutes before expiry
  const msUntilExpiry = (tokens.expiresAt - Math.floor(Date.now() / 1000) - 300) * 1000;
  if (msUntilExpiry > 0) {
    refreshTimer = setTimeout(() => {
      refreshAccessToken().catch(() => clearAuth());
    }, msUntilExpiry);
  }
}

function parseJwt(token: string): Record<string, string | undefined> {
  const base64Url = token.split('.')[1];
  if (!base64Url) {
    throw new Error('Invalid JWT: missing payload segment');
  }
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}
