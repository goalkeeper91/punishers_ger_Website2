import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface Pracc {
  id: number;
  slot_id: number;
  slot_label: string;
  own_team_id: number;
  own_team_name: string;
  opponent_team_name: string;
  scheduled_at: string;
  status: "scheduled" | "live" | "finished" | "cancelled";
  created_by_username: string | null;
  demo_url: string | null;
  match_ended_at: string | null;
  created_at: string;
}

interface ServerSlot {
  id: number;
  label: string;
  kind: "pracc" | "util";
}

interface TeamOption {
  id: number;
  name: string;
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

// scheduled_at is stored/returned as a raw wall-clock value (see
// fastapi_app/main.py's create_pracc(), which treats a <input
// type="datetime-local"> value as UTC directly rather than converting from
// the browser's own timezone) - rendered here the same way, never through
// `new Date()`, which would silently reinterpret and shift it.
function formatWallClock(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const [meResponse, praccsResponse, slotsResponse] = await Promise.all([
    authFetch("/users/me/"),
    authFetch("/admin/gameservers/praccs/"),
    authFetch("/admin/gameservers/slots/"),
  ]);
  for (const response of [meResponse, praccsResponse, slotsResponse]) {
    if (!response.ok) {
      if (response.status === 401) throw redirect("/login");
      if (response.status === 403) throw redirect("/admin"); // logged in, just lacks Pracc access
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }
  const me: AuthUser = await meResponse.json();
  const praccs: Pracc[] = await praccsResponse.json();
  const slots: ServerSlot[] = await slotsResponse.json();

  let teams: TeamOption[] = [];
  if (me.is_superuser || me.permissions.includes("gameservers.manage_gameservers")) {
    const teamsResponse = await fetch(`${API_BASE_URL}/teams/`);
    if (teamsResponse.ok) {
      teams = await teamsResponse.json();
    }
  }

  return { me, praccs, slots, teams };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "create") {
      const slotId = formData.get("slot_id");
      const ownTeamId = formData.get("own_team_id");
      const opponentTeamName = formData.get("opponent_team_name");
      const scheduledAt = formData.get("scheduled_at");
      if (typeof slotId !== "string" || !slotId) {
        return { errors: { slot_id: "Slot erforderlich." } };
      }
      if (typeof opponentTeamName !== "string" || !opponentTeamName.trim()) {
        return { errors: { opponent_team_name: "Gegner-Team erforderlich." } };
      }
      if (typeof scheduledAt !== "string" || !scheduledAt) {
        return { errors: { scheduled_at: "Datum/Uhrzeit erforderlich." } };
      }
      const response = await authFetch("/admin/gameservers/praccs/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: Number(slotId),
          own_team_id: Number(ownTeamId),
          opponent_team_name: opponentTeamName.trim(),
          scheduled_at: scheduledAt,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Pracc konnte nicht angelegt werden.") } };
      }
      return { success: "Pracc angelegt." };
    }

    if (intent === "updateStatus") {
      const praccId = formData.get("pracc_id");
      const newStatus = formData.get("status");
      const response = await authFetch(`/admin/gameservers/praccs/${praccId}/status/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Status aktualisiert." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin praccs action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminPraccsPage() {
  const { me, praccs, slots, teams } = useLoaderData() as {
    me: AuthUser;
    praccs: Pracc[];
    slots: ServerSlot[];
    teams: TeamOption[];
  };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;

  const isFullAccess = me.is_superuser || me.permissions.includes("gameservers.manage_gameservers");
  const praccSlots = slots.filter((slot) => slot.kind === "pracc");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="praccs" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.errors?.general && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <h2 className="text-2xl font-bold text-white mb-6">Praccs</h2>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
          <ul className="divide-y divide-gray-700">
            {praccs.map((pracc) => (
              <li key={pracc.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium break-words">
                    {pracc.own_team_name} vs. {pracc.opponent_team_name}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {formatWallClock(pracc.scheduled_at)} UTC · {pracc.slot_label}
                    {pracc.created_by_username && ` · von ${pracc.created_by_username}`}
                  </p>
                  {pracc.demo_url && (
                    <a href={pracc.demo_url} target="_blank" rel="noreferrer" className="text-xs text-red-400 hover:text-red-300 underline">
                      Demo herunterladen
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${STATUS_BADGE_CLASS[pracc.status]}`}>
                    {STATUS_LABELS[pracc.status]}
                  </span>
                  {pracc.status === "scheduled" && (
                    <>
                      <Form method="post">
                        <input type="hidden" name="_intent" value="updateStatus" />
                        <input type="hidden" name="pracc_id" value={pracc.id} />
                        <input type="hidden" name="status" value="live" />
                        <button type="submit" className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-green-600 hover:bg-green-700">
                          Starten
                        </button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="_intent" value="updateStatus" />
                        <input type="hidden" name="pracc_id" value={pracc.id} />
                        <input type="hidden" name="status" value="cancelled" />
                        <button type="submit" className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                          Absagen
                        </button>
                      </Form>
                    </>
                  )}
                  {pracc.status === "live" && (
                    <Form method="post">
                      <input type="hidden" name="_intent" value="updateStatus" />
                      <input type="hidden" name="pracc_id" value={pracc.id} />
                      <input type="hidden" name="status" value="finished" />
                      <button type="submit" className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">
                        Beenden
                      </button>
                    </Form>
                  )}
                </div>
              </li>
            ))}
            {praccs.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Praccs geplant.</li>}
          </ul>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h3 className="text-xl font-bold text-white mb-4">Pracc anlegen</h3>
          {praccSlots.length === 0 ? (
            <p className="text-sm text-gray-400">Kein Pracc-Server-Slot verfügbar - ein Admin muss zuerst einen anlegen.</p>
          ) : (
            <Form method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <input type="hidden" name="_intent" value="create" />
              {isFullAccess ? (
                <div>
                  <label htmlFor="own_team_id" className="block text-sm font-medium text-gray-300 mb-1">
                    Eigenes Team <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="own_team_id"
                    name="own_team_id"
                    required
                    className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="own_team_id" value={me.team_id ?? ""} />
              )}
              <div>
                <label htmlFor="slot_id" className="block text-sm font-medium text-gray-300 mb-1">
                  Server-Slot <span className="text-red-500">*</span>
                </label>
                <select
                  id="slot_id"
                  name="slot_id"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                >
                  {praccSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
                </select>
                {actionData?.errors?.slot_id && <p className="mt-1 text-sm text-red-500">{actionData.errors.slot_id}</p>}
              </div>
              <div>
                <label htmlFor="opponent_team_name" className="block text-sm font-medium text-gray-300 mb-1">
                  Gegner-Team <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="opponent_team_name"
                  name="opponent_team_name"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.opponent_team_name && <p className="mt-1 text-sm text-red-500">{actionData.errors.opponent_team_name}</p>}
              </div>
              <div>
                <label htmlFor="scheduled_at" className="block text-sm font-medium text-gray-300 mb-1">
                  Datum/Uhrzeit (UTC) <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  id="scheduled_at"
                  name="scheduled_at"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.scheduled_at && <p className="mt-1 text-sm text-red-500">{actionData.errors.scheduled_at}</p>}
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                  Pracc anlegen
                </button>
              </div>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
