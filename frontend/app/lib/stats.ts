// Stats-dashboard fetches (see backend fastapi_app/main.py "/stats/..."
// endpoints). Unlike publicContent.ts these all require auth - every call
// goes through authFetch (JWT-attached, auto-refresh-on-401, see auth.ts) -
// and the backend itself enforces who may see what per role, so there is no
// dev/sample fallback here.

import { authFetch } from "./auth";

export interface PlayerAdvancedStats {
  matches_tracked: number;
  avg_kills: number | null;
  avg_deaths: number | null;
  avg_assists: number | null;
  avg_kd_ratio: number | null;
  avg_kr_ratio: number | null;
  avg_headshots_percent: number | null;
  total_mvps: number | null;
  total_triple_kills: number | null;
  total_quadro_kills: number | null;
  total_penta_kills: number | null;
  avg_utility_damage: number | null;
  avg_enemies_flashed: number | null;
  flash_success_rate_percent: number | null;
  entry_success_rate_percent: number | null;
  clutch_1v1_success_rate_percent: number | null;
  clutch_1v2_success_rate_percent: number | null;
}

export interface PlayerMatchStats {
  faceit_match_id: string;
  map_name: string | null;
  opponent_name: string | null;
  finished_at: string | null;
  result: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  kd_ratio: number | null;
  headshots_percent: number | null;
  mvps: number | null;
  utility_damage: number | null;
  flash_count: number | null;
  enemies_flashed: number | null;
  entry_count: number | null;
  entry_wins: number | null;
}

export interface PlayerStats {
  player_id: number;
  ingame_name: string;
  user_id: number | null;
  username: string | null;
  team_id: number | null;
  team_name: string | null;
  nickname: string | null;
  skill_level: number | null;
  faceit_elo: number | null;
  matches: number | null;
  win_rate_percent: number | null;
  avg_kd_ratio: number | null;
  avg_headshots_percent: number | null;
  last_synced_at: string | null;
  // CS2 "advanced stats" (utility, flash, entry, clutches) - only present
  // once at least one of the player's finished matches has detailed FACEIT
  // match-stats synced (see backend faceit_integration/sync.py).
  advanced: PlayerAdvancedStats | null;
  recent_matches: PlayerMatchStats[];
}

export interface TeamMapStat {
  map_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate_percent: number;
}

export interface TeamStats {
  team_id: number;
  team_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate_percent: number;
  maps: TeamMapStat[];
  players: PlayerStats[] | null; // only populated for Admin/Teammanager of this team
}

export interface TeamStatsSummary {
  team_id: number;
  team_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate_percent: number;
  player_count: number;
}

export interface MyStats {
  player: PlayerStats | null;
  team: TeamStats | null; // always map-only (players: null)
}

async function getJson<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} bei ${path}`);
  }
  return res.json();
}

export function fetchMyStats(): Promise<MyStats> {
  return getJson<MyStats>("/stats/me/");
}

export function fetchTeamStats(teamId: number): Promise<TeamStats> {
  return getJson<TeamStats>(`/stats/teams/${teamId}/`);
}

export function fetchAllTeamStats(): Promise<TeamStatsSummary[]> {
  return getJson<TeamStatsSummary[]>("/stats/teams/");
}

export function fetchAllPlayerStats(): Promise<PlayerStats[]> {
  return getJson<PlayerStats[]>("/stats/players/");
}
