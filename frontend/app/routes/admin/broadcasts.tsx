import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface BroadcastInfo {
  caster_input: string;
  caster_url: string;
  caster_login: string;
  is_live: boolean;
  live_checked_at: string | null;
}

interface UpcomingMatch {
  faceit_match_id: string;
  team_id: number;
  team_name: string;
  opponent_name: string | null;
  competition_name: string | null;
  scheduled_at: string | null;
  status: string;
  map_name: string | null;
  broadcast: BroadcastInfo | null;
}

// scheduled_at / live_checked_at come back as ISO strings in UTC - rendered
// as a raw wall-clock value (never through `new Date()`, which would shift
// them into the viewer's local zone and, during SSR, cause a hydration
// mismatch). Same approach as routes/admin/praccs.tsx.
function formatWallClock(iso: string | null): string {
  if (!iso) return "Termin offen";
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const [meResponse, matchesResponse] = await Promise.all([
    authFetch("/users/me/"),
    authFetch("/admin/matches/upcoming/"),
  ]);
  for (const response of [meResponse, matchesResponse]) {
    if (!response.ok) {
      if (response.status === 401) throw redirect("/login");
      if (response.status === 403) throw redirect("/admin"); // logged in, just lacks caster access
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }
  const me: AuthUser = await meResponse.json();
  const matches: UpcomingMatch[] = await matchesResponse.json();
  return { me, matches };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  if (!isLoggedIn()) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const matchId = formData.get("faceit_match_id");
  const casterInput = formData.get("caster_input");
  if (typeof matchId !== "string" || !matchId) {
    return { error: "Match-ID fehlt." };
  }

  try {
    const response = await authFetch(`/admin/matches/${encodeURIComponent(matchId)}/broadcast/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caster_input: typeof casterInput === "string" ? casterInput : "" }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { error: extractErrorMessage(data, "Caster konnte nicht gespeichert werden.") };
    }
    return { success: "Caster gespeichert." };
  } catch (error: any) {
    console.error("Admin broadcasts action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminBroadcastsPage() {
  const { matches } = useLoaderData() as { me: AuthUser; matches: UpcomingMatch[] };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="broadcasts" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <h2 className="text-2xl font-bold text-white mb-2">Match-Caster</h2>
        <p className="text-gray-400 text-sm mb-6">
          Trage pro anstehendem Match den Twitch-Namen oder den vollständigen Stream-Link des Casters ein. Nur
          der Name genügt &ndash; der Twitch-Link wird automatisch gebaut. Ab 15&nbsp;Minuten vor Matchbeginn
          bis 15&nbsp;Minuten nach Matchende prüft das System automatisch, ob der Stream live ist, und blendet
          dann auf der Website ein Live-Popup ein.
        </p>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <ul className="divide-y divide-gray-700">
            {matches.map((match) => (
              <li key={match.faceit_match_id} className="py-4">
                <p className="text-white font-medium break-words">
                  {match.team_name} vs. {match.opponent_name ?? "TBD"}
                </p>
                <p className="text-gray-500 text-xs">
                  {formatWallClock(match.scheduled_at)}
                  {match.competition_name && ` · ${match.competition_name}`}
                  {match.map_name && ` · ${match.map_name}`}
                  {` · ${match.status}`}
                </p>

                <Form method="post" className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input type="hidden" name="faceit_match_id" value={match.faceit_match_id} />
                  <input
                    type="text"
                    name="caster_input"
                    defaultValue={match.broadcast?.caster_input ?? ""}
                    placeholder="Twitch-Name oder voller Link"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                  <button
                    type="submit"
                    className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700"
                  >
                    Speichern
                  </button>
                </Form>

                {match.broadcast?.caster_login ? (
                  <p className="text-gray-500 text-xs mt-1.5">
                    Erkannter Kanal: <span className="font-mono text-gray-400">{match.broadcast.caster_login}</span>
                    {" · "}
                    {match.broadcast.is_live ? (
                      <span className="text-red-400 font-semibold">aktuell LIVE</span>
                    ) : (
                      <span>
                        derzeit offline
                        {match.broadcast.live_checked_at ? ` (geprüft ${formatWallClock(match.broadcast.live_checked_at)})` : ""}
                      </span>
                    )}
                  </p>
                ) : match.broadcast?.caster_url ? (
                  <p className="text-gray-500 text-xs mt-1.5">
                    Kein Twitch-Kanal erkannt &ndash; der Link wird nur als &bdquo;Zum Stream&ldquo; verwendet, kein
                    eingebetteter Player und kein automatischer Live-Check.
                  </p>
                ) : null}
              </li>
            ))}
            {matches.length === 0 && <li className="py-3 text-sm text-gray-400">Kein anstehendes Match gefunden.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
