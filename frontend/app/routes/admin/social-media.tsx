import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, useLoaderData, redirect } from "react-router";
import { authFetch, isLoggedIn, type AuthUser } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface LoaderData {
  vaultUrl: string | null;
  isSuperuser: boolean;
  error?: string;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const [meRes, vaultRes] = await Promise.all([
      authFetch("/users/me/"),
      authFetch("/admin/social-media/vault-url/"),
    ]);
    if (!vaultRes.ok) {
      if (vaultRes.status === 401) throw redirect("/login");
      if (vaultRes.status === 403) throw redirect("/admin");
      throw new Error(`HTTP error! status: ${vaultRes.status}`);
    }
    const me: AuthUser | null = meRes.ok ? await meRes.json() : null;
    const data: { vault_url: string | null } = await vaultRes.json();
    return { vaultUrl: data.vault_url, isSuperuser: me?.is_superuser ?? false } satisfies LoaderData;
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch vault URL:", error);
    return { vaultUrl: null, isSuperuser: false, error: "Vault-Adresse konnte nicht geladen werden." } satisfies LoaderData;
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

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  if (intent === "save-vault-url") {
    const vaultUrl = formData.get("vault_url");
    if (typeof vaultUrl !== "string" || !vaultUrl.trim()) {
      return { error: "Bitte eine Vault-Adresse angeben." };
    }
    try {
      const response = await authFetch("/admin/social-media/vault-url/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vault_url: vaultUrl.trim() }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Vault-Adresse gespeichert." };
    } catch (error: any) {
      console.error("Failed to save vault URL:", error);
      return { error: error.message || "Ein Fehler ist aufgetreten." };
    }
  }

  return { error: "Unbekannte Aktion." };
};

export default function AdminSocialMediaPage() {
  const { vaultUrl, isSuperuser, error: loaderError } = useLoaderData() as LoaderData;
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="social-media" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        <h2 className="text-2xl font-bold text-white mb-6">Social Media</h2>

        {vaultUrl ? (
          <div className="bg-gray-800 rounded-lg shadow-xl p-4 mb-8">
            <iframe
              src={vaultUrl}
              title="Vaultwarden"
              allow="clipboard-write"
              className="w-full h-[80vh] rounded-lg border border-gray-700 bg-white"
            />
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 text-gray-300 mb-8">
            <p>Der Zugangsdaten-Tresor ist noch nicht eingerichtet.</p>
            {!isSuperuser && (
              <p className="text-sm text-gray-400 mt-2">Ein Admin muss die Vault-Adresse unten hinterlegen.</p>
            )}
          </div>
        )}

        {isSuperuser && (
          <div className="bg-gray-800 rounded-lg shadow-xl p-6">
            <h3 className="text-lg font-bold text-white mb-3">Vault-Adresse {vaultUrl ? "ändern" : "einrichten"}</h3>
            <Form method="post" className="flex flex-col sm:flex-row gap-3">
              <input type="hidden" name="intent" value="save-vault-url" />
              <input
                type="url"
                name="vault_url"
                required
                placeholder="https://vault.punishersgermany.de/"
                defaultValue={vaultUrl || ""}
                className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
              >
                Speichern
              </button>
            </Form>
          </div>
        )}
      </div>
    </div>
  );
}
