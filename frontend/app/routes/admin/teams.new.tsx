import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  // Creating a new team is an admin-only action - Teammanagers only manage
  // their existing team, they don't create new ones.
  const meResponse = await authFetch("/users/me/");
  if (meResponse.ok) {
    const me: AuthUser = await meResponse.json();
    if (!me.is_superuser) {
      throw redirect("/admin");
    }
  }
  return null;
};

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const name = formData.get("name");
  const game = formData.get("game");
  const description = formData.get("description");
  const isMainTeam = formData.get("is_main_team") === "on";

  if (!isLoggedIn()) {
    return redirect("/login");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return { errors: { name: "Name darf nicht leer sein." } };
  }
  if (typeof game !== "string" || game.trim().length === 0) {
    return { errors: { game: "Spiel darf nicht leer sein." } };
  }

  try {
    const response = await authFetch("/admin/teams/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        game,
        description: typeof description === "string" && description.trim() ? description : null,
        is_main_team: isMainTeam,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { errors: { general: extractErrorMessage(data, "Team konnte nicht erstellt werden.") } };
    }
    return redirect(`/admin/teams/${data.id}/edit`);
  } catch (error) {
    console.error("Failed to create team:", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function AdminTeamsNewPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string } } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-2xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="teams" />

        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-6">Neues Team</h2>

          {actionData?.errors?.general && (
            <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>
          )}

          <Form method="post" className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300">Name <span className="text-red-500">*</span></label>
              <input type="text" id="name" name="name" required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
              {actionData?.errors?.name && <p className="mt-2 text-sm text-red-500">{actionData.errors.name}</p>}
            </div>
            <div>
              <label htmlFor="game" className="block text-sm font-medium text-gray-300">Spiel <span className="text-red-500">*</span></label>
              <input type="text" id="game" name="game" placeholder="Counter-Strike 2" required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
              {actionData?.errors?.game && <p className="mt-2 text-sm text-red-500">{actionData.errors.game}</p>}
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300">Beschreibung</label>
              <textarea id="description" name="description" rows={4} className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_main_team" name="is_main_team" className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500" />
              <label htmlFor="is_main_team" className="text-sm font-medium text-gray-300">Main Team</label>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Team erstellen
              </button>
              <a href="/admin/teams" className="inline-flex justify-center py-2 px-4 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 hover:bg-gray-700">
                Abbrechen
              </a>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
