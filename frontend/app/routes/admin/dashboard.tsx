import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import AdminNav from "~/components/AdminNav";

interface ClickStat {
  id: number;
  label: string;
  click_count: number;
}

interface DashboardStats {
  role: "admin" | "team_manager" | "author";
  total_users?: number | null;
  active_users?: number | null;
  pending_users?: number | null;
  total_teams?: number | null;
  total_players?: number | null;
  total_news?: number | null;
  published_news?: number | null;
  draft_news?: number | null;
  total_sponsors?: number | null;
  total_social_links?: number | null;
  sponsor_clicks?: ClickStat[] | null;
  social_clicks?: ClickStat[] | null;
  my_team_name?: string | null;
  my_team_player_count?: number | null;
  my_news_count?: number | null;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const response = await authFetch("/admin/dashboard/");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw redirect("/login");
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const stats: DashboardStats = await response.json();
  return { stats };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
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

function ClickList({ title, stats, emptyLabel }: { title: string; stats: ClickStat[]; emptyLabel: string }) {
  const max = Math.max(1, ...stats.map((s) => s.click_count));
  return (
    <div className="bg-gray-800 rounded-lg shadow-xl p-6">
      <h3 className="text-xl font-bold text-white mb-4">{title}</h3>
      {stats.length === 0 ? (
        <p className="text-gray-500 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="space-y-3">
          {stats.map((stat) => (
            <li key={stat.id}>
              <div className="flex justify-between text-sm text-gray-300 mb-1">
                <span>{stat.label}</span>
                <span className="font-semibold">{stat.click_count}</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-600"
                  style={{ width: `${(stat.click_count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdminDashboard({ stats }: { stats: DashboardStats }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        <StatTile label="Nutzer gesamt" value={stats.total_users ?? 0} />
        <StatTile label="Aktive Nutzer" value={stats.active_users ?? 0} accent="text-green-500" />
        <StatTile
          label="Wartet auf Freischaltung"
          value={stats.pending_users ?? 0}
          accent={(stats.pending_users ?? 0) > 0 ? "text-yellow-500" : "text-white"}
        />
        <StatTile label="Teams" value={stats.total_teams ?? 0} />
        <StatTile label="Spieler" value={stats.total_players ?? 0} />
        <StatTile label="News (veröffentlicht)" value={stats.published_news ?? 0} accent="text-green-500" />
        <StatTile label="News (Entwürfe)" value={stats.draft_news ?? 0} />
        <StatTile label="Sponsoren / Socials" value={`${stats.total_sponsors ?? 0} / ${stats.total_social_links ?? 0}`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ClickList title="Meistgeklickte Sponsoren" stats={stats.sponsor_clicks ?? []} emptyLabel="Noch keine Sponsoren-Klicks." />
        <ClickList title="Meistgeklickte Social Links" stats={stats.social_clicks ?? []} emptyLabel="Noch keine Social-Klicks." />
      </div>
    </>
  );
}

function TeamManagerDashboard({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
      <StatTile label="Mein Team" value={stats.my_team_name ?? "Kein Team zugewiesen"} />
      <StatTile label="Spieler im Roster" value={stats.my_team_player_count ?? 0} />
    </div>
  );
}

function AuthorDashboard({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
      <StatTile label="News gesamt" value={stats.total_news ?? 0} />
      <StatTile label="Veröffentlicht" value={stats.published_news ?? 0} accent="text-green-500" />
      <StatTile label="Davon von mir verfasst" value={stats.my_news_count ?? 0} />
    </div>
  );
}

export default function AdminDashboardPage() {
  const { stats } = useLoaderData() as { stats: DashboardStats };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="dashboard" />

        {stats.role === "admin" && <AdminDashboard stats={stats} />}
        {stats.role === "team_manager" && <TeamManagerDashboard stats={stats} />}
        {stats.role === "author" && <AuthorDashboard stats={stats} />}
      </div>
    </div>
  );
}
