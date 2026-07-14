import type { ClientActionFunction, ClientLoaderFunction } from "react-router";
import { Form, useActionData, redirect } from "react-router";
import { useRef } from "react";
import { authFetch, isLoggedIn } from "~/lib/auth";
import { extractErrorMessage } from "~/lib/errors";
import AdminNav from "~/components/AdminNav";
import MarkdownToolbar from "~/components/MarkdownToolbar";

export const clientLoader: ClientLoaderFunction = async () => {
  if (!isLoggedIn()) {
    throw redirect("/login");
  }
  return null;
};

export const clientAction: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const title = formData.get("title");
  const slug = formData.get("slug");
  const content = formData.get("content");
  const articleStatus = formData.get("status");

  if (!isLoggedIn()) {
    return redirect("/login");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    return { errors: { title: "Titel darf nicht leer sein." } };
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return { errors: { content: "Inhalt darf nicht leer sein." } };
  }

  try {
    const response = await authFetch("/admin/news/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        slug: typeof slug === "string" && slug.trim() ? slug.trim() : undefined,
        content,
        status: articleStatus === "published" ? "published" : "draft",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { errors: { general: extractErrorMessage(data, "Artikel konnte nicht erstellt werden.") } };
    }

    return redirect(`/admin/news/${data.id}/edit`);
  } catch (error) {
    console.error("Failed to create news article:", error);
    return { errors: { general: "Ein unerwarteter Fehler ist aufgetreten." } };
  }
};

export default function AdminNewsNewPage() {
  const actionData = useActionData() as { errors?: { [key: string]: string } } | undefined;
  const contentRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans py-12">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-white text-center mb-6">Admin Dashboard</h1>
        <AdminNav active="news" />

        <div className="bg-gray-800 p-8 rounded-lg shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-6">Neuer Artikel</h2>

          {actionData?.errors?.general && (
            <div className="bg-red-800 text-white p-4 rounded-md mb-6 text-center">{actionData.errors.general}</div>
          )}

          <Form method="post" className="space-y-6">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-300">Titel <span className="text-red-500">*</span></label>
              <input
                type="text"
                id="title"
                name="title"
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
              {actionData?.errors?.title && <p className="mt-2 text-sm text-red-500">{actionData.errors.title}</p>}
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-gray-300">
                Slug <span className="text-gray-500">(optional, wird sonst aus dem Titel generiert)</span>
              </label>
              <input
                type="text"
                id="slug"
                name="slug"
                placeholder="mein-artikel"
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="content" className="block text-sm font-medium text-gray-300 mb-1">Inhalt <span className="text-red-500">*</span></label>
              <MarkdownToolbar textareaRef={contentRef} />
              <textarea
                id="content"
                name="content"
                ref={contentRef}
                rows={10}
                required
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm font-mono"
              />
              {actionData?.errors?.content && <p className="mt-2 text-sm text-red-500">{actionData.errors.content}</p>}
            </div>

            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-300">Status</label>
              <select
                id="status"
                name="status"
                defaultValue="draft"
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
              >
                <option value="draft">Entwurf</option>
                <option value="published">Veröffentlicht</option>
              </select>
            </div>

            <p className="text-xs text-gray-500">Ein Titelbild kannst du direkt im Anschluss auf der nächsten Seite hochladen.</p>

            <div className="flex gap-3">
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Artikel erstellen
              </button>
              <a
                href="/admin/news"
                className="inline-flex justify-center py-2 px-4 border border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-300 hover:bg-gray-700"
              >
                Abbrechen
              </a>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
