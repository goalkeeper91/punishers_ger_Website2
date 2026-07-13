import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { API_BASE_URL } from "~/lib/config";
import AdminNav from "~/components/AdminNav";

const PAGE_KEYS = [
  { key: "news", label: "News" },
  { key: "teams", label: "Teams" },
  { key: "about_us", label: "Über uns" },
  { key: "sponsors", label: "Sponsoren" },
  { key: "contact", label: "Kontakt" },
  { key: "join_us", label: "Join Us" },
  { key: "privacy", label: "Datenschutz" },
  { key: "imprint", label: "Impressum" },
  { key: "creators", label: "Creators" },
] as const;

interface LoaderData {
  heroVideoUrl: string | null;
  backgrounds: Record<string, string | null>;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const meRes = await authFetch("/users/me/");
  if (!meRes.ok) {
    throw redirect("/login");
  }
  const me: AuthUser = await meRes.json();
  const canManage = me.is_superuser || me.permissions.includes("site_settings.manage_site_settings");
  if (!canManage) {
    throw redirect("/admin");
  }

  const [siteSettingsRes, backgroundsRes] = await Promise.all([
    fetch(`${API_BASE_URL}/site-settings/`),
    fetch(`${API_BASE_URL}/site-settings/page-backgrounds/`),
  ]);
  const heroVideoUrl = siteSettingsRes.ok ? (await siteSettingsRes.json()).hero_video_url : null;
  const backgrounds = backgroundsRes.ok ? await backgroundsRes.json() : {};
  return { heroVideoUrl, backgrounds } satisfies LoaderData;
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
      case "uploadHeroVideo": {
        const file = formData.get("video");
        if (!file || !(file instanceof File) || file.size === 0) {
          return { error: "Keine Datei ausgewählt." };
        }
        const videoFormData = new FormData();
        videoFormData.append("file", file);
        const response = await authFetch("/admin/site-settings/hero-video/", { method: "POST", body: videoFormData });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Video konnte nicht hochgeladen werden.") };
        return { success: "Hero-Video hochgeladen." };
      }
      case "uploadPageBackground": {
        const pageKey = formData.get("page_key");
        const file = formData.get("image");
        if (!file || !(file instanceof File) || file.size === 0) {
          return { error: "Keine Datei ausgewählt." };
        }
        const imageFormData = new FormData();
        imageFormData.append("file", file);
        const response = await authFetch(`/admin/site-settings/page-backgrounds/${pageKey}/`, { method: "POST", body: imageFormData });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Hintergrundbild konnte nicht hochgeladen werden.") };
        return { success: "Hintergrundbild hochgeladen." };
      }
      default:
        return { error: "Unbekannte Aktion." };
    }
  } catch (error: any) {
    console.error("Site settings action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminSiteSettingsPage() {
  const { heroVideoUrl, backgrounds } = useLoaderData() as LoaderData;
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="site-settings" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        {/* Hero video */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-10">
          <h2 className="text-2xl font-bold text-white mb-2">Hero-Video (Startseite)</h2>
          <p className="text-sm text-gray-400 mb-4">Erlaubt: .mp4, .webm. Maximal 100 MB.</p>
          {heroVideoUrl && (
            <video src={heroVideoUrl} controls muted className="w-full max-w-xl rounded-md mb-4 bg-black" />
          )}
          <Form method="post" encType="multipart/form-data" className="flex items-center gap-2">
            <input type="hidden" name="_intent" value="uploadHeroVideo" />
            <input
              type="file"
              name="video"
              accept="video/mp4,video/webm"
              className="text-sm text-gray-300 file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:text-sm file:bg-red-600 file:text-white"
            />
            <button type="submit" className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700">
              Hochladen
            </button>
          </Form>
        </div>

        {/* Per-page background images */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-2">Seiten-Hintergrundbilder</h2>
          <p className="text-sm text-gray-400 mb-6">Ein eigenes Banner-Bild pro Unterseite. Erlaubt: .jpg, .jpeg, .png, .gif, .webp. Maximal 5 MB.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PAGE_KEYS.map(({ key, label }) => {
              const currentUrl = backgrounds[key];
              return (
                <div key={key} className="bg-gray-900/40 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-white mb-2">{label}</h3>
                  {currentUrl ? (
                    <img src={currentUrl} alt={label} className="w-full h-24 object-cover rounded-md mb-3" />
                  ) : (
                    <div className="w-full h-24 rounded-md mb-3 bg-gray-800 flex items-center justify-center text-xs text-gray-500">
                      Kein Bild hochgeladen
                    </div>
                  )}
                  <Form method="post" encType="multipart/form-data" className="flex items-center gap-2">
                    <input type="hidden" name="_intent" value="uploadPageBackground" />
                    <input type="hidden" name="page_key" value={key} />
                    <input
                      type="file"
                      name="image"
                      accept="image/*"
                      className="text-xs text-gray-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-red-600 file:text-white"
                    />
                    <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500 whitespace-nowrap">
                      Hochladen
                    </button>
                  </Form>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
