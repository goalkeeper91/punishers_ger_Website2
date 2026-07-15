// Fetches for public (unauthenticated) sponsor/social data, plus click
// tracking. Falls back to the sample data in sampleAssets.ts when the
// backend has no sponsors yet and sample mode is on (see config.ts).

import { API_BASE_URL, USE_SAMPLE_ASSETS } from "./config";
import { sampleSponsors, sampleMatchHighlights, sampleCreators, type SampleSponsor } from "./sampleAssets";

export interface Sponsor {
  id: number;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: "premium" | "general";
  is_active: boolean;
  order: number;
  click_count: number;
}

export interface SocialLink {
  id: number;
  platform: string;
  url: string;
  is_active: boolean;
  order: number;
  click_count: number;
}

export const PLATFORM_LABELS: Record<string, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  twitter: "Twitter",
  instagram: "Instagram",
  facebook: "Facebook",
  discord: "Discord",
  tiktok: "TikTok",
  other: "Link",
};

function sponsorFromSample(sample: SampleSponsor): Sponsor {
  return { ...sample, is_active: true, order: 0, click_count: 0 };
}

export async function fetchActiveSponsors(): Promise<Sponsor[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/sponsors/`);
    const data: Sponsor[] = res.ok ? await res.json() : [];
    if (data.length === 0 && USE_SAMPLE_ASSETS) {
      return sampleSponsors.map(sponsorFromSample);
    }
    return data;
  } catch (error) {
    console.error("Failed to fetch sponsors:", error);
    return USE_SAMPLE_ASSETS ? sampleSponsors.map(sponsorFromSample) : [];
  }
}

export async function fetchActiveSocialLinks(): Promise<SocialLink[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/socials/`);
    if (!res.ok) return [];
    return await res.json();
  } catch (error) {
    console.error("Failed to fetch social links:", error);
    return [];
  }
}

export interface TeamTeaser {
  id: number;
  name: string;
  game: string;
  description: string | null;
  image_url: string | null;
  is_main_team: boolean;
}

/** Just the org's main (flagship) teams, for the home page teaser grid -
 * the full roster/detail view lives on /teams and /teams/:id. */
export async function fetchMainTeams(): Promise<TeamTeaser[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/teams/`);
    if (!res.ok) return [];
    const teams: TeamTeaser[] = await res.json();
    return teams.filter((team) => team.is_main_team);
  } catch (error) {
    console.error("Failed to fetch teams:", error);
    return [];
  }
}

export interface MatchHighlight {
  kind: "next" | "last";
  faceit_match_id: string;
  team_name: string;
  opponent_name: string | null;
  competition_name: string | null;
  scheduled_at: string | null;
  finished_at: string | null;
  status: string;
  result: "win" | "loss" | "draw" | null;
  team_score: number | null;
  opponent_score: number | null;
}

/** One "next"/"last" entry per team that has synced match data - every
 * team gets a turn in the homepage widget's rotation, not just one. */
export async function fetchMatchHighlights(): Promise<MatchHighlight[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/matches/highlights/`);
    const data: MatchHighlight[] = res.ok ? await res.json() : [];
    if (data.length === 0 && USE_SAMPLE_ASSETS) {
      return sampleMatchHighlights;
    }
    return data;
  } catch (error) {
    console.error("Failed to fetch match highlights:", error);
    return USE_SAMPLE_ASSETS ? sampleMatchHighlights : [];
  }
}

export interface CreatorLiveStatus {
  title: string | null;
  game_name: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  started_at: string | null;
}

export interface Creator {
  id: number;
  username: string;
  profile_picture_url: string | null;
  bio: string | null;
  is_featured: boolean;
  twitch_link: string | null;
  youtube_link: string | null;
  twitter_link: string | null;
  live: CreatorLiveStatus | null;
}

/** DB-registered content creators, with live Twitch status when available.
 * No stream-title search here - Twitch's API has no full-text title search
 * (see README), so only creators we've explicitly marked in the admin can
 * show up as "live", never third-party casters of our matches. */
export async function fetchCreators(): Promise<Creator[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/creators/`);
    const data: Creator[] = res.ok ? await res.json() : [];
    if (data.length === 0 && USE_SAMPLE_ASSETS) {
      return sampleCreators;
    }
    return data;
  } catch (error) {
    console.error("Failed to fetch creators:", error);
    return USE_SAMPLE_ASSETS ? sampleCreators : [];
  }
}

/** Fire-and-forget click tracking; never blocks navigation on failure. */
export function trackSponsorClick(id: number): void {
  if (id < 0) return; // sample/demo sponsor - not a real backend row
  fetch(`${API_BASE_URL}/sponsors/${id}/click/`, { method: "POST" }).catch(() => {});
}

export function trackSocialClick(id: number): void {
  fetch(`${API_BASE_URL}/socials/${id}/click/`, { method: "POST" }).catch(() => {});
}
