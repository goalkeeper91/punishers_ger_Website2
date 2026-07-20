import { useState } from "react";
import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { authFetch, isLoggedIn, hasRole, ROLE_TEAM_MANAGER, type AuthUser } from "~/lib/auth";
import { API_BASE_URL } from "~/lib/config";
import { extractErrorMessage } from "~/lib/errors";
import { imageFallback } from "~/lib/sampleAssets";
import AdminNav from "~/components/AdminNav";
import ImageCropInput from "~/components/ImageCropInput";

interface Player {
  id: number;
  ingame_name: string;
  role: string | null;
  image_url: string | null;
  user: { username: string } | null;
}

interface Team {
  id: number;
  name: string;
  game: string;
  description: string | null;
  image_url: string | null;
  is_main_team: boolean;
  players: Player[];
}

interface AvailableUser {
  id: number;
  username: string;
}

export const clientLoader: ClientLoaderFunction = async ({ params }) => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  const meResponse = await authFetch("/users/me/");
  if (meResponse.ok) {
    const me: AuthUser = await meResponse.json();
    const isOwnTeam = hasRole(me, ROLE_TEAM_MANAGER) && String(me.team_id) === params.id;
    if (!me.is_superuser && !isOwnTeam) {
      throw redirect("/admin");
    }
  }

  const response = await fetch(`${API_BASE_URL}/teams/${params.id}/`);
  if (!response.ok) {
    if (response.status === 404) {
      throw redirect("/admin/teams");
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const team: Team = await response.json();

  let availableUsers: AvailableUser[] = [];
  const availableUsersResponse = await authFetch("/admin/users/available-for-roster/");
  if (availableUsersResponse.ok) {
    availableUsers = await availableUsersResponse.json();
  }

  return { team, availableUsers };
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export const clientAction: ClientActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (intent === "update") {
      const response = await authFetch(`/admin/teams/${params.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          game: formData.get("game"),
          description: formData.get("description") || null,
          is_main_team: formData.get("is_main_team") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Team konnte nicht gespeichert werden.") } };
      }
      return { success: "Team gespeichert." };
    }

    if (intent === "imageUpload") {
      const file = formData.get("image");
      if (!file || !(file instanceof File) || file.size === 0) {
        return { error: "Keine Datei ausgewählt." };
      }
      const imageFormData = new FormData();
      imageFormData.append("file", file);
      const response = await authFetch(`/admin/teams/${params.id}/image/`, { method: "POST", body: imageFormData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Bild hochgeladen." };
    }

    if (intent === "addPlayer") {
      const memberType = formData.get("member_type");
      const ingameName = formData.get("ingame_name");
      const role = formData.get("role");

      if (typeof ingameName !== "string" || !ingameName.trim()) {
        return { errors: { ingame_name: "Ingame-Name erforderlich." } };
      }

      let userId: number | null = null;
      if (memberType !== "guest") {
        const rawUserId = formData.get("user_id");
        if (typeof rawUserId !== "string" || !rawUserId) {
          return { errors: { username: "Nutzer auswählen." } };
        }
        userId = Number(rawUserId);
      }

      const response = await authFetch("/admin/players/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: Number(params.id),
          ingame_name: ingameName,
          role: role || null,
          user_id: userId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Spieler konnte nicht hinzugefügt werden.") } };
      }
      return { success: `${ingameName} zum Roster hinzugefügt.` };
    }

    if (intent === "removePlayer") {
      const playerId = formData.get("playerId");
      const response = await authFetch(`/admin/players/${playerId}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Spieler aus dem Roster entfernt." };
    }

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Team edit action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminTeamEditPage() {
  const { team, availableUsers } = useLoaderData() as { team: Team; availableUsers: AvailableUser[] };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [memberType, setMemberType] = useState<"registered" | "guest">("registered");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="teams" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.errors?.general && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        {/* Image */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Teambild</h2>
          <div className="flex flex-col items-center md:flex-row md:items-start gap-8">
            <img
              className="w-48 h-32 object-cover rounded-md border border-gray-600"
              src={team.image_url || imageFallback("https://via.placeholder.com/300x200?text=No+Image")}
              alt={team.name}
            />
            <Form method="post" encType="multipart/form-data" className="space-y-4 flex-grow">
              <input type="hidden" name="_intent" value="imageUpload" />
              <ImageCropInput
                id="team_image"
                name="image"
                aspect={3 / 2}
                outputWidth={900}
                outputHeight={600}
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700"
              />
              <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Bild hochladen
              </button>
            </Form>
          </div>
        </div>

        {/* Details */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Teamdetails</h2>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="_intent" value="update" />
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300">Name <span className="text-red-500">*</span></label>
              <input type="text" id="name" name="name" defaultValue={team.name} required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="game" className="block text-sm font-medium text-gray-300">Spiel <span className="text-red-500">*</span></label>
              <input type="text" id="game" name="game" defaultValue={team.game} required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300">Beschreibung</label>
              <textarea id="description" name="description" rows={4} defaultValue={team.description || ""} className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_main_team" name="is_main_team" defaultChecked={team.is_main_team} className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-500" />
              <label htmlFor="is_main_team" className="text-sm font-medium text-gray-300">Main Team</label>
            </div>
            <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
              Speichern
            </button>
          </Form>
        </div>

        {/* Roster */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-6">Roster</h2>
          <ul className="divide-y divide-gray-700 mb-6">
            {team.players.map((player) => (
              <li key={player.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium break-words">{player.ingame_name} {player.role && <span className="text-gray-400 text-sm">({player.role})</span>}</p>
                  <p className="text-gray-500 text-xs">{player.user ? `@${player.user.username}` : "Kein Nutzerkonto"}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <a href={`/admin/players/${player.id}/edit`} className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">
                    Bearbeiten
                  </a>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!confirm(`${player.ingame_name} aus dem Roster entfernen?`)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="_intent" value="removePlayer" />
                    <input type="hidden" name="playerId" value={player.id} />
                    <button type="submit" className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                      Entfernen
                    </button>
                  </Form>
                </div>
              </li>
            ))}
            {team.players.length === 0 && <li className="py-3 text-sm text-gray-400">Noch keine Spieler im Roster.</li>}
          </ul>

          <h3 className="text-lg font-bold text-white mb-4">Spieler hinzufügen</h3>
          <Form method="post" className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <input type="hidden" name="_intent" value="addPlayer" />
            <div className="md:col-span-3 flex gap-6">
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="radio"
                  name="member_type"
                  value="registered"
                  checked={memberType === "registered"}
                  onChange={() => setMemberType("registered")}
                  className="text-red-600 focus:ring-red-500"
                />
                Registrierter User
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-300">
                <input
                  type="radio"
                  name="member_type"
                  value="guest"
                  checked={memberType === "guest"}
                  onChange={() => setMemberType("guest")}
                  className="text-red-600 focus:ring-red-500"
                />
                Gast (kein Konto)
              </label>
            </div>
            {memberType === "registered" && (
              <div>
                <label htmlFor="user_id" className="block text-sm font-medium text-gray-300 mb-1">Benutzer <span className="text-red-500">*</span></label>
                <select id="user_id" name="user_id" required defaultValue="" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm">
                  <option value="" disabled>Bitte wählen...</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
                {availableUsers.length === 0 && <p className="mt-1 text-xs text-gray-500">Keine freien registrierten Nutzer verfügbar.</p>}
                {actionData?.errors?.username && <p className="mt-1 text-sm text-red-500">{actionData.errors.username}</p>}
              </div>
            )}
            <div>
              <label htmlFor="ingame_name" className="block text-sm font-medium text-gray-300 mb-1">Ingame-Name <span className="text-red-500">*</span></label>
              <input type="text" id="ingame_name" name="ingame_name" required className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
              {actionData?.errors?.ingame_name && <p className="mt-1 text-sm text-red-500">{actionData.errors.ingame_name}</p>}
            </div>
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-300 mb-1">Rolle</label>
              <input type="text" id="role" name="role" placeholder="AWPer" className="block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div className="md:col-span-3">
              <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Zum Roster hinzufügen
              </button>
            </div>
          </Form>
        </div>

        <div className="mt-6">
          <a href="/admin/teams" className="text-gray-400 hover:text-white text-sm">← Zurück zur Teamliste</a>
        </div>
      </div>
    </div>
  );
}
