import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface Team {
  id: number;
  name: string;
  game: string;
  is_main_team: boolean;
  players: { id: number }[];
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  // This full list (with create/delete) is an admin-only view. A
  // Teammanager only ever manages their own team, so send them straight to
  // its edit page instead of a list they can't act on anyway.
  const meResponse = await authFetch("/users/me/");
  if (meResponse.ok) {
    const me: AuthUser = await meResponse.json();
    if (!me.is_superuser) {
      if (hasRole(me, ROLE_TEAM_MANAGER) && me.team_id) {
        throw redirect(`/admin/teams/${me.team_id}/edit`);
      }
      throw redirect("/admin");
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}/teams/`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const teams: Team[] = await response.json();
    return { teams };
  } catch (error) {
    console.error("Failed to fetch teams for admin dashboard:", error);
    return { teams: [], error: "Failed to load teams." };
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
  const id = formData.get("id");
  if (typeof id !== "string") {
    return { error: "Invalid form submission." };
  }
  if (!isLoggedIn()) {
    return redirect("/login");
  }
  try {
    const response = await authFetch(`/admin/teams/${id}/`, { method: "DELETE" });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
    }
    return { success: "Team gelöscht." };
  } catch (error: any) {
    console.error("Failed to delete team:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminTeamsPage() {
  const { teams, error: loaderError } = useLoaderData() as { teams: Team[]; error?: string };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="teams" />

        {loaderError && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>}
        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Teams</h2>
          <a href="/admin/teams/new" className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300">
            + Neues Team
          </a>
        </div>

        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Name</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Spiel</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Main Team</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Spieler</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {teams.map((team) => (
                <tr key={team.id} className="hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">{team.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{team.game}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{team.is_main_team ? "Ja" : "Nein"}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{team.players.length}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <a href={`/admin/teams/${team.id}/edit`} className="inline-block py-2 px-4 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">
                      Bearbeiten
                    </a>
                    <Form
                      method="post"
                      className="inline"
                      onSubmit={(event) => {
                        if (!confirm(`Team "${team.name}" wirklich löschen?`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={team.id} />
                      <button type="submit" className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                        Löschen
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">Noch keine Teams vorhanden.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
