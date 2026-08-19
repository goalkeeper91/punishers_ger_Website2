import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface SenderOption {
  value: string;
  address: string;
  label: string;
}

interface EmailLogEntry {
  id: number;
  from_alias: string;
  from_address: string;
  to: string;
  subject: string;
  sent_by_username: string | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const [sendersRes, logRes] = await Promise.all([
      authFetch("/admin/communications/senders/"),
      authFetch("/admin/communications/log/"),
    ]);
    for (const response of [sendersRes, logRes]) {
      if (!response.ok) {
        if (response.status === 401) throw redirect("/login");
        if (response.status === 403) throw redirect("/admin");
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
    const senders: SenderOption[] = await sendersRes.json();
    const log: EmailLogEntry[] = await logRes.json();
    return { senders, log };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch communications data:", error);
    return { senders: [], log: [], error: "Daten konnten nicht geladen werden." };
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
  if (!isLoggedIn()) {
    return redirect("/login");
  }

  const formData = await request.formData();
  const fromAlias = formData.get("from_alias");
  const to = formData.get("to");
  const subject = formData.get("subject");
  const body = formData.get("body");

  if (typeof fromAlias !== "string" || typeof to !== "string" || !to.trim() || typeof subject !== "string" || !subject.trim() || typeof body !== "string" || !body.trim()) {
    return { error: "Bitte Absender, Empfänger, Betreff und Nachricht ausfüllen." };
  }

  try {
    const response = await authFetch("/admin/communications/send-email/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_alias: fromAlias, to: to.trim(), subject: subject.trim(), body: body.trim() }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
    }
    return { success: "E-Mail wurde versendet." };
  } catch (error: any) {
    console.error("Send email action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminCommunicationsPage() {
  const { senders, log, error: loaderError } = useLoaderData() as {
    senders: SenderOption[];
    log: EmailLogEntry[];
    error?: string;
  };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="communications" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        <h2 className="text-2xl font-bold text-white mb-6">E-Mail versenden</h2>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
          <Form method="post" className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-gray-300">Absender</label>
              <select
                name="from_alias"
                required
                disabled={senders.length === 0}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                {senders.map((sender) => (
                  <option key={sender.value} value={sender.value}>{sender.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Empfänger</label>
              <input
                type="text"
                name="to"
                required
                placeholder="empfänger@beispiel.de, weitere@beispiel.de"
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Mehrere Adressen mit Komma trennen.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Betreff</label>
              <input
                type="text"
                name="subject"
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300">Nachricht</label>
              <textarea
                name="body"
                required
                rows={8}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={senders.length === 0}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Senden
            </button>
          </Form>
        </div>

        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <h3 className="text-xl font-bold text-white mb-4">Zuletzt versendet</h3>
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Von</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">An</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Betreff</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Gesendet von</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Zeitpunkt</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {log.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-700">
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{entry.from_address}</td>
                  <td className="px-4 py-4 text-sm text-gray-200">{entry.to}</td>
                  <td className="px-4 py-4 text-sm text-gray-200">{entry.subject}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{entry.sent_by_username || "-"}</td>
                  <td className="px-4 py-4 text-sm text-gray-200 whitespace-nowrap">{formatDate(entry.created_at)}</td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm">
                    {entry.success ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Gesendet</span>
                    ) : (
                      <span
                        className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800"
                        title={entry.error_message || undefined}
                      >
                        Fehlgeschlagen
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">
                    Noch keine E-Mail versendet.
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
