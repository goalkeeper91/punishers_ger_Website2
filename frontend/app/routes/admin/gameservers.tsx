import { useEffect, useState } from "react";
import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface HetznerVPS {
  id: number;
  hetzner_server_id: string;
  name: string;
  ip_address: string | null;
  last_known_status: "unknown" | "running" | "off" | "starting" | "stopping";
  last_synced_at: string | null;
}

const STATUS_LABELS: Record<HetznerVPS["last_known_status"], string> = {
  unknown: "Unbekannt",
  running: "Läuft",
  off: "Ausgeschaltet",
  starting: "Startet",
  stopping: "Fährt herunter",
};

const STATUS_DOT_CLASS: Record<HetznerVPS["last_known_status"], string> = {
  unknown: "bg-gray-500",
  running: "bg-green-500",
  off: "bg-red-500",
  starting: "bg-yellow-500",
  stopping: "bg-yellow-500",
};

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const response = await authFetch("/admin/gameservers/vps/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 403) throw redirect("/admin"); // logged in, just lacks gameservers.manage_gameservers
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const vps: HetznerVPS | null = await response.json();
  return { vps };
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
    if (intent === "configure") {
      const hetznerServerId = formData.get("hetzner_server_id");
      const name = formData.get("name");
      const ipAddress = formData.get("ip_address");
      if (typeof hetznerServerId !== "string" || !hetznerServerId.trim()) {
        return { errors: { hetzner_server_id: "Hetzner-Server-ID erforderlich." } };
      }
      if (typeof name !== "string" || !name.trim()) {
        return { errors: { name: "Name erforderlich." } };
      }
      const response = await authFetch("/admin/gameservers/vps/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hetzner_server_id: hetznerServerId.trim(),
          name: name.trim(),
          ip_address: (typeof ipAddress === "string" && ipAddress.trim()) || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "VPS konnte nicht angelegt werden.") } };
      }
      return { success: "VPS konfiguriert." };
    }

    if (intent === "power") {
      const powerOn = formData.get("power_on") === "true";
      const response = await authFetch("/admin/gameservers/vps/power/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ power_on: powerOn }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: powerOn ? "Einschalten angefordert." : "Ausschalten angefordert." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin gameservers action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminGameserversPage() {
  const { vps: initialVps } = useLoaderData() as { vps: HetznerVPS | null };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;

  // Live-ish status: power changes are carried out asynchronously by the
  // separate gameserver-plattform service, so poll for the authoritative
  // status the same way admin/discord.tsx does for the bot's online dot.
  const [vps, setVps] = useState<HetznerVPS | null>(initialVps);
  useEffect(() => {
    // Re-sync when the loader revalidates (e.g. right after the "configure"
    // action creates the VPS row) - local state only tracked the value from
    // the initial mount otherwise, so the newly-created VPS never appeared
    // without a manual reload.
    setVps(initialVps);
  }, [initialVps]);
  useEffect(() => {
    if (!vps) return;
    const interval = setInterval(async () => {
      try {
        const response = await authFetch("/admin/gameservers/vps/");
        if (response.ok) {
          setVps(await response.json());
        }
      } catch {
        // Silently keep the last known status - a transient poll failure
        // shouldn't flip the indicator to a misleading state.
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [vps === null]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="gameservers" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.errors?.general && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <h2 className="text-2xl font-bold text-white mb-6">CS2-Gameserver</h2>

        {!vps ? (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6">
            <h3 className="text-xl font-bold text-white mb-2">VPS einrichten</h3>
            <p className="text-sm text-gray-400 mb-4">
              Noch kein Hetzner-VPS konfiguriert. Die eigentliche Steuerung (An/Aus, CS2-Server) läuft über einen
              separaten Dienst - hier wird nur hinterlegt, welcher VPS gemeint ist.
            </p>
            <Form method="post" className="grid gap-4 sm:grid-cols-3 items-end">
              <input type="hidden" name="_intent" value="configure" />
              <div>
                <label htmlFor="hetzner_server_id" className="block text-sm font-medium text-gray-300 mb-1">
                  Hetzner-Server-ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="hetzner_server_id"
                  name="hetzner_server_id"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.hetzner_server_id && <p className="mt-1 text-sm text-red-500">{actionData.errors.hetzner_server_id}</p>}
              </div>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  placeholder="CS2 Pracc-Server"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.name && <p className="mt-1 text-sm text-red-500">{actionData.errors.name}</p>}
              </div>
              <div>
                <label htmlFor="ip_address" className="block text-sm font-medium text-gray-300 mb-1">IP-Adresse</label>
                <input
                  type="text"
                  id="ip_address"
                  name="ip_address"
                  placeholder="optional"
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
              </div>
              <div className="sm:col-span-3">
                <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                  VPS anlegen
                </button>
              </div>
            </Form>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <span className={`inline-block h-3 w-3 rounded-full ${STATUS_DOT_CLASS[vps.last_known_status]}`} aria-hidden="true" />
              <div>
                <p className="text-white font-semibold">{vps.name}</p>
                <p className="text-sm text-gray-400">
                  {STATUS_LABELS[vps.last_known_status]}
                  {vps.ip_address ? ` · ${vps.ip_address}` : ""}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Form method="post">
                <input type="hidden" name="_intent" value="power" />
                <input type="hidden" name="power_on" value="true" />
                <button
                  type="submit"
                  disabled={vps.last_known_status === "running" || vps.last_known_status === "starting"}
                  className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Einschalten
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_intent" value="power" />
                <input type="hidden" name="power_on" value="false" />
                <button
                  type="submit"
                  disabled={vps.last_known_status === "off" || vps.last_known_status === "stopping"}
                  className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Ausschalten
                </button>
              </Form>
            </div>

            <p className="text-xs text-gray-500 mt-4">
              Hinweis: Hetzner berechnet den Server unabhängig vom Ein-/Aus-Status - das Ausschalten spart primär
              Kontrolle/Sicherheit, nicht direkt die Rechnung.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
