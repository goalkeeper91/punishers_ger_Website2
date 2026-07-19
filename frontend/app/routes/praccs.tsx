import { useState } from "react";
import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { downloadAuthenticatedFile } from "~/lib/download";

interface Pracc {
  id: number;
  slot_label: string;
  own_team_name: string;
  opponent_team_name: string;
  scheduled_at: string;
  status: "scheduled" | "live" | "finished" | "cancelled";
  demo_available: boolean;
  demo_expires_at: string | null;
}

const STATUS_LABELS: Record<Pracc["status"], string> = {
  scheduled: "Geplant",
  live: "Live",
  finished: "Beendet",
  cancelled: "Abgesagt",
};

const STATUS_BADGE_CLASS: Record<Pracc["status"], string> = {
  scheduled: "bg-blue-100 text-blue-800",
  live: "bg-green-100 text-green-800",
  finished: "bg-gray-200 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

// scheduled_at/demo_expires_at are raw wall-clock values (see
// backend fastapi_app/main.py's create_pracc()) - rendered as-is, never
// through `new Date()`, which would reinterpret and shift them.
function formatWallClock(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

// Self-service surface for any registered player to see their own team's
// Praccs and grab a finished match's demo - separate from /admin/praccs,
// which stays limited to Teammanagers/admins for scheduling & management.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const response = await authFetch("/gameservers/praccs/team/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 403) throw redirect("/profile"); // logged in, just not on a team
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const praccs: Pracc[] = await response.json();
  return { praccs };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export default function TeamPraccsPage() {
  const { praccs } = useLoaderData() as { praccs: Pracc[] };
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadDemo = async (pracc: Pracc) => {
    setDownloadError(null);
    try {
      await downloadAuthenticatedFile(`/gameservers/praccs/${pracc.id}/demo/`, `pracc_${pracc.id}.dem`);
    } catch (error: any) {
      setDownloadError(error.message || "Demo konnte nicht heruntergeladen werden.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-10">Meine Praccs</h1>

        {downloadError && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{downloadError}</div>}

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <ul className="divide-y divide-gray-700">
            {praccs.map((pracc) => (
              <li key={pracc.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium break-words">
                    {pracc.own_team_name} vs. {pracc.opponent_team_name}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {formatWallClock(pracc.scheduled_at)} UTC · {pracc.slot_label}
                  </p>
                  {pracc.demo_available && (
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => handleDownloadDemo(pracc)}
                        className="text-xs text-red-400 hover:text-red-300 underline"
                      >
                        Demo herunterladen
                      </button>
                      {pracc.demo_expires_at && (
                        <span className="text-xs text-gray-500">(verfügbar bis {formatWallClock(pracc.demo_expires_at)} UTC)</span>
                      )}
                    </div>
                  )}
                </div>
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full flex-shrink-0 ${STATUS_BADGE_CLASS[pracc.status]}`}>
                  {STATUS_LABELS[pracc.status]}
                </span>
              </li>
            ))}
            {praccs.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Praccs für dein Team geplant.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
