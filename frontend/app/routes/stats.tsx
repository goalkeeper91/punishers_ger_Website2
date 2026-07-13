import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { authFetch, isLoggedIn, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import {
  fetchAllTeamStats,
  fetchAllPlayerStats,
  fetchTeamStats,
  fetchMyStats,
  type TeamStatsSummary,
  type PlayerStats,
  type TeamStats,
  type MyStats,
  type TeamMapStat,
  type PlayerAdvancedStats,
  type PlayerMatchStats,
} from "~/lib/stats";

type LoaderData =
  | { scope: "admin"; teams: TeamStatsSummary[]; players: PlayerStats[] }
  | { scope: "captain"; team: TeamStats }
  | { scope: "player"; my: MyStats };

// Statistics are personal/team data, never public - always client-side auth
// gated (the JWT session lives in localStorage, unreachable during SSR),
// same convention as /profile and /admin/*.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const meRes = await authFetch("/users/me/");
  if (!meRes.ok) {
    if (meRes.status === 401 || meRes.status === 403) {
      throw redirect("/login");
    }
    throw new Error(`HTTP error! status: ${meRes.status}`);
  }
  const user: AuthUser = await meRes.json();

  if (user.is_superuser) {
    const [teams, players] = await Promise.all([fetchAllTeamStats(), fetchAllPlayerStats()]);
    return { scope: "admin", teams, players } satisfies LoaderData;
  }

  if (hasRole(user, ROLE_TEAM_MANAGER) && user.team_id) {
    const team = await fetchTeamStats(user.team_id);
    return { scope: "captain", team } satisfies LoaderData;
  }

  const my = await fetchMyStats();
  return { scope: "player", my } satisfies LoaderData;
};

export function HydrateFallback() {
  const { t } = useTranslation("stats");
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">{t("loading")}</p>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-6 text-center">
      <p className={`text-4xl font-bold mb-2 ${accent || "text-white"}`}>{value}</p>
      <p className="text-gray-400 text-sm uppercase tracking-wider">{label}</p>
    </div>
  );
}

function WinRateBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
      <div className="h-full bg-red-600" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

function MapStatsList({ maps }: { maps: TeamMapStat[] }) {
  const { t } = useTranslation("stats");
  if (maps.length === 0) {
    return <p className="text-gray-500 text-sm">{t("empty.no_maps")}</p>;
  }
  return (
    <ul className="space-y-4">
      {maps.map((map) => (
        <li key={map.map_name}>
          <div className="flex justify-between text-sm text-gray-300 mb-1">
            <span className="font-semibold">{map.map_name}</span>
            <span>
              {t("map_stats.record", { wins: map.wins, losses: map.losses, percent: map.win_rate_percent, matches: map.matches_played })}
            </span>
          </div>
          <WinRateBar percent={map.win_rate_percent} />
        </li>
      ))}
    </ul>
  );
}

