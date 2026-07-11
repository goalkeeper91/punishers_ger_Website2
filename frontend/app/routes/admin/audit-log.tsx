import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import AdminNav from "~/components/AdminNav";

interface AuditLogEntry {
  id: number;
  actor_username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// Superuser-only oversight tool - not delegable, so this is checked
// client-side (like teams.new.tsx does for team creation) in addition to
// the backend's own get_current_admin_user gate.
export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const meResponse = await authFetch("/users/me/");
  if (meResponse.ok) {
    const me: AuthUser = await meResponse.json();
    if (!me.is_superuser) {
      throw redirect("/admin");
    }
  }

  const response = await authFetch("/admin/audit-log/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 403) throw redirect("/admin");
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const entries: AuditLogEntry[] = await response.json();
  return { entries };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  create: "Erstellt",
  update: "Geändert",
  delete: "Gelöscht",
  activate: "Aktiviert",
  deactivate: "Deaktiviert",
  role_assign: "Rollen zugewiesen",
  permission_assign: "Berechtigungen geändert",
  superuser_grant: "Admin-Rechte gewährt",
  superuser_revoke: "Admin-Rechte entzogen",
  trigger: "Manuell ausgelöst",
};

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return "–";
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

export default function AuditLogPage() {
  const { entries } = useLoaderData() as { entries: AuditLogEntry[] };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="audit-log" />

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-xl font-bold text-white mb-1">Audit-Log</h2>
          <p className="text-sm text-gray-400 mb-6">
            Wer hat wann was geändert - die letzten {entries.length} Aktionen, neueste zuerst.
          </p>
          {entries.length === 0 ? (
            <p className="text-gray-500 text-sm">Noch keine protokollierten Aktionen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-gray-400 uppercase text-xs border-b border-gray-700">
                    <th className="py-2 pr-4">Zeitpunkt</th>
                    <th className="py-2 pr-4">Wer</th>
                    <th className="py-2 pr-4">Aktion</th>
                    <th className="py-2 pr-4">Ressource</th>
                    <th className="py-2 pr-4">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-gray-800 text-gray-300 align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{new Date(entry.created_at).toLocaleString("de-DE")}</td>
                      <td className="py-2 pr-4 font-semibold text-white">{entry.actor_username ?? "System"}</td>
                      <td className="py-2 pr-4">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                      <td className="py-2 pr-4">
                        {entry.resource_type}
                        {entry.resource_label ? ` "${entry.resource_label}"` : entry.resource_id ? ` #${entry.resource_id}` : ""}
                      </td>
                      <td className="py-2 pr-4 text-gray-400">{formatDetails(entry.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
