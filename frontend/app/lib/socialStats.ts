// Social-media reach stats (see backend fastapi_app/main.py
// "/admin/social-stats/..." endpoints). Admin/sponsor-facing only, gated by
// the same "sponsors.manage_sponsors" permission as the sponsors/socials
// admin pages - always goes through authFetch like stats.ts.

import { authFetch } from "./auth";

export interface Trend {
  change: number;
  percent: number | null;
  days: number;
}

export interface ViewerStats {
  avg_viewers: number;
  peak_viewers: number;
  samples: number;
}

export interface SocialChannel {
  platform: string;
  follower_count: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  reach_count: number | null;
  impressions_count: number | null;
  data_source: "auto" | "manual";
  stats_updated_at: string | null;
  trend: Trend | null;
  viewer_stats: ViewerStats | null;
}

export interface SocialMetricsPayload {
  follower_count?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  share_count?: number | null;
  reach_count?: number | null;
  impressions_count?: number | null;
}

export interface OrgSocialChannel extends SocialChannel {
  id: number;
  url: string;
  is_active: boolean;
  click_count: number;
  twitch_connected: boolean;
  twitch_authorized_login: string | null;
}

export interface PlayerReach {
  user_id: number;
  username: string;
  ingame_name: string;
  team_id: number | null;
  team_name: string | null;
  channels: SocialChannel[];
  total_followers: number;
}

export interface TeamReach {
  team_id: number;
  team_name: string;
  player_count: number;
  total_followers: number;
}

export interface SocialStatsOverview {
  org_channels: OrgSocialChannel[];
  org_total_followers: number;
  players: PlayerReach[];
  teams: TeamReach[];
}

export interface SocialStatsSyncSummary {
  org_channels_synced: number;
  org_channels_failed: number;
  player_channels_synced: number;
  player_channels_failed: number;
  trigger: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bei ${path}`);
  }
  return res.json();
}

export function fetchSocialStatsOverview(): Promise<SocialStatsOverview> {
  return getJson<SocialStatsOverview>("/admin/social-stats/");
}

export async function updateOrgSocialStats(linkId: number, payload: SocialMetricsPayload): Promise<OrgSocialChannel> {
  const res = await authFetch(`/admin/social-stats/org/${linkId}/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Aktualisieren des Org-Kanals`);
  return res.json();
}

export async function updatePlayerSocialStats(
  userId: number,
  platform: string,
  payload: SocialMetricsPayload
): Promise<SocialChannel> {
  const res = await authFetch(`/admin/social-stats/players/${userId}/${platform}/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Aktualisieren der Spieler-Stats`);
  return res.json();
}

export async function triggerSocialStatsSync(): Promise<SocialStatsSyncSummary> {
  const res = await authFetch("/admin/social-stats/sync/", { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Sync-Trigger`);
  return res.json();
}

// Twitch OAuth connect/disconnect - see fastapi_app/main.py
// "/social-stats/twitch/..." endpoints. Twitch removed public follower
// counts in 2023, so this is the only way to get them synced automatically.

export async function fetchTwitchAuthorizeUrl(
  target: "player" | "org",
  socialLinkId?: number
): Promise<string> {
  const params = new URLSearchParams({ target });
  if (socialLinkId != null) params.set("social_link_id", String(socialLinkId));
  const res = await authFetch(`/social-stats/twitch/authorize-url/?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Abrufen der Twitch-Autorisierungs-URL`);
  const data = await res.json();
  return data.url;
}

export async function disconnectTwitchPlayer(): Promise<void> {
  const res = await authFetch("/social-stats/twitch/player/", { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Trennen von Twitch`);
}

export async function disconnectTwitchOrg(linkId: number): Promise<void> {
  const res = await authFetch(`/admin/social-stats/twitch/org/${linkId}/`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Trennen von Twitch`);
}

// Self-service (player's own channels) - no admin/sponsors.manage_sponsors
// permission needed, since these only ever touch the caller's own row.

export function fetchMySocialChannels(): Promise<SocialChannel[]> {
  return getJson<SocialChannel[]>("/social-stats/me/");
}

export async function updateMySocialStats(platform: string, payload: SocialMetricsPayload): Promise<SocialChannel> {
  const res = await authFetch(`/social-stats/me/${platform}/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Aktualisieren der eigenen Statistik`);
  return res.json();
}

// Screenshot OCR (see fastapi_app/main.py "/social-stats/screenshot/") -
// local Tesseract OCR, never persists the uploaded image. One screenshot
// (e.g. an Instagram insights card) can yield several metrics at once -
// `metrics` keys are SocialChannel field names (follower_count,
// like_count, ...) - pre-filling the existing manual inputs, which the
// player/admin still reviews before saving.

export interface ScreenshotOcrResult {
  raw_text: string;
  candidates: number[];
  metrics: Partial<Record<keyof SocialMetricsPayload, number>>;
}

export async function analyzeScreenshot(file: File): Promise<ScreenshotOcrResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch("/social-stats/screenshot/", { method: "POST", body: formData });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Auswerten des Screenshots`);
  return res.json();
}