function PlayerStatsTable({ players }: { players: PlayerStats[] }) {
  const { t } = useTranslation("stats");
  if (players.length === 0) {
    return <p className="text-gray-500 text-sm">{t("empty.no_roster_players")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">{t("player_table.player")}</th>
            <th className="py-2 pr-4">{t("player_table.level")}</th>
            <th className="py-2 pr-4">{t("player_table.elo")}</th>
            <th className="py-2 pr-4">{t("player_table.matches")}</th>
            <th className="py-2 pr-4">{t("player_table.win_rate")}</th>
            <th className="py-2 pr-4">{t("player_table.kd")}</th>
            <th className="py-2 pr-4">{t("player_table.hs_percent")}</th>
            <th className="py-2 pr-4">{t("player_table.avg_utility_dmg")}</th>
            <th className="py-2 pr-4">{t("player_table.avg_flashed")}</th>
            <th className="py-2 pr-4">{t("player_table.entry_rate")}</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.player_id} className="border-b border-gray-800 text-gray-300">
              <td className="py-2 pr-4 font-semibold text-white">{p.ingame_name}</td>
              <td className="py-2 pr-4">{p.skill_level ?? "–"}</td>
              <td className="py-2 pr-4">{p.faceit_elo ?? "–"}</td>
              <td className="py-2 pr-4">{p.matches ?? "–"}</td>
              <td className="py-2 pr-4">{p.win_rate_percent != null ? `${p.win_rate_percent}%` : "–"}</td>
              <td className="py-2 pr-4">{p.avg_kd_ratio ?? "–"}</td>
              <td className="py-2 pr-4">{p.avg_headshots_percent != null ? `${p.avg_headshots_percent}%` : "–"}</td>
              <td className="py-2 pr-4">{p.advanced?.avg_utility_damage ?? "–"}</td>
              <td className="py-2 pr-4">{p.advanced?.avg_enemies_flashed ?? "–"}</td>
              <td className="py-2 pr-4">
                {p.advanced?.entry_success_rate_percent != null ? `${p.advanced.entry_success_rate_percent}%` : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdvancedStatsGrid({ advanced }: { advanced: PlayerAdvancedStats }) {
  const { t } = useTranslation("stats");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <StatTile label={t("advanced_stats.avg_kills")} value={advanced.avg_kills ?? "–"} />
      <StatTile label={t("advanced_stats.avg_deaths")} value={advanced.avg_deaths ?? "–"} />
      <StatTile label={t("advanced_stats.avg_assists")} value={advanced.avg_assists ?? "–"} />
      <StatTile label={t("advanced_stats.total_mvps")} value={advanced.total_mvps ?? "–"} />
      <StatTile
        label={t("advanced_stats.avg_utility_damage")}
        value={advanced.avg_utility_damage ?? "–"}
      />
      <StatTile
        label={t("advanced_stats.avg_enemies_flashed")}
        value={advanced.avg_enemies_flashed ?? "–"}
        accent="text-yellow-400"
      />
      <StatTile
        label={t("advanced_stats.flash_success_rate")}
        value={advanced.flash_success_rate_percent != null ? `${advanced.flash_success_rate_percent}%` : "–"}
      />
      <StatTile
        label={t("advanced_stats.entry_success_rate")}
        value={advanced.entry_success_rate_percent != null ? `${advanced.entry_success_rate_percent}%` : "–"}
      />
      <StatTile
        label={t("advanced_stats.clutch_1v1")}
        value={advanced.clutch_1v1_success_rate_percent != null ? `${advanced.clutch_1v1_success_rate_percent}%` : "–"}
      />
      <StatTile
        label={t("advanced_stats.clutch_1v2")}
        value={advanced.clutch_1v2_success_rate_percent != null ? `${advanced.clutch_1v2_success_rate_percent}%` : "–"}
      />
      <StatTile label={t("advanced_stats.triple_quad_penta")} value={`${advanced.total_triple_kills ?? 0}/${advanced.total_quadro_kills ?? 0}/${advanced.total_penta_kills ?? 0}`} />
      <StatTile label={t("advanced_stats.matches_tracked")} value={advanced.matches_tracked} />
    </div>
  );
}

function RecentMatchesTable({ matches }: { matches: PlayerMatchStats[] }) {
  const { t } = useTranslation("stats");
  if (matches.length === 0) {
    return <p className="text-gray-500 text-sm">{t("empty.no_recent_matches")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">{t("matches_table.map")}</th>
            <th className="py-2 pr-4">{t("matches_table.opponent")}</th>
            <th className="py-2 pr-4">{t("matches_table.result")}</th>
            <th className="py-2 pr-4">{t("matches_table.kda")}</th>
            <th className="py-2 pr-4">{t("matches_table.hs_percent")}</th>
            <th className="py-2 pr-4">{t("matches_table.mvps")}</th>
            <th className="py-2 pr-4">{t("matches_table.flashed")}</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.faceit_match_id} className="border-b border-gray-800 text-gray-300">
              <td className="py-2 pr-4 font-semibold text-white">{match.map_name ?? t("matches_table.unknown_map")}</td>
              <td className="py-2 pr-4">{match.opponent_name ?? "–"}</td>
              <td className="py-2 pr-4">
                <span className={match.result === "win" ? "text-green-500" : match.result === "loss" ? "text-red-500" : ""}>
                  {match.result === "win" ? t("matches_table.win") : match.result === "loss" ? t("matches_table.loss") : "–"}
                </span>
              </td>
              <td className="py-2 pr-4">{match.kills ?? "–"}/{match.deaths ?? "–"}/{match.assists ?? "–"}</td>
              <td className="py-2 pr-4">{match.headshots_percent != null ? `${match.headshots_percent}%` : "–"}</td>
              <td className="py-2 pr-4">{match.mvps ?? "–"}</td>
              <td className="py-2 pr-4">{match.enemies_flashed ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamStatsTable({ teams }: { teams: TeamStatsSummary[] }) {
  const { t } = useTranslation("stats");
  if (teams.length === 0) {
    return <p className="text-gray-500 text-sm">{t("empty.no_teams")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">{t("teams_table.team")}</th>
            <th className="py-2 pr-4">{t("teams_table.players")}</th>
            <th className="py-2 pr-4">{t("teams_table.matches")}</th>
            <th className="py-2 pr-4">{t("teams_table.wins_losses")}</th>
            <th className="py-2 pr-4">{t("teams_table.win_rate")}</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.team_id} className="border-b border-gray-800 text-gray-300">
              <td className="py-2 pr-4 font-semibold text-white">{t.team_name}</td>
              <td className="py-2 pr-4">{t.player_count}</td>
              <td className="py-2 pr-4">{t.matches_played}</td>
              <td className="py-2 pr-4">{t.wins} / {t.losses}</td>
              <td className="py-2 pr-4">{t.win_rate_percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminStatsView({ teams, players }: { teams: TeamStatsSummary[]; players: PlayerStats[] }) {
  const { t } = useTranslation("stats");
  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{t("admin_view.all_teams")}</h2>
        <TeamStatsTable teams={teams} />
      </section>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{t("admin_view.all_players")}</h2>
        <PlayerStatsTable players={players} />
      </section>
    </div>
  );
}

function CaptainStatsView({ team }: { team: TeamStats }) {
  const { t } = useTranslation("stats");
  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatTile label={t("captain_view.matches")} value={team.matches_played} />
        <StatTile label={t("captain_view.wins_losses")} value={`${team.wins} / ${team.losses}`} />
        <StatTile label={t("captain_view.win_rate")} value={`${team.win_rate_percent}%`} accent="text-green-500" />
      </div>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{t("captain_view.maps_heading", { team: team.team_name })}</h2>
        <MapStatsList maps={team.maps} />
      </section>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{t("captain_view.roster_heading")}</h2>
        <PlayerStatsTable players={team.players ?? []} />
      </section>
    </div>
  );
}

function PlayerStatsView({ my }: { my: MyStats }) {
  const { t } = useTranslation("stats");
  return (
    <div className="space-y-10 max-w-3xl mx-auto">
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{t("player_view.my_stats_heading")}</h2>
        {my.player ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatTile label={t("player_view.faceit_level")} value={my.player.skill_level ?? "–"} />
            <StatTile label={t("player_view.elo")} value={my.player.faceit_elo ?? "–"} />
            <StatTile label={t("player_view.matches")} value={my.player.matches ?? "–"} />
            <StatTile
              label={t("player_view.win_rate")}
              value={my.player.win_rate_percent != null ? `${my.player.win_rate_percent}%` : "–"}
              accent="text-green-500"
            />
            <StatTile label={t("player_view.kd")} value={my.player.avg_kd_ratio ?? "–"} />
            <StatTile
              label={t("player_view.hs_percent")}
              value={my.player.avg_headshots_percent != null ? `${my.player.avg_headshots_percent}%` : "–"}
            />
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            {t("empty.no_faceit_stats")}
          </p>
        )}
      </section>

      {my.player?.advanced && (
        <section className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-4">{t("player_view.advanced_stats_heading")}</h2>
          <AdvancedStatsGrid advanced={my.player.advanced} />
        </section>
      )}

      {my.player && (
        <section className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-4">{t("player_view.recent_matches_heading")}</h2>
          <RecentMatchesTable matches={my.player.recent_matches} />
        </section>
      )}

      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">
          {my.team ? t("player_view.team_stats_heading_with_name", { team: my.team.team_name }) : t("player_view.team_stats_heading")}
        </h2>
        {my.team ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <StatTile label={t("player_view.matches_label")} value={my.team.matches_played} />
              <StatTile label={t("player_view.wins_losses")} value={`${my.team.wins} / ${my.team.losses}`} />
              <StatTile label={t("player_view.win_rate_label")} value={`${my.team.win_rate_percent}%`} accent="text-green-500" />
            </div>
            <MapStatsList maps={my.team.maps} />
          </>
        ) : (
          <p className="text-gray-500 text-sm">{t("empty.no_team")}</p>
        )}
      </section>
    </div>
  );
}

export default function StatsPage() {
  const data = useLoaderData() as LoaderData;
  const { t } = useTranslation("stats");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-10">{t("page_title")}</h1>

        {data.scope === "admin" && <AdminStatsView teams={data.teams} players={data.players} />}
        {data.scope === "captain" && <CaptainStatsView team={data.team} />}
        {data.scope === "player" && <PlayerStatsView my={data.my} />}
      </div>
    </div>
  );
}
