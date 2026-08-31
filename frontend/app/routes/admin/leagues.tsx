import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface League {
  id: number;
  name: string;
  short_name: string | null;
  faceit_organizer_id: string | null;
  description: string | null;
  website_url: string | null;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const response = await authFetch("/admin/leagues/");
  if (!response.ok) {
    if (response.status === 401) throw redirect("/login");
    if (response.status === 403) throw redirect("/admin");
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const leagues: League[] = await response.json();
  return { leagues };
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
    switch (intent) {
      case "createLeague": {
        const response = await authFetch("/admin/leagues/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            short_name: formData.get("short_name") || null,
            faceit_organizer_id: formData.get("faceit_organizer_id") || null,
            website_url: formData.get("website_url") || null,
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Liga konnte nicht erstellt werden.") };
        return { success: "Liga erstellt." };
      }
      case "updateLeague": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/leagues/${id}/`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            short_name: formData.get("short_name") || null,
            faceit_organizer_id: formData.get("faceit_organizer_id") || null,
            website_url: formData.get("website_url") || null,
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Liga konnte nicht gespeichert werden.") };
        return { success: "Liga gespeichert." };
      }
      case "deleteLeague": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/leagues/${id}/`, { method: "DELETE" });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
        }
        return { success: "Liga gelöscht." };
      }
      default:
        return { error: "Unbekannte Aktion." };
    }
  } catch (error: any) {
    console.error("Leagues action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminLeaguesPage() {
  const { leagues } = useLoaderData() as { leagues: League[] };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const inputClass = "px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="leagues" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-2">Ligen</h2>
          <p className="text-sm text-gray-400 mb-6">
            Die <strong>FACEIT-Organizer-ID</strong> steuert den automatischen Match-Abgleich (ablesbar aus der Organizer-URL: faceit.com/de/organizers/&lt;ID&gt;/&lt;Name&gt;).
            Fehlt sie, wird die Liga beim Sync stillschweigend übersprungen - kein Fehler, einfach keine Matches. Die passende <strong>FACEIT-Team-ID</strong> je Team wird auf der jeweiligen Team-Bearbeiten-Seite hinterlegt.
          </p>

          <div className="overflow-x-auto mb-6">
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Kurzname</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">FACEIT-Organizer-ID</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Website</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-300 uppercase">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {leagues.map((league) => (
                  <tr key={league.id}>
                    <td colSpan={4} className="px-3 py-3">
                      <Form method="post" className="flex flex-wrap gap-2 items-center">
                        <input type="hidden" name="_intent" value="updateLeague" />
                        <input type="hidden" name="id" value={league.id} />
                        <input name="name" defaultValue={league.name} required className={inputClass + " w-36"} />
                        <input name="short_name" defaultValue={league.short_name || ""} placeholder="Kurzname" className={inputClass + " w-24"} />
                        <input name="faceit_organizer_id" defaultValue={league.faceit_organizer_id || ""} placeholder="Organizer-ID" className={inputClass + " w-48"} />
                        <input name="website_url" defaultValue={league.website_url || ""} placeholder="https://..." className={inputClass + " w-40"} />
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Speichern</button>
                      </Form>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (!confirm(`Liga "${league.name}" wirklich löschen? Das entfernt auch alle Team-Registrierungen und deren Matches in dieser Liga (inkl. manuell erfasster).`)) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="_intent" value="deleteLeague" />
                        <input type="hidden" name="id" value={league.id} />
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">Löschen</button>
                      </Form>
                    </td>
                  </tr>
                ))}
                {leagues.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">Noch keine Liga angelegt.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-bold text-white mb-3">Neue Liga</h3>
          <Form method="post" className="flex flex-wrap gap-2 items-end">
            <input type="hidden" name="_intent" value="createLeague" />
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name <span className="text-red-500">*</span></label>
              <input name="name" required placeholder="z.B. DACH CS" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Kurzname</label>
              <input name="short_name" className={inputClass + " w-24"} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">FACEIT-Organizer-ID</label>
              <input name="faceit_organizer_id" className={inputClass + " w-48"} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Website</label>
              <input name="website_url" placeholder="https://..." className={inputClass + " w-40"} />
            </div>
            <button type="submit" className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700">+ Hinzufügen</button>
          </Form>
        </div>
      </div>
    </div>
  );
}
