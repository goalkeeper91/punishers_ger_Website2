// Client-side JWT session handling. Tokens live in localStorage (this is a
// browser-only module - every export here assumes `window` exists) and every
// authenticated request should go through `authFetch`, which attaches the
// access token and transparently refreshes it once on a 401.

import { API_BASE_URL } from "./config";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  profile_picture_url: string | null;
  steam_id: string | null;
  game_profile_link: string | null;
  twitter_link: string | null;
  twitch_link: string | null;
  youtube_link: string | null;
  instagram_link: string | null;
  tiktok_link: string | null;
  twitch_connected: boolean;
  twitch_authorized_login: string | null;
  team_id: number | null;
  team_name: string | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  // Timestamp of the account's first activation, or null if it has never
  // been activated (a fresh/pending registration) - see admin/users.tsx,
  // which uses this to decide whether an account is eligible for hard
  // delete (never activated) or only soft-delete (was activated at some
  // point, even if currently deactivated).
  activated_at: string | null;
  roles: string[];
  // Real Django permission codenames ("app_label.codename", e.g.
  // "news.manage_news") granted via the user's roles - see
  // backend fastapi_app/main.py MANAGEABLE_PERMISSIONS. Empty for a
  // superuser (Django's has_perm() bypasses this list entirely for them),
  // so any check here must be combined with `is_superuser ||`.
  permissions: string[];
}

// "System roles" with actual enforced meaning on the backend (see
// backend/users/models.py ROLE_TEAM_MANAGER / ROLE_AUTHOR) - must match
// those Django Group names exactly. Any other role a user is assigned is
// just a cosmetic label with no special access.
export const ROLE_TEAM_MANAGER = "Teammanager";
export const ROLE_AUTHOR = "Author";

export function hasRole(user: Pick<AuthUser, "roles"> | null | undefined, role: string): boolean {
  return !!user?.roles?.includes(role);
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: { access_token: string; refresh_token: string }): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      clearTokens();
      return null;
    }
    const data: { access_token: string } = await response.json();
    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * fetch() wrapper for authenticated API calls. Attaches the access token,
 * and if the server reports it expired/invalid (401), refreshes it once via
 * the refresh token and retries the request before giving up.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const doFetch = (token: string | null) => {
    const headers = new Headers(options.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  };

  let response = await doFetch(getAccessToken());
  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await doFetch(newToken);
    }
  }
  return response;
}
