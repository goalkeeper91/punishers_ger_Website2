import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface PlayerApplication {
  id: number;
  ingame_name: string;
  game: string;
  rank: string;
  full_name: string | null;
  email: string;
  discord_tag: string | null;
  age: number | null;
  message: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_username: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Offen",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const response = await authFetch("/admin/applications/players/");
    if (!response.ok) {
      if (response.status === 401) {
        throw redirect("/login");
      }
      if (response.status === 403) {
        throw redirect("/admin"); // logged in, just lacks applications access
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const applications: PlayerApplication[] = await response.json();
    return { applications };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch player applications:", error);
    return { applications: [], error: "Bewerbungen konnten nicht geladen werden." };
  }
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
  const intent = formData.get("intent");
  const id = formData.get("id");

  if (typeof id !== "string") {
    return { error: "Invalid form submission." };
  }

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "update-status") {
      const newStatus = formData.get("newStatus");
      const response = await authFetch(`/admin/applications/players/${id}/status/`, {
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

    if (intent === "delete") {
      const response = await authFetch(`/admin/applications/players/${id}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Bewerbung gelöscht." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin applications action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminApplicationsPage() {
  const { applications, error: loaderError } = useLoaderData() as { applications: PlayerApplication[]; error?: string };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
    return new Date(dateString).toLocaleDateString("de-DE", options);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="applications" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        <h2 className="text-2xl font-bold text-white mb-6">Spieler-Bewerbungen</h2>

        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Ingame-Name</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Spiel</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Rang</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Kontakt</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Alter</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Nachricht</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Eingegangen</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {applications.map((application) => (
                <tr key={application.id} className="hover:bg-gray-700 align-top">
                  <td className="px-4 py-4 text-sm font-medium text-gray-200 whitespace-nowrap">
                    {application.ingame_name}
                    {application.full_name && <div className="text-xs text-gray-400">{application.full_name}</div>}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{application.game}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{application.rank}</td>
                  <td className="px-4 py-4 text-sm text-gray-200">
                    <a href={`mailto:${application.email}`} className="text-white hover:text-red-600 underline">{application.email}</a>
                    {application.discord_tag && <div className="text-xs text-gray-400">Discord: {application.discord_tag}</div>}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{application.age ?? "-"}</td>
                  <td className="px-4 py-4 text-sm text-gray-300 max-w-xs">{application.message || "-"}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{formatDate(application.created_at)}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${STATUS_BADGE_CLASS[application.status] || "bg-gray-100 text-gray-800"}`}>
                      {STATUS_LABELS[application.status] || application.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium space-y-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="update-status" />
                      <input type="hidden" name="id" value={application.id} />
                      <select
                        name="newStatus"
                        defaultValue={application.status}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        className="block w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-xs focus:outline-none focus:ring-red-500 focus:border-red-500"
                      >
                        <option value="pending">Offen</option>
                        <option value="accepted">Angenommen</option>
                        <option value="rejected">Abgelehnt</option>
                      </select>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (!confirm(`Bewerbung von "${application.ingame_name}" wirklich löschen?`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={application.id} />
                      <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700 w-full">
                        Löschen
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-400">
                    Noch keine Bewerbungen vorhanden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
