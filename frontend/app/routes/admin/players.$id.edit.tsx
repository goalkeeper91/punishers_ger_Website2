import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { imageFallback } from "~/lib/sampleAssets";
import AdminNav from "~/components/AdminNav";

interface Player {
  id: number;
  ingame_name: string;
  role: string | null;
  description: string | null;
  image_url: string | null;
  team_id: number | null;
  user: { username: string } | null;
}

export const clientLoader: ClientLoaderFunction = async ({ params }) => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const response = await authFetch(`/admin/players/${params.id}/`);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw redirect("/login");
    }
    if (response.status === 404) {
      throw redirect("/admin/teams");
    }
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const player: Player = await response.json();
  return { player };
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
  const formType = formData.get("_formType");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  try {
    if (formType === "imageUpload") {
      const file = formData.get("image");
      if (!file || !(file instanceof File) || file.size === 0) {
        return { error: "Keine Datei ausgewählt." };
      }
      const imageFormData = new FormData();
      imageFormData.append("file", file);
      const response = await authFetch(`/admin/players/${params.id}/image/`, { method: "POST", body: imageFormData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Bild hochgeladen." };
    }

    if (formType === "update") {
      const response = await authFetch(`/admin/players/${params.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingame_name: formData.get("ingame_name"),
          role: formData.get("role") || null,
          description: formData.get("description") || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return { errors: { general: extractErrorMessage(data, "Spieler konnte nicht gespeichert werden.") } };
      }
      return { success: "Spieler gespeichert." };
    }

    return { error: "Unbekannter Formular-Typ." };
  } catch (error: any) {
    console.error("Failed to update player:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminPlayerEditPage() {
  const { player } = useLoaderData() as { player: Player };
  const actionData = useActionData() as
    | { error?: string; success?: string; errors?: { [key: string]: string } }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-2xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="teams" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.errors?.general && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        <div className="bg-gray-800 p-8 rounded-lg shadow-xl mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Spielerbild</h2>
          <div className="flex flex-col items-center md:flex-row md:items-start gap-8">
            <img
              className="w-32 h-32 object-cover rounded-full border-4 border-red-600"
              src={player.image_url || imageFallback("https://via.placeholder.com/150?text=User")}
              alt={player.ingame_name}
            />
            <Form method="post" encType="multipart/form-data" className="space-y-4 flex-grow">
              <input type="hidden" name="_formType" value="imageUpload" />
              <input type="file" name="image" accept="image/*" className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-red-600 file:text-white hover:file:bg-red-700" />
              <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
                Bild hochladen
              </button>
            </Form>
          </div>
        </div>

        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-2">Spielerdetails</h2>
          <p className="text-gray-500 text-sm mb-6">Verknüpftes Konto: {player.user ? `@${player.user.username}` : "keins"}</p>
          <Form method="post" className="space-y-6">
            <input type="hidden" name="_formType" value="update" />
            <div>
              <label htmlFor="ingame_name" className="block text-sm font-medium text-gray-300">Ingame-Name</label>
              <input type="text" id="ingame_name" name="ingame_name" defaultValue={player.ingame_name} required className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-300">Rolle</label>
              <input type="text" id="role" name="role" defaultValue={player.role || ""} className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-300">Beschreibung</label>
              <textarea id="description" name="description" rows={4} defaultValue={player.description || ""} className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm" />
            </div>
            <button type="submit" disabled={isSubmitting} className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">
              Speichern
            </button>
          </Form>
        </div>

        <div className="mt-6">
          {player.team_id && (
            <a href={`/admin/teams/${player.team_id}/edit`} className="text-gray-400 hover:text-white text-sm">← Zurück zum Team</a>
          )}
        </div>
      </div>
    </div>
  );
}
