import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
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
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Statistiken werden geladen...</p>
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
  if (maps.length === 0) {
    return <p className="text-gray-500 text-sm">Noch keine gespielten Maps erfasst.</p>;
  }
  return (
    <ul className="space-y-4">
      {maps.map((map) => (
        <li key={map.map_name}>
          <div className="flex justify-between text-sm text-gray-300 mb-1">
            <span className="font-semibold">{map.map_name}</span>
            <span>
              {map.wins}S / {map.losses}N · {map.win_rate_percent}% ({map.matches_played} Matches)
            </span>
          </div>
          <WinRateBar percent={map.win_rate_percent} />
        </li>
      ))}
    </ul>
  );
}

function PlayerStatsTable({ players }: { players: PlayerStats[] }) {
  if (players.length === 0) {
    return <p className="text-gray-500 text-sm">Keine Spieler im Roster.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">Spieler</th>
            <th className="py-2 pr-4">Level</th>
            <th className="py-2 pr-4">Elo</th>
            <th className="py-2 pr-4">Matches</th>
            <th className="py-2 pr-4">Win-Rate</th>
            <th className="py-2 pr-4">K/D</th>
            <th className="py-2 pr-4">HS-%</th>
            <th className="py-2 pr-4">Ø Utility-DMG</th>
            <th className="py-2 pr-4">Ø Geflasht</th>
            <th className="py-2 pr-4">Entry-Rate</th>
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
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
      <StatTile label="Ø Kills" value={advanced.avg_kills ?? "–"} />
      <StatTile label="Ø Deaths" value={advanced.avg_deaths ?? "–"} />
      <StatTile label="Ø Assists" value={advanced.avg_assists ?? "–"} />
      <StatTile label="MVPs (gesamt)" value={advanced.total_mvps ?? "–"} />
      <StatTile
        label="Ø Utility-Schaden"
        value={advanced.avg_utility_damage ?? "–"}
      />
      <StatTile
        label="Ø Geflashte Gegner"
        value={advanced.avg_enemies_flashed ?? "–"}
        accent="text-yellow-400"
      />
      <StatTile
        label="Flash-Erfolgsquote"
        value={advanced.flash_success_rate_percent != null ? `${advanced.flash_success_rate_percent}%` : "–"}
      />
      <StatTile
        label="Entry-Erfolgsquote"
        value={advanced.entry_success_rate_percent != null ? `${advanced.entry_success_rate_percent}%` : "–"}
      />
      <StatTile
        label="1v1-Clutch-Quote"
        value={advanced.clutch_1v1_success_rate_percent != null ? `${advanced.clutch_1v1_success_rate_percent}%` : "–"}
      />
      <StatTile
        label="1v2-Clutch-Quote"
        value={advanced.clutch_1v2_success_rate_percent != null ? `${advanced.clutch_1v2_success_rate_percent}%` : "–"}
      />
      <StatTile label="Triple/Quadro/Penta Kills" value={`${advanced.total_triple_kills ?? 0}/${advanced.total_quadro_kills ?? 0}/${advanced.total_penta_kills ?? 0}`} />
      <StatTile label="Ausgewertete Matches" value={advanced.matches_tracked} />
    </div>
  );
}

function RecentMatchesTable({ matches }: { matches: PlayerMatchStats[] }) {
  if (matches.length === 0) {
    return <p className="text-gray-500 text-sm">Noch keine detaillierten Match-Statistiken synchronisiert.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">Map</th>
            <th className="py-2 pr-4">Gegner</th>
            <th className="py-2 pr-4">Ergebnis</th>
            <th className="py-2 pr-4">K/D/A</th>
            <th className="py-2 pr-4">HS-%</th>
            <th className="py-2 pr-4">MVPs</th>
            <th className="py-2 pr-4">Geflasht</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.faceit_match_id} className="border-b border-gray-800 text-gray-300">
              <td className="py-2 pr-4 font-semibold text-white">{match.map_name ?? "Unbekannt"}</td>
              <td className="py-2 pr-4">{match.opponent_name ?? "–"}</td>
              <td className="py-2 pr-4">
                <span className={match.result === "win" ? "text-green-500" : match.result === "loss" ? "text-red-500" : ""}>
                  {match.result === "win" ? "Sieg" : match.result === "loss" ? "Niederlage" : "–"}
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
  if (teams.length === 0) {
    return <p className="text-gray-500 text-sm">Noch keine Teams vorhanden.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
            <th className="py-2 pr-4">Team</th>
            <th className="py-2 pr-4">Spieler</th>
            <th className="py-2 pr-4">Matches</th>
            <th className="py-2 pr-4">Sieg/Niederlage</th>
            <th className="py-2 pr-4">Win-Rate</th>
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
  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Alle Teams</h2>
        <TeamStatsTable teams={teams} />
      </section>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Alle Spieler</h2>
        <PlayerStatsTable players={players} />
      </section>
    </div>
  );
}

