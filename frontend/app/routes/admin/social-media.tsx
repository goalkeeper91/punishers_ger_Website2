import type { ClientLoaderFunction } from "react-router";
import { useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import AdminNav from "~/components/AdminNav";

interface LoaderData {
  vaultUrl: string | null;
  error?: string;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const response = await authFetch("/admin/social-media/vault-url/");
    if (!response.ok) {
      if (response.status === 401) throw redirect("/login");
      if (response.status === 403) throw redirect("/admin");
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: { vault_url: string | null } = await response.json();
    return { vaultUrl: data.vault_url } satisfies LoaderData;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch vault URL:", error);
    return { vaultUrl: null, error: "Vault-Adresse konnte nicht geladen werden." } satisfies LoaderData;
  }
};

export function HydrateFallback() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans flex items-center justify-center">
      <p className="text-xl">Lädt...</p>
    </div>
  );
}

export default function AdminSocialMediaPage() {
  const { vaultUrl, error: loaderError } = useLoaderData() as LoaderData;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="social-media" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}

        <h2 className="text-2xl font-bold text-white mb-6">Social Media</h2>

        {vaultUrl ? (
          <div className="bg-gray-800 rounded-lg shadow-xl p-4">
            <iframe
              src={vaultUrl}
              title="Vaultwarden"
              allow="clipboard-write"
              className="w-full h-[80vh] rounded-lg border border-gray-700 bg-white"
            />
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 text-gray-300">
            <p>Der Zugangsdaten-Tresor ist noch nicht eingerichtet.</p>
            <p className="text-sm text-gray-400 mt-2">
              Ein Admin muss die Vault-Adresse (z. B. <code className="text-gray-300">https://vault.punishersgermany.de/</code>)
              einmalig im Django-Admin unter „Social Media &rarr; Social-Media-Vault-Einstellungen" hinterlegen.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
