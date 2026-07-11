// Dev/prod asset switch (see .env.example: VITE_USE_SAMPLE_ASSETS).
//
// In sample mode the site uses obvious placeholder images everywhere so it's
// fully browsable with zero real assets. In production mode it falls back to
// a neutral "no image" graphic instead of a loud placeholder.com image.
//
// Sponsors/social links themselves are now real backend data (see
// /sponsors/, /socials/ and the admin dashboard) - the arrays below are only
// used as a demo fallback when the database has no sponsors yet and sample
// mode is on, so local dev isn't a blank page.

import { USE_SAMPLE_ASSETS } from "./config";

export const sampleSponsorLogos = [
  "https://via.placeholder.com/120x60?text=Sponsor+A",
  "https://via.placeholder.com/120x60?text=Sponsor+B",
  "https://via.placeholder.com/120x60?text=Sponsor+C",
  "https://via.placeholder.com/120x60?text=Sponsor+D",
  "https://via.placeholder.com/120x60?text=Sponsor+E",
  "https://via.placeholder.com/120x60?text=Sponsor+F",
];

export interface SampleSponsor {
  id: number;
  name: string;
  logo_url: string;
  website_url: string | null;
  tier: "premium" | "general";
}

export const sampleSponsors: SampleSponsor[] = [
  { id: -1, name: "Gaming Gear Pro", logo_url: "https://via.placeholder.com/250x120?text=Premium+Sponsor+1", website_url: null, tier: "premium" },
  { id: -2, name: "Energy Drink X", logo_url: "https://via.placeholder.com/250x120?text=Premium+Sponsor+2", website_url: null, tier: "premium" },
  { id: -3, name: "Streaming Platform Y", logo_url: "https://via.placeholder.com/250x120?text=Premium+Sponsor+3", website_url: null, tier: "premium" },
  { id: -4, name: "Tech Solutions", logo_url: "https://via.placeholder.com/200x100?text=Sponsor+A", website_url: null, tier: "general" },
  { id: -5, name: "Apparel Brand", logo_url: "https://via.placeholder.com/200x100?text=Sponsor+B", website_url: null, tier: "general" },
  { id: -6, name: "Software Company", logo_url: "https://via.placeholder.com/200x100?text=Sponsor+C", website_url: null, tier: "general" },
  { id: -7, name: "Hardware Store", logo_url: "https://via.placeholder.com/200x100?text=Sponsor+D", website_url: null, tier: "general" },
];

export interface SampleMatchHighlight {
  kind: "next" | "last";
  faceit_match_id: string;
  team_name: string;
  opponent_name: string;
  competition_name: string;
  scheduled_at: string | null;
  finished_at: string | null;
  status: "upcoming" | "finished";
  result: "win" | "loss" | "draw" | null;
  team_score: number | null;
  opponent_score: number | null;
}

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

// Two teams here on purpose - demonstrates that the widget rotates through
// every team's matches, not just a single flagship squad.
export const sampleMatchHighlights: SampleMatchHighlight[] = [
  {
    kind: "next",
    faceit_match_id: "sample-next-1",
    team_name: "Punishers Main",
    opponent_name: "Rival Squad",
    competition_name: "DACH CS Season 5",
    scheduled_at: inDays(3),
    finished_at: null,
    status: "upcoming",
    result: null,
    team_score: null,
    opponent_score: null,
  },
  {
    kind: "last",
    faceit_match_id: "sample-last-1",
    team_name: "Punishers Main",
    opponent_name: "Old Rivals",
    competition_name: "DACH CS Season 4",
    scheduled_at: null,
    finished_at: inDays(-2),
    status: "finished",
    result: "win",
    team_score: 16,
    opponent_score: 10,
  },
  {
    kind: "next",
    faceit_match_id: "sample-next-2",
    team_name: "Punishers Valorant",
    opponent_name: "Second Rivals",
    competition_name: "ESEA Season 12",
    scheduled_at: inDays(5),
    finished_at: null,
    status: "upcoming",
    result: null,
    team_score: null,
    opponent_score: null,
  },
  {
    kind: "last",
    faceit_match_id: "sample-last-2",
    team_name: "Punishers Valorant",
    opponent_name: "Bronze Legends",
    competition_name: "ESEA Season 11",
    scheduled_at: null,
    finished_at: inDays(-6),
    status: "finished",
    result: "loss",
    team_score: 10,
    opponent_score: 13,
  },
];

export interface SampleCreatorLive {
  title: string | null;
  game_name: string | null;
  viewer_count: number | null;
  thumbnail_url: string | null;
  started_at: string | null;
}

