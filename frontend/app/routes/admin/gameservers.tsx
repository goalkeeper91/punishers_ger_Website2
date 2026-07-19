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

interface ServerSlot {
  id: number;
  vps_id: number;
  label: string;
  kind: "pracc" | "util";
  docker_container_name: string;
  port: number;
  last_known_status: "unknown" | "creating" | "running" | "stopped" | "starting" | "stopping";
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

const SLOT_STATUS_LABELS: Record<ServerSlot["last_known_status"], string> = {
  unknown: "Unbekannt",
  creating: "Wird erstellt",
  running: "Läuft",
  stopped: "Gestoppt",
  starting: "Startet",
  stopping: "Stoppt",
};

const SLOT_STATUS_DOT_CLASS: Record<ServerSlot["last_known_status"], string> = {
  unknown: "bg-gray-500",
  creating: "bg-yellow-500",
  running: "bg-green-500",
  stopped: "bg-red-500",
  starting: "bg-yellow-500",
  stopping: "bg-yellow-500",
};

const KIND_LABELS: Record<ServerSlot["kind"], string> = {
  pracc: "Pracc",
  util: "Util",
};

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const [vpsResponse, slotsResponse] = await Promise.all([
    authFetch("/admin/gameservers/vps/"),
    authFetch("/admin/gameservers/slots/"),
  ]);
  for (const response of [vpsResponse, slotsResponse]) {
    if (!response.ok) {
      if (response.status === 401) throw redirect("/login");
      if (response.status === 403) throw redirect("/admin"); // logged in, just lacks gameservers.manage_gameservers
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }
  const vps: HetznerVPS | null = await vpsResponse.json();
  const slots: ServerSlot[] = await slotsResponse.json();
  return { vps, slots };
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

    if (intent === "createSlot") {
      const label = formData.get("label");
      const kind = formData.get("kind");
      const port = formData.get("port");
      const rconPassword = formData.get("rcon_password");
      if (typeof label !== "string" || !label.trim()) {
        return { errors: { label: "Bezeichnung erforderlich." } };
      }
      if (typeof port !== "string" || !port.trim()) {
        return { errors: { port: "Port erforderlich." } };
      }
      if (typeof rconPassword !== "string" || !rconPassword.trim()) {
        return { errors: { rcon_password: "RCON-Passwort erforderlich." } };
      }
      const response = await authFetch("/admin/gameservers/slots/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          kind,
          port: Number(port),
          rcon_password: rconPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Slot konnte nicht angelegt werden.") } };
      }
      return { success: "Slot angelegt." };
    }

    if (intent === "startSlot" || intent === "stopSlot") {
      const slotId = formData.get("slot_id");
      const response = await authFetch(`/admin/gameservers/slots/${slotId}/${intent === "startSlot" ? "start" : "stop"}/`, {
        method: "PUT",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: intent === "startSlot" ? "Starten angefordert." : "Stoppen angefordert." };
    }

    if (intent === "deleteSlot") {
      const slotId = formData.get("slot_id");
      const response = await authFetch(`/admin/gameservers/slots/${slotId}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Slot gelöscht." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin gameservers action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminGameserversPage() {
  const { vps: initialVps, slots: initialSlots } = useLoaderData() as { vps: HetznerVPS | null; slots: ServerSlot[] };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;

  // Live-ish status: power/start/stop changes are carried out asynchronously
  // by the separate gameserver-plattform service, so poll for the
  // authoritative status the same way admin/discord.tsx does for the bot's
  // online dot.
  const [vps, setVps] = useState<HetznerVPS | null>(initialVps);
  const [slots, setSlots] = useState<ServerSlot[]>(initialSlots);
  useEffect(() => {
    // Re-sync when the loader revalidates (e.g. right after the "configure"
    // action creates the VPS row) - local state only tracked the value from
    // the initial mount otherwise, so the newly-created VPS never appeared
    // without a manual reload.
    setVps(initialVps);
  }, [initialVps]);
  useEffect(() => {
    setSlots(initialSlots);
  }, [initialSlots]);
  useEffect(() => {
    if (!vps) return;
    const interval = setInterval(async () => {
      try {
        const [vpsResponse, slotsResponse] = await Promise.all([
          authFetch("/admin/gameservers/vps/"),
          authFetch("/admin/gameservers/slots/"),
        ]);
        if (vpsResponse.ok) setVps(await vpsResponse.json());
        if (slotsResponse.ok) setSlots(await slotsResponse.json());
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

        {vps && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 mt-8">
            <h3 className="text-xl font-bold text-white mb-4">Server-Slots</h3>
            <ul className="divide-y divide-gray-700 mb-6">
              {slots.map((slot) => (
                <li key={slot.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`inline-block h-3 w-3 rounded-full flex-shrink-0 ${SLOT_STATUS_DOT_CLASS[slot.last_known_status]}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-white font-medium break-words">
                        {slot.label} <span className="text-gray-400 text-sm">({KIND_LABELS[slot.kind]})</span>
                      </p>
                      <p className="text-gray-500 text-xs">
                        {SLOT_STATUS_LABELS[slot.last_known_status]} · Port {slot.port} · {slot.docker_container_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Form method="post">
                      <input type="hidden" name="_intent" value="startSlot" />
                      <input type="hidden" name="slot_id" value={slot.id} />
                      <button
                        type="submit"
                        disabled={slot.last_known_status === "running" || slot.last_known_status === "starting" || slot.last_known_status === "creating"}
                        className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Starten
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="_intent" value="stopSlot" />
                      <input type="hidden" name="slot_id" value={slot.id} />
                      <button
                        type="submit"
                        disabled={slot.last_known_status === "stopped" || slot.last_known_status === "stopping"}
                        className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Stoppen
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (!confirm(`Slot "${slot.label}" wirklich löschen?`)) event.preventDefault();
                      }}
                    >
                      <input type="hidden" name="_intent" value="deleteSlot" />
                      <input type="hidden" name="slot_id" value={slot.id} />
                      <button type="submit" className="py-1.5 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                        Löschen
                      </button>
                    </Form>
                  </div>
                </li>
              ))}
              {slots.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Server-Slots angelegt.</li>}
            </ul>

            <h4 className="text-lg font-bold text-white mb-4">Slot hinzufügen</h4>
            <Form method="post" className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <input type="hidden" name="_intent" value="createSlot" />
              <div>
                <label htmlFor="label" className="block text-sm font-medium text-gray-300 mb-1">
                  Bezeichnung <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="label"
                  name="label"
                  placeholder="Pracc-Server 1"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.label && <p className="mt-1 text-sm text-red-500">{actionData.errors.label}</p>}
              </div>
              <div>
                <label htmlFor="kind" className="block text-sm font-medium text-gray-300 mb-1">Art</label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue="pracc"
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                >
                  <option value="pracc">Pracc</option>
                  <option value="util">Util</option>
                </select>
              </div>
              <div>
                <label htmlFor="port" className="block text-sm font-medium text-gray-300 mb-1">
                  Port <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  id="port"
                  name="port"
                  placeholder="27015"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.port && <p className="mt-1 text-sm text-red-500">{actionData.errors.port}</p>}
              </div>
              <div>
                <label htmlFor="rcon_password" className="block text-sm font-medium text-gray-300 mb-1">
                  RCON-Passwort <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  id="rcon_password"
                  name="rcon_password"
                  required
                  className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                />
                {actionData?.errors?.rcon_password && <p className="mt-1 text-sm text-red-500">{actionData.errors.rcon_password}</p>}
              </div>
              <div className="sm:col-span-4">
                <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                  Slot anlegen
                </button>
              </div>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
