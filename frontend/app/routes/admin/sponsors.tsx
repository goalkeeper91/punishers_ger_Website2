import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import { imageFallback } from "~/lib/sampleAssets";
import AdminNav from "~/components/AdminNav";

interface Sponsor {
  id: number;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: string;
  is_active: boolean;
  order: number;
  click_count: number;
}

interface SocialLink {
  id: number;
  platform: string;
  url: string;
  is_active: boolean;
  order: number;
  click_count: number;
}

const PLATFORMS = ["twitch", "youtube", "twitter", "instagram", "facebook", "discord", "tiktok", "other"];

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  const [sponsorsRes, socialsRes] = await Promise.all([
    authFetch("/admin/sponsors/"),
    authFetch("/admin/socials/"),
  ]);
  if (!sponsorsRes.ok || !socialsRes.ok) {
    if (sponsorsRes.status === 401 || socialsRes.status === 401) {
      throw redirect("/login");
    }
    if (sponsorsRes.status === 403 || socialsRes.status === 403) {
      throw redirect("/admin"); // logged in, just lacks sponsors.manage_sponsors
    }
    throw new Error("Failed to load sponsors/socials");
  }
  const sponsors: Sponsor[] = await sponsorsRes.json();
  const socials: SocialLink[] = await socialsRes.json();
  return { sponsors, socials };
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
      case "createSponsor": {
        const response = await authFetch("/admin/sponsors/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            website_url: formData.get("website_url") || null,
            tier: formData.get("tier"),
            order: Number(formData.get("order") || 0),
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Sponsor konnte nicht erstellt werden.") };
        return { success: "Sponsor erstellt." };
      }
      case "updateSponsor": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/sponsors/${id}/`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.get("name"),
            website_url: formData.get("website_url") || null,
            tier: formData.get("tier"),
            order: Number(formData.get("order") || 0),
            is_active: formData.get("is_active") === "on",
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Sponsor konnte nicht gespeichert werden.") };
        return { success: "Sponsor gespeichert." };
      }
      case "deleteSponsor": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/sponsors/${id}/`, { method: "DELETE" });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
        }
        return { success: "Sponsor gelöscht." };
      }
      case "uploadSponsorLogo": {
        const id = formData.get("id");
        const file = formData.get("logo");
        if (!file || !(file instanceof File) || file.size === 0) {
          return { error: "Keine Datei ausgewählt." };
        }
        const logoFormData = new FormData();
        logoFormData.append("file", file);
        const response = await authFetch(`/admin/sponsors/${id}/logo/`, { method: "POST", body: logoFormData });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
        }
        return { success: "Logo hochgeladen." };
      }
      case "createSocial": {
        const response = await authFetch("/admin/socials/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: formData.get("platform"),
            url: formData.get("url"),
            order: Number(formData.get("order") || 0),
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Social Link konnte nicht erstellt werden.") };
        return { success: "Social Link erstellt." };
      }
      case "updateSocial": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/socials/${id}/`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: formData.get("platform"),
            url: formData.get("url"),
            order: Number(formData.get("order") || 0),
            is_active: formData.get("is_active") === "on",
          }),
        });
        const data = await response.json();
        if (!response.ok) return { error: extractErrorMessage(data, "Social Link konnte nicht gespeichert werden.") };
        return { success: "Social Link gespeichert." };
      }
      case "deleteSocial": {
        const id = formData.get("id");
        const response = await authFetch(`/admin/socials/${id}/`, { method: "DELETE" });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
        }
        return { success: "Social Link gelöscht." };
      }
      default:
        return { error: "Unbekannte Aktion." };
    }
  } catch (error: any) {
    console.error("Sponsors/socials action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminSponsorsPage() {
  const { sponsors, socials } = useLoaderData() as { sponsors: Sponsor[]; socials: SocialLink[] };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const inputClass = "px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-red-500 focus:border-red-500";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="sponsors" />

        {actionData?.error && <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>}
        {actionData?.success && <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>}

        {/* Sponsors */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-10">
          <h2 className="text-2xl font-bold text-white mb-6">Sponsoren</h2>

          <div className="overflow-x-auto mb-6">
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Logo</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Website</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Tier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Reihenfolge</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Aktiv</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Klicks</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-300 uppercase">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {sponsors.map((sponsor) => (
                  <tr key={sponsor.id}>
                    <td className="px-3 py-3">
                      <img
                        src={sponsor.logo_url || imageFallback("https://via.placeholder.com/60x30?text=Logo")}
                        alt={sponsor.name}
                        className="h-8 w-16 object-contain bg-gray-900 rounded"
                      />
                    </td>
                    <td colSpan={6} className="px-3 py-3">
                      <Form method="post" className="flex flex-wrap gap-2 items-center">
                        <input type="hidden" name="_intent" value="updateSponsor" />
                        <input type="hidden" name="id" value={sponsor.id} />
                        <input name="name" defaultValue={sponsor.name} className={inputClass + " w-32"} />
                        <input name="website_url" defaultValue={sponsor.website_url || ""} placeholder="https://..." className={inputClass + " w-40"} />
                        <select name="tier" defaultValue={sponsor.tier} className={inputClass}>
                          <option value="premium">Premium</option>
                          <option value="general">Allgemein</option>
                        </select>
                        <input name="order" type="number" defaultValue={sponsor.order} className={inputClass + " w-16"} />
                        <label className="flex items-center gap-1 text-sm text-gray-300">
                          <input type="checkbox" name="is_active" defaultChecked={sponsor.is_active} className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600" />
                          aktiv
                        </label>
                        <span className="text-sm text-gray-400">{sponsor.click_count} Klicks</span>
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Speichern</button>
                      </Form>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (!confirm(`Sponsor "${sponsor.name}" wirklich löschen?`)) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="_intent" value="deleteSponsor" />
                        <input type="hidden" name="id" value={sponsor.id} />
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">Löschen</button>
                      </Form>
                    </td>
                  </tr>
                ))}
                {sponsors.map((sponsor) => (
                  <tr key={`logo-${sponsor.id}`} className="bg-gray-900/40">
                    <td colSpan={8} className="px-3 py-2">
                      <Form method="post" encType="multipart/form-data" className="flex items-center gap-2">
                        <input type="hidden" name="_intent" value="uploadSponsorLogo" />
                        <input type="hidden" name="id" value={sponsor.id} />
                        <span className="text-xs text-gray-400 whitespace-nowrap">Logo für {sponsor.name}:</span>
                        <input type="file" name="logo" accept="image/*" className="text-xs text-gray-300 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-red-600 file:text-white" />
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Hochladen</button>
                      </Form>
                    </td>
                  </tr>
                ))}
                {sponsors.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">Noch keine Sponsoren.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-bold text-white mb-3">Neuer Sponsor</h3>
          <Form method="post" className="flex flex-wrap gap-2 items-end">
            <input type="hidden" name="_intent" value="createSponsor" />
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name <span className="text-red-500">*</span></label>
              <input name="name" required className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Website</label>
              <input name="website_url" placeholder="https://..." className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tier</label>
              <select name="tier" defaultValue="general" className={inputClass}>
                <option value="premium">Premium</option>
                <option value="general">Allgemein</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Reihenfolge</label>
              <input name="order" type="number" defaultValue={0} className={inputClass + " w-16"} />
            </div>
            <button type="submit" className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700">+ Hinzufügen</button>
          </Form>
        </div>

        {/* Social Links */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          <h2 className="text-2xl font-bold text-white mb-6">Social Links</h2>

          <div className="overflow-x-auto mb-6">
            <table className="min-w-full divide-y divide-gray-700">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Plattform</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">URL</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Reihenfolge</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Aktiv</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-300 uppercase">Klicks</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-300 uppercase">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {socials.map((link) => (
                  <tr key={link.id}>
                    <td colSpan={5} className="px-3 py-3">
                      <Form method="post" className="flex flex-wrap gap-2 items-center">
                        <input type="hidden" name="_intent" value="updateSocial" />
                        <input type="hidden" name="id" value={link.id} />
                        <select name="platform" defaultValue={link.platform} className={inputClass}>
                          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <input name="url" defaultValue={link.url} className={inputClass + " w-56"} />
                        <input name="order" type="number" defaultValue={link.order} className={inputClass + " w-16"} />
                        <label className="flex items-center gap-1 text-sm text-gray-300">
                          <input type="checkbox" name="is_active" defaultChecked={link.is_active} className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-red-600" />
                          aktiv
                        </label>
                        <span className="text-sm text-gray-400">{link.click_count} Klicks</span>
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500">Speichern</button>
                      </Form>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Form
                        method="post"
                        onSubmit={(event) => {
                          if (!confirm(`Social Link "${link.platform}" wirklich löschen?`)) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="_intent" value="deleteSocial" />
                        <input type="hidden" name="id" value={link.id} />
                        <button type="submit" className="py-1 px-3 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">Löschen</button>
                      </Form>
                    </td>
                  </tr>
                ))}
                {socials.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">Noch keine Social Links.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-bold text-white mb-3">Neuer Social Link</h3>
          <Form method="post" className="flex flex-wrap gap-2 items-end">
            <input type="hidden" name="_intent" value="createSocial" />
            <div>
              <label className="block text-xs text-gray-400 mb-1">Plattform</label>
              <select name="platform" defaultValue="twitch" className={inputClass}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">URL <span className="text-red-500">*</span></label>
              <input name="url" required placeholder="https://..." className={inputClass + " w-56"} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Reihenfolge</label>
              <input name="order" type="number" defaultValue={0} className={inputClass + " w-16"} />
            </div>
            <button type="submit" className="py-2 px-4 rounded-md text-white text-sm font-semibold bg-red-600 hover:bg-red-700">+ Hinzufügen</button>
          </Form>
        </div>
      </div>
    </div>
  );
}