export interface SampleCreator {
  id: number;
  username: string;
  profile_picture_url: string | null;
  bio: string | null;
  is_featured: boolean;
  twitch_link: string | null;
  youtube_link: string | null;
  twitter_link: string | null;
  live: SampleCreatorLive | null;
}

// One creator is marked "live" here on purpose, so the LIVE badge/UI is
// visible in local dev even without real Twitch API credentials configured.
export const sampleCreators: SampleCreator[] = [
  {
    id: -1,
    username: "GamerGirl_X",
    profile_picture_url: "https://via.placeholder.com/300x300?text=GamerGirl_X",
    bio: "Bekannt für ihre energiegeladenen Shooter-Streams und entspannten RPG-Sessions. Täglich live auf Twitch!",
    is_featured: true,
    twitch_link: "https://twitch.tv/gamergirl_x",
    youtube_link: "https://youtube.com",
    twitter_link: null,
    live: {
      title: "CASTING PUNISHERS vs RIVAL SQUAD - DACH CS Season 5",
      game_name: "Counter-Strike 2",
      viewer_count: 245,
      thumbnail_url: "https://via.placeholder.com/320x180?text=LIVE",
      started_at: inDays(0),
    },
  },
  {
    id: -2,
    username: "EsportAnalyst",
    profile_picture_url: "https://via.placeholder.com/300x300?text=EsportAnalyst",
    bio: "Tiefgehende Analysen, Match-Reviews und Prognosen zu den größten Esport-Events. Dein Guide durch die kompetitive Szene.",
    is_featured: true,
    twitch_link: null,
    youtube_link: "https://youtube.com",
    twitter_link: "https://twitter.com",
    live: null,
  },
  {
    id: -3,
    username: "RetroGamer_DE",
    profile_picture_url: "https://via.placeholder.com/300x300?text=RetroGamer_DE",
    bio: "Eine Reise in die Vergangenheit des Gamings. Entdecke Klassiker neu oder erlebe sie zum ersten Mal mit RetroGamer_DE.",
    is_featured: true,
    twitch_link: "https://twitch.tv/retrogamer_de",
    youtube_link: "https://youtube.com",
    twitter_link: null,
    live: null,
  },
  {
    id: -4,
    username: "SpeedRunner_Pro",
    profile_picture_url: "https://via.placeholder.com/150?text=SpeedRunner_Pro",
    bio: "Speedruns aus diversen Titeln, immer auf der Jagd nach dem nächsten Weltrekord.",
    is_featured: false,
    twitch_link: "https://twitch.tv/speedrunner_pro",
    youtube_link: null,
    twitter_link: null,
    live: null,
  },
  {
    id: -5,
    username: "PixelArtist_DE",
    profile_picture_url: "https://via.placeholder.com/150?text=PixelArtist_DE",
    bio: "Kreative Pixel-Art-Sessions und Design-Talk.",
    is_featured: false,
    twitch_link: null,
    youtube_link: null,
    twitter_link: "https://twitter.com",
    live: null,
  },
  {
    id: -6,
    username: "MobileGamer_YT",
    profile_picture_url: "https://via.placeholder.com/150?text=MobileGamer_YT",
    bio: "Mobile Games im Fokus - Reviews, Let's Plays und Tier-Lists.",
    is_featured: false,
    twitch_link: null,
    youtube_link: "https://youtube.com",
    twitter_link: null,
    live: null,
  },
  {
    id: -7,
    username: "StrategyKing",
    profile_picture_url: "https://via.placeholder.com/150?text=StrategyKing",
    bio: "Strategiespiele auf höchstem Niveau, von Echtzeit-Strategie bis 4X.",
    is_featured: false,
    twitch_link: "https://twitch.tv/strategyking",
    youtube_link: "https://youtube.com",
    twitter_link: null,
    live: null,
  },
  {
    id: -8,
    username: "IRL_Explorer",
    profile_picture_url: "https://via.placeholder.com/150?text=IRL_Explorer",
    bio: "Unterwegs abseits des Bildschirms - IRL-Streams von Events und Reisen.",
    is_featured: false,
    twitch_link: null,
    youtube_link: null,
    twitter_link: "https://twitter.com",
    live: null,
  },
];

export const NO_IMAGE_FALLBACK = "/images/no-image.svg";

/** Fallback `src` for an optional image: a placeholder in sample mode, a
 * neutral "no image" graphic in production mode. */
export function imageFallback(sampleUrl: string): string {
  return USE_SAMPLE_ASSETS ? sampleUrl : NO_IMAGE_FALLBACK;
}
