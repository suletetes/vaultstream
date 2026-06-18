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

  // Web Crypto (crypto.subtle) is only available in secure contexts (HTTPS / localhost).
  // When the app is served over plain HTTP (e.g. an S3 website endpoint without
  // CloudFront), fall back to a pure-JS SHA-256 implementation so PKCE still works.
  let digestBytes: Uint8Array;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', data);
    digestBytes = new Uint8Array(digest);
  } else {
    digestBytes = sha256(data);
  }

  return base64UrlEncode(digestBytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Pure-JS SHA-256 (FIPS 180-4) — used only as a fallback when the Web Crypto
 * API is unavailable (non-secure HTTP context). Returns a 32-byte digest.
 */
function sha256(message: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

  // Pre-processing (padding)
  const l = message.length;
  const bitLen = l * 8;
  const withOne = l + 1;
  const k = ((56 - (withOne % 64)) + 64) % 64;
  const total = withOne + k + 8;
  const buf = new Uint8Array(total);
  buf.set(message);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, bitLen >>> 0, false);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = dv.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15]!;
      const w2 = w[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }

    let a = H[0]!;
    let b = H[1]!;
    let c = H[2]!;
    let d = H[3]!;
    let e = H[4]!;
    let f = H[5]!;
    let g = H[6]!;
    let h = H[7]!;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]!, false);
  return out;
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
