// Fetches for admin-uploaded site assets: the home page hero video and the
// per-page background images (see backend/site_settings). Both are public,
// unauthenticated reads - every route that needs one calls these directly
// from its own loader, the same way each route already fetches its own
// primary data (see app/lib/publicContent.ts).

import { API_BASE_URL } from "./config";

export async function fetchHeroVideoUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/site-settings/`);
    if (!res.ok) return null;
    const data: { hero_video_url: string | null } = await res.json();
    return data.hero_video_url;
  } catch (error) {
    console.error("Failed to fetch hero video:", error);
    return null;
  }
}

export type PageBackgroundKey =
  | "news"
  | "teams"
  | "about_us"
  | "sponsors"
  | "contact"
  | "join_us"
  | "privacy"
  | "imprint"
  | "creators";

/** All 9 keys can theoretically be requested at once, but each page only
 * needs its own - callers pass their page_key and get back that one URL
 * (or null if the admin hasn't uploaded one for that page yet). */
export async function fetchPageBackground(pageKey: PageBackgroundKey): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/site-settings/page-backgrounds/`);
    if (!res.ok) return null;
    const data: Record<string, string | null> = await res.json();
    return data[pageKey] ?? null;
  } catch (error) {
    console.error("Failed to fetch page background:", error);
    return null;
  }
}
