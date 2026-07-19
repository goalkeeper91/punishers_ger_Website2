import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";

interface UtilSession {
  slot_id: number;
  label: string;
  status: "unknown" | "creating" | "running" | "stopped" | "starting" | "stopping";
  last_synced_at: string | null;
}

const STATUS_LABELS: Record<UtilSession["status"], string> = {
  unknown: "Unbekannt",
  creating: "Wird erstellt",
  running: "Läuft",
  stopped: "Gestoppt",
  starting: "Startet",
  stopping: "Stoppt",
};

const STATUS_DOT_CLASS: Record<UtilSession["status"], string> = {
  unknown: "bg-gray-500",
  creating: "bg-yellow-500",
  running: "bg-green-500",
  stopped: "bg-red-500",
  starting: "bg-yellow-500",
  stopping: "bg-yellow-500",
};

// Self-service surface for any registered player (player_profile-gated on
// the backend, see fastapi_app/main.py's _get_player_or_404()) to start/stop
// the shared util-practice server themselves - unlike Praccs, no scheduling
// or Teammanager approval involved.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const response = await authFetch("/gameservers/util-session/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 404) throw redirect("/profile"); // logged in, just no player profile
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const session: UtilSession | null = await response.json();
  return { session };
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
    const response = await authFetch(`/gameservers/util-session/${intent === "start" ? "start" : "stop"}/`, {
      method: "POST",
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
    }
    return { success: intent === "start" ? "Einschalten angefordert." : "Ausschalten angefordert." };
  } catch (error: any) {
    console.error("Util-training action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function UtilTrainingPage() {
  const { session } = useLoaderData() as { session: UtilSession | null };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-2xl">
        <h1 className="text-4xl font-bold text-white text-center mb-10">Util-Training</h1>

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        {!session ? (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 text-center text-gray-400">
            Kein Util-Server konfiguriert - ein Admin muss zuerst einen anlegen.
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <span className={`inline-block h-3 w-3 rounded-full ${STATUS_DOT_CLASS[session.status]}`} aria-hidden="true" />
              <div>
                <p className="text-white font-semibold">{session.label}</p>
                <p className="text-sm text-gray-400">{STATUS_LABELS[session.status]}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Form method="post">
                <input type="hidden" name="_intent" value="start" />
                <button
                  type="submit"
                  disabled={session.status === "running" || session.status === "starting" || session.status === "creating"}
                  className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Util-Server starten
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_intent" value="stop" />
                <button
                  type="submit"
                  disabled={session.status === "stopped" || session.status === "stopping"}
                  className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Util-Server stoppen
                </button>
              </Form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