function CaptainStatsView({ team }: { team: TeamStats }) {
  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatTile label="Matches" value={team.matches_played} />
        <StatTile label="Sieg / Niederlage" value={`${team.wins} / ${team.losses}`} />
        <StatTile label="Win-Rate" value={`${team.win_rate_percent}%`} accent="text-green-500" />
      </div>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">{team.team_name} · Maps</h2>
        <MapStatsList maps={team.maps} />
      </section>
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Roster-Statistiken</h2>
        <PlayerStatsTable players={team.players ?? []} />
      </section>
    </div>
  );
}

function PlayerStatsView({ my }: { my: MyStats }) {
  return (
    <div className="space-y-10 max-w-3xl mx-auto">
      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">Meine Statistiken</h2>
        {my.player ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatTile label="FACEIT-Level" value={my.player.skill_level ?? "–"} />
            <StatTile label="Elo" value={my.player.faceit_elo ?? "–"} />
            <StatTile label="Matches" value={my.player.matches ?? "–"} />
            <StatTile
              label="Win-Rate"
              value={my.player.win_rate_percent != null ? `${my.player.win_rate_percent}%` : "–"}
              accent="text-green-500"
            />
            <StatTile label="K/D" value={my.player.avg_kd_ratio ?? "–"} />
            <StatTile
              label="Headshot-%"
              value={my.player.avg_headshots_percent != null ? `${my.player.avg_headshots_percent}%` : "–"}
            />
          </div>
        ) : (
          <p className="text-gray-500 text-sm">
            Noch keine FACEIT-Statistiken hinterlegt. Sobald ein FACEIT-Profil mit deinem Spielerprofil verknüpft und
            synchronisiert wurde, erscheinen deine Werte hier.
          </p>
        )}
      </section>

      {my.player?.advanced && (
        <section className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-4">Erweiterte CS2-Stats</h2>
          <AdvancedStatsGrid advanced={my.player.advanced} />
        </section>
      )}

      {my.player && (
        <section className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-4">Letzte Matches</h2>
          <RecentMatchesTable matches={my.player.recent_matches} />
        </section>
      )}

      <section className="bg-gray-800 rounded-lg shadow-xl p-6">
        <h2 className="text-2xl font-bold text-white mb-4">
          {my.team ? `${my.team.team_name} · Team-Statistiken (Maps)` : "Team-Statistiken"}
        </h2>
        {my.team ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <StatTile label="Matches" value={my.team.matches_played} />
              <StatTile label="Sieg / Niederlage" value={`${my.team.wins} / ${my.team.losses}`} />
              <StatTile label="Win-Rate" value={`${my.team.win_rate_percent}%`} accent="text-green-500" />
            </div>
            <MapStatsList maps={my.team.maps} />
          </>
        ) : (
          <p className="text-gray-500 text-sm">Kein Team zugewiesen.</p>
        )}
      </section>
    </div>
  );
}

export default function StatsPage() {
  const data = useLoaderData() as LoaderData;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-10">Statistiken</h1>

        {data.scope === "admin" && <AdminStatsView teams={data.teams} players={data.players} />}
        {data.scope === "captain" && <CaptainStatsView team={data.team} />}
        {data.scope === "player" && <PlayerStatsView my={data.my} />}
      </div>
    </div>
  );
}
