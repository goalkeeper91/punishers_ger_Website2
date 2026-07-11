import type { ClientLoaderFunction, ClientActionFunction } from "react-router";
import { useLoaderData, useActionData, Form, redirect } from "react-router";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";

interface NewsArticle {
  id: number;
  title: string;
  slug: string;
  content: string;
  author_name: string | null;
  image_url: string | null;
  published_date: string;
  updated_date: string;
  status: string;
}

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }

  try {
    const response = await authFetch("/admin/news/");
    if (!response.ok) {
      if (response.status === 401) {
        throw redirect("/login");
      }
      if (response.status === 403) {
        throw redirect("/admin"); // logged in, just lacks news.manage_news
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const articles: NewsArticle[] = await response.json();
    return { articles };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    console.error("Failed to fetch news articles for admin dashboard:", error);
    return { articles: [], error: "Failed to load news articles." };
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
    if (intent === "delete") {
      const response = await authFetch(`/admin/news/${id}/`, { method: "DELETE" });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(extractErrorMessage(errorData, `HTTP error! status: ${response.status}`));
      }
      return { success: "Artikel gelöscht." };
    }

    if (intent === "toggle-status") {
      const newStatus = formData.get("newStatus");
      const response = await authFetch(`/admin/news/${id}/`, {
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

    return { error: "Unbekannte Aktion." };
  } catch (error: any) {
    console.error("Admin news action failed:", error);
    return { error: error.message || "Ein Fehler ist aufgetreten." };
  }
};

export default function AdminNewsPage() {
  const { articles, error: loaderError } = useLoaderData() as { articles: NewsArticle[]; error?: string };
  const actionData = useActionData() as { error?: string; success?: string } | undefined;

  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
    return new Date(dateString).toLocaleDateString("de-DE", options);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="news" />

        {loaderError && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{loaderError}</div>
        )}
        {actionData?.error && (
          <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.error}</div>
        )}
        {actionData?.success && (
          <div className="bg-green-800 text-white p-4 rounded-md mb-6 text-center">{actionData.success}</div>
        )}

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">News-Artikel</h2>
          <a
            href="/admin/news/new"
            className="inline-block bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-full text-sm transition-colors duration-300"
          >
            + Neuer Artikel
          </a>
        </div>

        <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-xl p-6">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Titel</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Autor</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Veröffentlicht</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {articles.map((article) => (
                <tr key={article.id} className="hover:bg-gray-700">
                  <td className="px-6 py-4 text-sm font-medium text-gray-200">{article.title}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{article.author_name || "-"}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${article.status === "published" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                      {article.status === "published" ? "Veröffentlicht" : "Entwurf"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">{formatDate(article.published_date)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <a
                      href={`/admin/news/${article.id}/edit`}
                      className="inline-block py-2 px-4 rounded-md text-white text-xs font-semibold bg-gray-600 hover:bg-gray-500"
                    >
                      Bearbeiten
                    </a>
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="toggle-status" />
                      <input type="hidden" name="id" value={article.id} />
                      <input type="hidden" name="newStatus" value={article.status === "published" ? "draft" : "published"} />
                      <button
                        type="submit"
                        className={`py-2 px-4 rounded-md text-white text-xs font-semibold ${article.status === "published" ? "bg-yellow-600 hover:bg-yellow-700" : "bg-green-600 hover:bg-green-700"}`}
                      >
                        {article.status === "published" ? "Zurückziehen" : "Veröffentlichen"}
                      </button>
                    </Form>
                    <Form
                      method="post"
                      className="inline"
                      onSubmit={(event) => {
                        if (!confirm(`Artikel "${article.title}" wirklich löschen?`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={article.id} />
                      <button type="submit" className="py-2 px-4 rounded-md text-white text-xs font-semibold bg-red-600 hover:bg-red-700">
                        Löschen
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">
                    Noch keine Artikel vorhanden.
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
